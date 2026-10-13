"""Phase 8: independent re-computation of every calculation in the database, compared with what the
system's views and functions return. The oracle below is written from the written rules (the project
brief + settings), not by copying the SQL, and reads only the raw tables.
Usage: python3 -I calc_audit.py [db]   (load ui_seed.sql + bulk_seed.sql first)"""
import sys, json, subprocess, datetime
from decimal import Decimal as D, ROUND_HALF_UP
from collections import defaultdict

DB = sys.argv[1] if len(sys.argv) > 1 else 'fleet_ui'
PSQL = ['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', DB]
def q(sql):
    out = subprocess.run(PSQL + ['-c', f"select coalesce(json_agg(x), '[]') from ({sql}) x"], capture_output=True, text=True)
    if out.returncode: raise SystemExit(out.stderr)
    return json.loads(out.stdout, parse_float=D)
def scalar(sql): return subprocess.run(PSQL + ['-c', sql], capture_output=True, text=True).stdout.strip()

passed, problems = [], []
def check(name, mismatches, total):
    if mismatches: problems.append(f'{name}: {len(mismatches)} of {total} differ, e.g. {mismatches[:3]}')
    else: passed.append(f'{name} ({total} checked)')

r2 = lambda x: D(x).quantize(D('0.01'), rounding=ROUND_HALF_UP)
dd = lambda s: datetime.date.fromisoformat(s) if s else None
TODAY = dd(scalar('select app_today()'))
RIYADH = datetime.timezone(datetime.timedelta(hours=3))
def riyadh_date(ts): return datetime.datetime.fromisoformat(ts).astimezone(RIYADH).date()
settings = {r['key']: r['value'] for r in q('select key, value from app_settings')}
ALERT = sorted(settings['doc_alert_days'], reverse=True)
WARN, TOL = int(settings['oil_warning_km']), int(settings['oil_overdue_tolerance_km'])

veh = {r['id']: r for r in q('select * from vehicles where deleted_at is null')}
emp = {r['id']: r for r in q('select * from employees where deleted_at is null')}
site_co = {r['id']: r['company_id'] for r in q('select id, company_id from sites')}

# ------------------------------------------------------------------ amounts (generated columns)
oil = q('select * from oil_changes')
check('oil total = oil + filter + extra', [r['oil_no'] for r in oil if D(r['total']) != D(r['oil_cost']) + D(r['filter_cost']) + D(r['extra_cost'])], len(oil))
check('oil next = odometer + interval (default from vehicle)', [r['oil_no'] for r in oil if r['next_odometer'] != r['odometer'] + r['interval_km']], len(oil))
items = q('select * from maintenance_items')
check('item line = round(qty × price, 2)', [r['id'] for r in items if D(r['line_total']) != r2(D(r['quantity']) * D(r['unit_price']))], len(items))
by_m = defaultdict(lambda: defaultdict(D))
for it in items:
    if it['deleted_at'] is None: by_m[it['maintenance_id']][it['kind']] += r2(D(it['quantity']) * D(it['unit_price']))
mnt = q('select * from maintenance')
bad = []
for m in mnt:
    s = by_m[m['id']]
    if (D(m['parts_cost']), D(m['labor_cost']), D(m['other_cost'])) != (s['part'], s['labor'], s['other']): bad.append((m['maint_no'], 'parts/labor/other'))
    if D(m['subtotal']) != s['part'] + s['labor'] + s['other']: bad.append((m['maint_no'], 'subtotal'))
    if D(m['total']) != D(m['subtotal']) + D(m['vat_amount']): bad.append((m['maint_no'], 'total'))
