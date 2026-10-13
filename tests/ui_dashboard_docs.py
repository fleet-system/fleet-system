"""v1.15: dashboard card «وثائق السيارات» under the vehicles card: for each vehicle status box (داخل/خارج المواقع،
متوقفة، تحت الصيانة، متضررة بحادث، في الورشة) the number of expired vehicle documents (رخصة السير، الفحص الدوري، التأمين)
and how many end within 30 days; clicking a box lists its vehicles; the list «أقرب الوثائق انتهاءً» shows each vehicle's
nearest document ending within 30 days, soonest first, linked to the vehicle card. Changing a date in the card updates it.
Usage: python3 -I ui_dashboard_docs.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess, json
import datetime as _dt, zoneinfo as _zi
from playwright.sync_api import sync_playwright
_T0 = _dt.datetime.now(_zi.ZoneInfo('Asia/Riyadh')).date()
def _d(n=0, sep='/'): return (_T0 + _dt.timedelta(days=n)).strftime(f'%Y{sep}%m{sep}%d')
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def new_ctx(b, w=1280):
    c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def dash(g): g.goto(f'{BASE}#/dashboard?r={os.urandom(3).hex()}'); g.wait_for_selector('[data-vdocs]'); g.wait_for_timeout(300)
def boxes(g): return {k: int(g.inner_text(f'[data-vdocs] [data-dpick={k}] b')) for k in ['inside', 'outside', 'stopped', 'maintenance', 'accident', 'workshop']}
def place(op, loc):
    if op == 'stopped': return 'stopped'
    if op == 'accident_damaged': return 'accident'
    if op == 'under_maintenance': return 'maintenance'
    if loc == 'in_workshop': return 'workshop'
    return 'outside' if loc == 'outside_site' else 'inside'
def expected():
    rows = json.loads(sql("select coalesce(json_agg(t), '[]') from (select v.op_status, v.location_status, d.days_left, v.plate_no, d.doc_type from v_document_status d join vehicles v on v.id = d.owner_id and v.deleted_at is null where d.owner_type = 'vehicle' and d.doc_type in ('registration','periodic_inspection','insurance') and d.days_left is not null) t"))
    exp = {k: 0 for k in ['inside', 'outside', 'stopped', 'maintenance', 'accident', 'workshop']}
    for r in rows:
        if r['days_left'] < 0: exp[place(r['op_status'], r['location_status'])] += 1
    return exp, rows
V = {n: f'b0000000-0000-0000-0000-00000000000{n}' for n in range(1, 6)}
# test data (fake): insurance dates relative to today
sql(f"update vehicles set insurance_expiry = app_today() - 3 where id = '{V[1]}'; update vehicles set insurance_expiry = app_today() + 2 where id = '{V[2]}'; update vehicles set insurance_expiry = app_today() + 12 where id = '{V[5]}'; update vehicles set insurance_expiry = app_today() - 40 where id = '{V[4]}'")

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = new_ctx(b); login(g); dash(g)
    exp, rows = expected(); got = boxes(g)
    ok(got == exp, f'expired documents per status box match the database {got} vs {exp}')
    ok(g.locator('.panel.fleet + .panel.vdocs').count() == 1, 'card is directly under the vehicles card')
    txt = g.inner_text('[data-vdocs]')
    ok(all(x in txt for x in ['رخصة السير', 'الفحص الدوري', 'التأمين']), 'says which documents are counted')
    # nearest list: one per vehicle, soonest first, within 30 days, never expired
    soon = g.evaluate("[...document.querySelectorAll('[data-vdoc-soon] .vdoc-row')].map(a => ({ t: a.querySelector('.tag').textContent, plate: a.querySelector('.plate').textContent }))")
    days = [0 if 'اليوم' in s['t'] else int(''.join(ch for ch in s['t'] if ch.isdigit())) for s in soon]
    ok(len(soon) >= 2 and days == sorted(days) and all(0 <= d <= 30 for d in days), f'nearest list sorted soonest first within 30 days {days}')
    ok(len({s['plate'] for s in soon}) == len(soon), 'one row per vehicle (its nearest document)')
    want = min([r for r in rows if 0 <= r['days_left'] <= 30], key=lambda r: r['days_left'])
    ok(soon and soon[0]['plate'] == want['plate_no'], f'first row is the vehicle whose document ends first [{soon[0]["plate"] if soon else ""} / {want["plate_no"]}]')
    g.screenshot(path=f'{OUT}/1-card.png', full_page=True)
    # click a box: its expired + soon documents
    g.click('[data-vdocs] [data-dpick=accident]'); g.wait_for_timeout(250)
    lst = g.inner_text('[data-vdocs-list]')
    ok('متضررة بحادث' in lst and 'ط ع ق 1357' in lst and 'منتهية منذ 40 يوم' in lst, f'box lists its vehicles and documents')
    g.screenshot(path=f'{OUT}/2-picked.png', full_page=True)
    g.click('[data-vdocs] [data-dpick=accident]'); g.wait_for_timeout(250)
    ok(g.locator('[data-vdoc-soon]').count() == 1, 'clicking again returns to the nearest list')
    # link to the vehicle card (documents tab)
    g.click('[data-vdoc-soon] .vdoc-row >> nth=0'); g.wait_for_selector('.vhead')
    ok('tab=docs' in g.url and want['plate_no'] in g.inner_text('.vhead'), 'row opens the vehicle card on its documents')
    # live: change the insurance date in the card -> dashboard updates
    before = boxes(g) if False else None
    g.goto(f'{BASE}#/vehicles/{V[1]}?tab=basic&r=1'); g.wait_for_selector('.vhead'); g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=insurance_expiry]')
    g.fill('.modal [name=insurance_expiry]', _d(5)); g.locator('.modal [name=insurance_expiry]').dispatch_event('input')
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_timeout(400)
    dash(g); exp2, _ = expected(); got2 = boxes(g)
    ok(got2 == exp2 and got2['inside'] == exp['inside'] - 1, f'renewing the insurance in the card removes it from «منتهية» {got2}')
    soon2 = g.inner_text('[data-vdoc-soon]')
    ok('أ ب ج 1234' in soon2 and 'باقي 5 يوم' in soon2, 'and it appears in the nearest list with the new date')
    # mobile
    c.close(); c, g = new_ctx(b, 390); login(g); dash(g)
    ok(g.evaluate('document.documentElement.scrollWidth') <= 391, 'mobile: no horizontal overflow')
    g.locator('[data-vdocs]').scroll_into_view_if_needed(); g.screenshot(path=f'{OUT}/3-mobile.png', full_page=True)
    c.close(); b.close()

for x in passed: print('PASS', x)
for x in problems: print('FAIL', x)
print(f'PASS {len(passed)} FAIL {len(problems)}')
sys.exit(1 if problems else 0)
