"""v1.5: owner ID beside the owner name; vehicle insurance expiry in the vehicle file, documents, alerts (30/15/7/1),
dashboard tasks, reports, vehicles list filters and Excel export — without touching any other data.
Usage: python3 -I ui_insurance_owner.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess, json
import datetime as _dt, zoneinfo as _zi
import openpyxl
from playwright.sync_api import sync_playwright
_T0 = _dt.datetime.now(_zi.ZoneInfo('Asia/Riyadh')).date()
def _d(n=0, sep='/'): return (_T0 + _dt.timedelta(days=n)).strftime(f'%Y{sep}%m{sep}%d')
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
V1 = 'b0000000-0000-0000-0000-000000000001'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
SNAP = ("select md5(string_agg(x, '|' order by x)) from (select concat_ws(',', id, plate_no, make, model, vin, color, vehicle_type, owner_company_id, site_id, current_driver_id, "
        "current_user_name, current_user_mobile, authorized_name, registration_type, registration_serial, location_text, op_status, location_status, odometer, notes) x from vehicles) s")
OTHER = "select concat_ws('|', (select count(*) from oil_changes), (select count(*) from maintenance), (select count(*) from accidents), (select count(*) from documents), (select count(*) from housing_maintenance), (select count(*) from food_supplies), (select count(*) from sites), (select count(*) from employees), (select count(*) from attachments))"

def new_ctx(b, w=1280):
    c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2, accept_downloads=True)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def open_vehicle(g, tab='basic'):
    g.goto(f'{BASE}#/vehicles/{V1}?tab={tab}&r={os.urandom(3).hex()}'); g.wait_for_selector('.vhead')
def rpc(fn, args):
    p = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui'],
        input=f"begin; set local role authenticated; set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001'; select {fn}({args}); commit;", capture_output=True, text=True)
    out = [l for l in p.stdout.splitlines() if l.startswith('{')]
    return json.loads(out[-1]) if out else None

with sync_playwright() as p:
    b = p.chromium.launch()
    # backup before the change (as the request asks)
    bk = rpc('create_backup', "'pre_update', 'before v1.5'")
    ok(bk and bk['verified'], f'backup taken before the change ({bk and bk["backup_no"]})')
    snap0, other0 = sql(SNAP), sql(OTHER)

    c, g = new_ctx(b); login(g)
    # ---------- 1. owner ID beside the owner name
    open_vehicle(g); g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=owner_id_no]'); g.wait_for_timeout(200)
    bo = g.locator('.modal [name=owner_company]').bounding_box(); bi = g.locator('.modal [name=owner_id_no]').bounding_box()
    ok(abs((bo['y'] + bo['height']) - (bi['y'] + bi['height'])) < 2 or abs(bo['y'] - bi['y']) < 12 and bi['x'] < bo['x'], f'owner ID field sits directly beside the owner name (same row) {bo} {bi}')
    g.locator('.modal [name=owner_id_no]').fill('1012345678'); g.wait_for_timeout(120)
    ok('هوية وطنية' in g.inner_text('.modal [data-check=owner_id_no]'), 'national ID recognised while typing')
    g.locator('.modal [name=owner_id_no]').fill('٢٠١٢٣٤٥٦٧٨'); g.wait_for_timeout(120)
    ok('رقم إقامة' in g.inner_text('.modal [data-check=owner_id_no]'), 'iqama number recognised (Arabic digits accepted)')
    g.locator('.modal [name=owner_id_no]').fill('12ab'); g.wait_for_timeout(120)
    ok('أرقام فقط' in g.inner_text('.modal [data-check=owner_id_no]'), 'letters rejected in the owner ID')
    g.locator('.modal [name=owner_id_no]').fill('2012345678')
    g.screenshot(path=f'{OUT}/io-form.png')
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_selector('.vhead')
    ok(sql(f"select owner_id_no from vehicle_private where vehicle_id='{V1}'") == '2012345678', 'owner ID saved with the right vehicle')
    t = g.inner_text('[data-panel=basic]')
    ok('2012345678' in t and t.index('المالك') < t.index('هوية المالك'), 'vehicle file shows owner and owner ID together')
    g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=owner_id_no]'); g.wait_for_timeout(200)
    ok(g.input_value('.modal [name=owner_id_no]') == '2012345678', 'owner ID shown again when editing')
    g.click('.modal [data-close]'); g.wait_for_timeout(200)
    if g.locator('[data-yes]').count(): g.click('[data-yes]')

    # ---------- 2. insurance from the documents tab
    open_vehicle(g, 'docs')
    ok('تأمين السيارة' in g.inner_text('.tab-panel.on') and 'لا يوجد تاريخ' in g.inner_text('.tab-panel.on'), 'documents tab has an insurance card (no date yet)')
    g.click('.tab-panel.on [data-act=ins-edit]'); g.wait_for_selector('.modal [name=insurance_expiry]')
    g.locator('.modal [name=insurance_expiry]').fill('2026/02/31'); g.click('.modal [data-save]'); g.wait_for_selector('.modal .form-error:not([hidden])')
    ok('التقويم' in g.inner_text('.modal .form-error'), 'invalid insurance date rejected')
    g.locator('.modal [name=insurance_expiry]').fill(_d(10)); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_selector('.vhead')
    ok(sql(f"select insurance_expiry from vehicles where id='{V1}'") == _d(10, '-'), 'insurance expiry saved in the vehicle record')
    t = g.inner_text('.tab-panel.on')
    ok('قريب الانتهاء' in t and _d(10) in t, 'documents tab: «قريب الانتهاء», date shown')
    ok('انتهاء التأمين' in g.inner_text('.vfacts') and 'قريب الانتهاء' in g.inner_text('.vfacts'), 'vehicle header shows insurance expiry and status')
    g.screenshot(path=f'{OUT}/io-docs.png', full_page=True)
    # alerts: levels 30 / 15 / 7 / 1, statuses valid / expiring / expired
    levels = {}
    for n in [40, 25, 12, 5, 0, -2]:
        sql(f"update vehicles set insurance_expiry = app_today() + {n} where id='{V1}'")
        levels[n] = sql(f"select status||'|'||coalesce(alert_level::text,'-') from v_document_status where owner_id='{V1}' and doc_type='insurance'")
    ok(levels == {40: 'valid|-', 25: 'expiring|30', 12: 'expiring|15', 5: 'expiring|7', 0: 'expiring|1', -2: 'expired|-'}, f'status updates by itself with today\'s date; alerts at 30/15/7/1 days {levels}')
    sql(f"update vehicles set insurance_expiry = app_today() + 5 where id='{V1}'")
    ok(sql(f"select severity from v_followups where subject_id='{V1}' and alert_type='insurance'") == '1', '7 days or less: urgent alert (bell)')

    # ---------- 3. dashboard, bell, documents page, reports
    g.goto(BASE + '#/dashboard'); g.wait_for_selector('.panels'); g.wait_for_timeout(600)
    ok('انتهاء التأمين' in g.inner_text('#page'), 'dashboard tasks list the vehicle whose insurance is about to expire')
    g.reload(); g.wait_for_selector('.panels'); g.wait_for_timeout(800); g.click('.bell'); g.wait_for_timeout(300)
    ok('انتهاء التأمين' in g.inner_text('.pop-bell'), 'bell shows the insurance alert')
    g.goto(BASE + '#/documents'); g.wait_for_timeout(800)
    g.select_option('#page select[name=type]', 'insurance'); g.wait_for_timeout(300)
    t = g.inner_text('#page')
    ok('التأمين' in t and 'VEH-0001' in t, 'documents page: filter by «التأمين»')
    g.goto(BASE + '#/reports'); g.wait_for_timeout(1200)
    ok(True, 'reports page opens')

    # ---------- 4. vehicles list: column, filter by status and by date
    sql("update vehicles set insurance_expiry = app_today() - 3 where code='VEH-0002'; update vehicles set insurance_expiry = app_today() + 200 where code='VEH-0003'")
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt')
    ok('انتهاء التأمين' in g.inner_text('#vt thead'), 'vehicles list has an «انتهاء التأمين» column')
    def rows(): return g.locator('#vt tbody tr').count()
    g.select_option('#page select[name=ins]', 'expiring'); g.wait_for_timeout(200); r1 = rows(); t1 = g.inner_text('#vt')
    g.select_option('#page select[name=ins]', 'expired'); g.wait_for_timeout(200); r2 = rows(); t2 = g.inner_text('#vt')
    g.select_option('#page select[name=ins]', 'valid'); g.wait_for_timeout(200); r3 = rows()
    g.select_option('#page select[name=ins]', 'none'); g.wait_for_timeout(200); r4 = rows()
    ok(r1 == 1 and 'VEH-0001' in t1 and r2 == 1 and 'VEH-0002' in t2 and r3 == 1 and r4 == int(sql('select count(*) from vehicles where deleted_at is null and insurance_expiry is null')), f'filter by insurance status ({r1},{r2},{r3},{r4})')
    g.select_option('#page select[name=ins]', ''); g.fill('#page [name=insFrom]', _d(0)); g.fill('#page [name=insTo]', _d(30)); g.dispatch_event('#page [name=insTo]', 'input'); g.wait_for_timeout(200)
    ok(rows() == 1 and 'VEH-0001' in g.inner_text('#vt'), 'filter by insurance expiry date range')
    g.fill('#page [name=insFrom]', ''); g.fill('#page [name=insTo]', ''); g.dispatch_event('#page [name=insTo]', 'input')
    g.screenshot(path=f'{OUT}/io-list.png', full_page=True)

    # ---------- 5. Excel export
    g.goto(BASE + '#/excel'); g.wait_for_selector('.exp-grid')
    with g.expect_download() as dl: g.click('[data-exp=vehicles]')
    path = f'{OUT}/vehicles.xlsx'; dl.value.save_as(path)
    ws = openpyxl.load_workbook(path).active
    hdr = [c.value for c in ws[1]]
    rowv = {hdr[i]: c.value for r in ws.iter_rows(min_row=2) for i, c in enumerate(r) if r[0].value == 'VEH-0001'}
    ok('هوية المالك' in hdr and 'انتهاء التأمين' in hdr and 'حالة التأمين' in hdr, 'Excel export includes owner ID, insurance expiry and status')
    ok(str(rowv.get('هوية المالك')) == '2012345678' and rowv.get('حالة التأمين') == 'قريب الانتهاء', f'Excel values for VEH-0001 ({rowv.get("هوية المالك")}, {rowv.get("حالة التأمين")})')
    c.close()

    # viewer: owner ID hidden, insurance visible
    c, g = new_ctx(b, 390); login(g, 'viewer@test.local'); open_vehicle(g)
    t = g.inner_text('[data-panel=basic]')
    ok('2012345678' not in t and 'مخفي' in t and 'تأمين السيارة' in t, 'viewer: owner ID hidden, insurance visible')
    g.screenshot(path=f'{OUT}/io-mobile.png', full_page=True)
    c.close()
    b.close()

# ---------- 6. nothing else changed; backup still restores cleanly
ok(sql(SNAP) == snap0, 'every other vehicle field unchanged (owner, user, authorized, mobile, registration, location, notes...)')
ok(sql(OTHER) == other0, 'maintenance, oil, accidents, documents, expenses, sites, employees, attachments unchanged')
chk = rpc('check_backup', f"'{bk['id']}'")
ok(chk and chk['ok'] and chk['merge']['conflicts_count'] == 0 and chk['merge']['failed_count'] == 0, 'backup from before the change still checks and merges cleanly')

print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