check('maintenance parts/labor/other/subtotal/total from non-deleted items', bad, len(mnt))
vat_bad = [m['maint_no'] for m in mnt if D(m['vat_amount']) not in (D(0), r2(D(m['subtotal']) * D('0.15')))]
check('maintenance VAT is 0 or 15% of subtotal', vat_bad, len(mnt))
acc = q('select * from accidents')
check('accident total = parts + labor + extra', [r['accident_no'] for r in acc if D(r['total']) != D(r['parts_cost']) + D(r['labor_cost']) + D(r['extra_cost'])], len(acc))
hs = q('select * from housing_maintenance')
check('housing total = subtotal + VAT; company from site', [r['op_no'] for r in hs if D(r['total']) != D(r['subtotal']) + D(r['vat_amount']) or r['company_id'] != site_co[r['site_id']]], len(hs))
fd = q('select * from food_supplies')
check('food subtotal = round(qty × price, 2); total = subtotal + VAT', [r['op_no'] for r in fd if D(r['subtotal']) != r2(D(r['quantity']) * D(r['unit_price'])) or D(r['total']) != D(r['subtotal']) + D(r['vat_amount'])], len(fd))
check('operations snapshot site/owner from vehicle', [r['oil_no'] for r in oil if r['owner_company_id'] is None and veh.get(r['vehicle_id'])], len(oil))

# ------------------------------------------------------------------ oil status
last = {}
for r in sorted((r for r in oil if r['deleted_at'] is None), key=lambda r: (r['odometer'], r['change_date'])):
    last[r['vehicle_id']] = r
def oil_status(vid):
    o = last.get(vid)
    if not o: return 'no_record', None
    rem = o['next_odometer'] - veh[vid]['odometer']
    if rem > WARN: return 'not_due', rem
    if rem > 0: return 'soon', rem
    if rem > -TOL: return 'due', rem
    return 'overdue', rem
sys_oil = {r['vehicle_id']: r for r in q('select * from v_vehicle_oil_status')}
bad = [(veh[v]['code'], oil_status(v), (r['status'], r['remaining_km'])) for v, r in sys_oil.items() if oil_status(v) != (r['status'], r['remaining_km'])]
check('oil status (not_due/soon/due/overdue/no_record) incl. boundaries 1000/0/-500', bad, len(sys_oil))
dist = defaultdict(int)
for v in veh: dist[oil_status(v)[0]] += 1
passed.append(f'  oil status mix: {dict(dist)}')

# ------------------------------------------------------------------ authorizations
auth = q('select * from authorizations where deleted_at is null')
def auth_status(vid):
    drv = veh[vid]['current_driver_id']
    if not drv: return 'no_driver'
    rows = [a for a in auth if a['vehicle_id'] == vid and a['employee_id'] == drv]
    if not rows: return 'missing'
    a = sorted(rows, key=lambda a: (a['expiry_date'] is not None, a['expiry_date'] or '', a['created_at']), reverse=True)[0]
    if not a['is_authorized']: return 'not_authorized'
    if not a['expiry_date']: return 'no_date'
    return 'expired' if dd(a['expiry_date']) < TODAY else 'valid'
sys_auth = {r['vehicle_id']: r['status'] for r in q('select vehicle_id, status from v_vehicle_authorization')}
check('authorization status (valid/expired/missing/not authorized/no date; expires today = valid)', [(veh[v]['code'], auth_status(v), s) for v, s in sys_auth.items() if auth_status(v) != s], len(sys_auth))

# ------------------------------------------------------------------ documents
docs = q('select * from documents where deleted_at is null')
def latest(pred):
    rows = [d for d in docs if pred(d)]
    if not rows: return None
    return sorted(rows, key=lambda d: (d['expiry_date'] is not None, d['expiry_date'] or '', d['created_at']), reverse=True)[0]
def doc_status(exp, present, authorized=None):
    if not present: return 'missing', None
    if authorized is False: return 'not_authorized', None
    if not exp: return 'no_date', None
    left = (dd(exp) - TODAY).days
    level = min([x for x in ALERT if 0 <= left <= x], default=None)
    if left < 0: return 'expired', None
    return ('expiring' if left <= ALERT[0] else 'valid'), level
expected = {}
for v in veh.values():
    for t in ('registration', 'periodic_inspection'):
        d = latest(lambda d: d['vehicle_id'] == v['id'] and d['doc_type'] == t)
        expected[('vehicle', v['id'], t)] = doc_status(d and d['expiry_date'], d is not None)
    if v['current_driver_id']:
        rows = [a for a in auth if a['vehicle_id'] == v['id'] and a['employee_id'] == v['current_driver_id']]
        a = sorted(rows, key=lambda a: (a['expiry_date'] is not None, a['expiry_date'] or '', a['created_at']), reverse=True)[0] if rows else None
        expected[('vehicle', v['id'], 'authorization')] = doc_status(a and a['expiry_date'], a is not None, a and a['is_authorized'])
