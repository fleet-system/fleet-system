"""v1.11: Settings -> «ملف Excel المربوط» (admin only): create a link (key shown once, only its SHA-256 stored),
new link replaces the old one, turn off, viewers cannot see it. Usage: python3 -I ui_excel_link.py OUTDIR"""
import sys, os, subprocess, hashlib, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def cfg():
    v = sql("select value from app_settings where key='excel_feed'")
    return json.loads(v) if v else None
def new_ctx(b, w=1280):
    c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2)
    c.grant_permissions(['clipboard-read', 'clipboard-write'])
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def settings(g): g.goto(f'{BASE}#/settings?r={os.urandom(3).hex()}'); g.wait_for_selector('.page-head')

before = sql("select md5(string_agg(key || value::text, '|' order by key)) from app_settings where key <> 'excel_feed'")
with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = new_ctx(b); login(g); settings(g)
    ok(g.locator('.excel-link').count() == 1 and 'غير مفعّل' in g.inner_text('.excel-link'), 'admin sees «ملف Excel المربوط», not active yet')
    ok('بدون' in g.inner_text('.excel-link') and 'الجوالات' in g.inner_text('.excel-link'), 'explains no sensitive numbers')
    g.click('[data-act=xl-new]'); g.wait_for_selector('.xl-url')
    url = g.input_value('.xl-url'); key = url.split('key=')[1]
    ok('/functions/v1/excel-feed?key=' in url and url.startswith(('https://pemyrokrbqzwvtretawa.supabase.co/', 'http://localhost:8787/')), f'link points to the function [{url[:60]}]')
    ok(len(key) >= 40, f'key is long and random ({len(key)} chars)')
    c1 = cfg()
    ok(c1 and c1['hash'] == hashlib.sha256(key.encode()).hexdigest() and c1['enabled'] is True, 'only the SHA-256 of the key is stored')
    ok(key not in sql("select value::text from app_settings where key='excel_feed'") and key not in sql("select coalesce(string_agg(new_data::text, ''), '') from audit_log where table_name='app_settings'"), 'the key itself is not saved anywhere (settings or audit log)')
    ok(g.locator('.xl-steps[open]').count() == 1 and 'من ويب' in g.inner_text('.xl-steps'), 'Excel steps shown')
    g.click('[data-act=xl-copy]'); g.wait_for_timeout(300)
    ok(g.evaluate('navigator.clipboard.readText()') == url, 'copy button copies the link')
    g.screenshot(path=f'{OUT}/1-created.png', full_page=True)
    # the link is shown once: after reload only the status is visible
    settings(g)
    ok(g.locator('.xl-url').count() == 0 and 'مفعّل' in g.inner_text('.excel-link'), 'key not shown again after reload')
    # a new link replaces the old one
    g.click('[data-act=xl-new]'); g.wait_for_selector('.modal [data-yes]'); g.click('.modal [data-yes]'); g.wait_for_selector('.xl-url')
    key2 = g.input_value('.xl-url').split('key=')[1]
    ok(key2 != key and cfg()['hash'] == hashlib.sha256(key2.encode()).hexdigest(), 'new link replaces the old one (old key no longer valid)')
    # turn off
    settings(g); g.click('[data-act=xl-off]'); g.wait_for_selector('.modal [data-yes]'); g.click('.modal [data-yes]'); g.wait_for_timeout(800)
    ok(cfg()['enabled'] is False and 'غير مفعّل' in g.inner_text('.excel-link'), 'link turned off')
    c.close()
    # mobile
    c, g = new_ctx(b, 390); login(g); settings(g)
    g.locator('.excel-link').scroll_into_view_if_needed(); g.screenshot(path=f'{OUT}/2-mobile.png')
    ok(g.evaluate('document.documentElement.scrollWidth') <= 391, 'mobile: no horizontal overflow')
    c.close()
    # viewer: nothing
    c, g = new_ctx(b); login(g, 'viewer@test.local'); settings(g)
    ok(g.locator('.excel-link').count() == 0, 'viewer does not see the Excel link section')
    c.close(); b.close()
ok(sql("select md5(string_agg(key || value::text, '|' order by key)) from app_settings where key <> 'excel_feed'") == before, 'no other setting changed')

for x in passed: print('PASS', x)
for x in problems: print('FAIL', x)
print(f'PASS {len(passed)} FAIL {len(problems)}')
sys.exit(1 if problems else 0)
