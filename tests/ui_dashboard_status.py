"""v1.13: dashboard vehicle breakdown: «داخل المواقع» / «خارج المواقع» count working vehicles only, and
«متوقفة» / «متضررة بحادث» / «في الورشة» have their own counters (the five add up to the total).
The vehicle card «الحالة التشغيلية» (أخرى: متوقفة / متضررة بحادث / في الورشة) now drives the dashboard status,
but editing another card field never resets a status recorded by a maintenance or accident record.
Usage: python3 -I ui_dashboard_status.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
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
def dash(g):
    g.goto(f'{BASE}#/dashboard?r={os.urandom(3).hex()}'); g.wait_for_selector('[data-fleet-place]'); g.wait_for_timeout(300)
    return {k: int(g.inner_text(f'[data-fleet-place] [data-k={k}] b')) for k in ['inside', 'outside', 'stopped', 'accident', 'workshop']}
def total(g): return int(g.inner_text('.panel.fleet .big .num'))
V = {n: f'b0000000-0000-0000-0000-00000000000{n}' for n in range(1, 6)}
def edit(g, vid):
    g.goto(f'{BASE}#/vehicles/{vid}?tab=basic&r={os.urandom(3).hex()}'); g.wait_for_selector('.vhead')
    g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=op_state]'); g.wait_for_timeout(250)
def save(g):
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_timeout(400)
def st(vid): return sql(f"select op_status from vehicles where id = '{vid}'")

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = new_ctx(b); login(g)
    d = dash(g); t = total(g)
    ok(d == {'inside': 1, 'outside': 1, 'stopped': 1, 'accident': 1, 'workshop': 1}, f'seed: one vehicle in each box {d}')
    ok(sum(d.values()) == t, f'the five boxes add up to the total ({sum(d.values())} = {t})')
    labels = g.inner_text('[data-fleet-place]')
    ok(all(x in labels for x in ['داخل المواقع', 'خارج المواقع', 'متوقفة', 'متضررة بحادث', 'في الورشة']), 'labels shown')
    # interactive colors: bar segments + boxes share colors; picking one highlights it and shows count / percent
    ok(g.locator('.fleet-bar .seg[data-pick]').count() == 5, 'bar has one coloured part per box')
    cols = g.evaluate("[...document.querySelectorAll('[data-fleet-place] .dot')].map(d => getComputedStyle(d).backgroundColor)")
    ok(len(set(cols)) == 5, f'five different colours {cols}')
    seg_col = g.evaluate("getComputedStyle(document.querySelector('.fleet-bar .seg[data-pick=accident]')).backgroundColor")
    ok(seg_col == cols[3], 'box colour matches its bar colour')
    g.click('.fleet-bar .seg[data-pick=accident]'); g.wait_for_timeout(250)
    info = g.inner_text('[data-pick-info]')
    ok('متضررة بحادث' in info and '1' in info and '20%' in info, f'clicking a colour shows its count and percent [{info}]')
    ok(g.locator('.place-btn.on[data-pick=accident]').count() == 1 and g.locator('.panel.fleet.has-pick').count() == 1, 'the matching box is highlighted, others dimmed')
    g.screenshot(path=f'{OUT}/1-picked.png')
    g.click('.place-btn[data-pick=accident]'); g.wait_for_timeout(250)
    ok(g.locator('.panel.fleet.has-pick').count() == 0 and 'اضغط' in g.inner_text('[data-pick-info]'), 'clicking again clears the selection')
    g.click('.place-btn[data-pick=outside]'); g.wait_for_timeout(250)
    ok('خارج المواقع' in g.inner_text('[data-pick-info]') and g.locator('.fleet-bar .seg.on[data-pick=outside]').count() == 1, 'clicking a box highlights its colour in the bar')
    g.screenshot(path=f'{OUT}/1-dashboard.png', full_page=True)

    # card: working inside -> other «متوقفة»
    edit(g, V[1]); g.select_option('.modal [name=op_state]', value='other'); g.fill('.modal [name=op_state_text]', 'متوقفة'); save(g)
    ok(st(V[1]) == 'stopped', f'card «أخرى: متوقفة» -> dashboard status stopped [{st(V[1])}]')
    d = dash(g); ok(d['stopped'] == 2 and d['inside'] == 0, f'dashboard moves it to «متوقفة» {d}')
    # card: -> «متضررة بحادث»
    edit(g, V[1]); g.fill('.modal [name=op_state_text]', 'متضررة بحادث'); save(g)
    ok(st(V[1]) == 'accident_damaged', f'card «أخرى: متضررة بحادث» -> accident_damaged [{st(V[1])}]')
    d = dash(g); ok(d['accident'] == 2 and d['stopped'] == 1, f'dashboard moves it to «متضررة بحادث» {d}')
    # card: back to working inside
    edit(g, V[1]); g.select_option('.modal [name=op_state]', value='inside'); save(g)
    ok(st(V[1]) == 'working', f'back to «تعمل داخل الموقع» -> working [{st(V[1])}]')
    d = dash(g); ok(d['inside'] == 1 and d['accident'] == 1, f'dashboard back to inside {d}')
    # editing another field keeps a status recorded elsewhere (accident record)
    before = st(V[4])
    edit(g, V[4]); g.fill('.modal [name=notes]', 'ملاحظة اختبار'); save(g)
    ok(st(V[4]) == before == 'accident_damaged', f'editing notes keeps the accident status [{before} -> {st(V[4])}]')
    # mobile layout
    c.close(); c, g = new_ctx(b, 390); login(g); d = dash(g)
    ok(g.evaluate('document.documentElement.scrollWidth') <= 391, 'mobile: no horizontal overflow')
    g.locator('[data-fleet-place]').scroll_into_view_if_needed(); g.screenshot(path=f'{OUT}/2-mobile.png')
    c.close(); b.close()

for x in passed: print('PASS', x)
for x in problems: print('FAIL', x)
print(f'PASS {len(passed)} FAIL {len(problems)}')
sys.exit(1 if problems else 0)