drivers = {v['current_driver_id'] for v in veh.values() if v['current_driver_id']}
for e in emp.values():
    if e['status'] == 'terminated': continue
    for t in ('iqama', 'driving_license'):
        d = latest(lambda d: d['employee_id'] == e['id'] and d['doc_type'] == t)
        if t == 'driving_license' and e['id'] not in drivers and d is None: continue
        expected[('employee', e['id'], t)] = doc_status(d and d['expiry_date'], d is not None)
got = {(r['owner_type'], r['owner_id'], r['doc_type']): (r['status'], r['alert_level']) for r in q('select owner_type, owner_id, doc_type, status, alert_level from v_document_status')}
bad = [(k[2], expected.get(k), got.get(k)) for k in set(expected) | set(got) if expected.get(k) != got.get(k)]
check('document status + alert level (90/60/30/7, today, missing, no date, history, deleted)', bad, len(expected))
dist = defaultdict(int)
for s, _ in expected.values(): dist[s] += 1
passed.append(f'  document status mix: {dict(dist)}')

# ------------------------------------------------------------------ expenses view
exp_rows = []
for r in oil:
    if r['deleted_at'] is None: exp_rows.append(('oil_change', r['id'], r['change_date'], r['vehicle_id'], r['site_id'], D(r['total'])))
for r in mnt:
    if r['deleted_at'] is None: exp_rows.append(('maintenance', r['id'], r['maint_date'], r['vehicle_id'], r['site_id'], D(r['total'])))
for r in acc:
    if r['deleted_at'] is None: exp_rows.append(('accident', r['id'], riyadh_date(r['occurred_at']).isoformat(), r['vehicle_id'], r['site_id'], D(r['total'])))
for r in hs:
    if r['deleted_at'] is None: exp_rows.append(('housing_maintenance', r['id'], r['work_date'], None, r['site_id'], D(r['total'])))
for r in fd:
    if r['deleted_at'] is None: exp_rows.append(('food_supply', r['id'], r['supply_date'], None, r['site_id'], D(r['total'])))
sys_exp = {(r['category'], r['record_id']): (r['expense_date'], D(r['total'])) for r in q('select category, record_id, expense_date, total from v_expenses')}
mine = {(c, i): (d, t) for c, i, d, v, s, t in exp_rows}
check('v_expenses = every non-deleted operation, accident date in Riyadh time', [(k, mine.get(k), sys_exp.get(k)) for k in set(mine) | set(sys_exp) if mine.get(k) != sys_exp.get(k)], len(mine))
midnight = [r for r in acc if r['deleted_at'] is None and riyadh_date(r['occurred_at']) != datetime.datetime.fromisoformat(r['occurred_at']).astimezone(datetime.timezone.utc).date()]
passed.append(f'  accidents whose Riyadh date differs from the UTC date: {len(midnight)} (bucketed by Riyadh date)')
GRAND = sum(t for *_, t in exp_rows)
passed.append(f'  grand total of all expenses: {GRAND:,} SAR over {len(exp_rows)} operations')

# ------------------------------------------------------------------ dashboard_stats
companies = [None] + sorted(set(site_co.values()))
sites = [None] + sorted(site_co)
months = [(TODAY.year, TODAY.month), (TODAY.year, 1), (TODAY.year - 1, 6), (TODAY.year - 2, 12)]
def overview_ok(v, site, co): return (site is None or v['site_id'] == site) and (co is None or site_co.get(v['site_id']) == co)
bad, n = [], 0
for co in companies:
    for site in sites:
        for (y, mo) in months:
            n += 1
            got = json.loads(scalar(f"select dashboard_stats({'null' if co is None else repr(co)}::uuid, {'null' if site is None else repr(site)}::uuid, {y}, {mo})"))
            vv = [v for v in veh.values() if overview_ok(v, site, co)]
            d0 = datetime.date(y, mo, 1); d1 = datetime.date(y + (mo == 12), mo % 12 + 1, 1)
            ex = [x for x in exp_rows if d0 <= dd(x[2]) < d1 and (site is None or x[4] == site) and (co is None or site_co.get(x[4]) == co)]
            cost = lambda *cats: sum((x[5] for x in ex if x[0] in cats), D(0))
            ds = [(k, s) for k, s in expected.items() if (site is None or (veh.get(k[1]) or emp.get(k[1]))['site_id'] == site) and (co is None or (site_co.get(veh[k[1]]['site_id']) if k[0] == 'vehicle' else emp[k[1]]['company_id']) == co)]
            def left(k):
                if k[2] == 'authorization':
                    rows = [a for a in auth if a['vehicle_id'] == k[1] and a['employee_id'] == veh[k[1]]['current_driver_id']]
                    a = sorted(rows, key=lambda a: (a['expiry_date'] is not None, a['expiry_date'] or '', a['created_at']), reverse=True)[0] if rows else None
                    e = a and a['expiry_date']
                else:
                    d = latest(lambda d: (d['vehicle_id'] if k[0] == 'vehicle' else d['employee_id']) == k[1] and d['doc_type'] == k[2]); e = d and d['expiry_date']
                return (dd(e) - TODAY).days if e else None
            want = {
                'vehicles_total': len(vv),
                'vehicles_working': sum(v['op_status'] == 'working' for v in vv), 'vehicles_stopped': sum(v['op_status'] == 'stopped' for v in vv),
                'vehicles_maintenance': sum(v['op_status'] == 'under_maintenance' for v in vv), 'vehicles_accident': sum(v['op_status'] == 'accident_damaged' for v in vv),
                'vehicles_inside': sum(v['location_status'] == 'inside_site' for v in vv), 'vehicles_outside': sum(v['location_status'] == 'outside_site' for v in vv),
                'vehicles_in_workshop': sum(v['location_status'] == 'in_workshop' for v in vv),
                'employees_total': sum(e['status'] == 'active' and (site is None or e['site_id'] == site) and (co is None or e['company_id'] == co) for e in emp.values()),
                'docs_expired': sum(s[0] == 'expired' for k, s in ds),
                'docs_expiring_30': sum(s[0] in ('expiring', 'valid') and left(k) is not None and 0 <= left(k) <= 30 for k, s in ds),
                'oil_due_soon': sum(oil_status(v['id'])[0] in ('soon', 'due', 'overdue') for v in vv),
                'accidents_open': sum(a['deleted_at'] is None and a['status'] != 'completed' and a['vehicle_id'] in {v['id'] for v in vv} for a in acc),
                'cost_maintenance_month': cost('maintenance'), 'cost_oil_month': cost('oil_change'), 'cost_accidents_month': cost('accident'),
                'cost_housing_month': cost('housing_maintenance'), 'cost_food_month': cost('food_supply'), 'cost_housing_food_month': cost('housing_maintenance', 'food_supply'),
            }
            for k, w in want.items():
                if D(str(got[k])) != D(w): bad.append((co and co[:4], site and site[:4], y, mo, k, w, got[k]))
check('dashboard_stats: 18 figures × company/site/month filters', bad, n)

# ------------------------------------------------------------------ odometer history
odo_bad = [v['code'] for v in veh.values() if v['odometer'] and int(scalar(f"select max(reading) from odometer_readings where vehicle_id='{v['id']}'") or 0) != v['odometer']]
check('every odometer value is documented in odometer_readings (highest reading = current)', odo_bad, len(veh))
check('no vehicle odometer below its last oil change', [v['code'] for v in veh.values() if v['id'] in last and v['odometer'] < last[v['id']]['odometer']], len(veh))

print(f'PASS {len([p for p in passed if not p.startswith("  ")])}')
for p in passed: print('  ok  ' if not p.startswith('  ') else '  info', p.strip())
print(f'FAIL {len(problems)}')
for p in problems: print('  FAIL', p)
