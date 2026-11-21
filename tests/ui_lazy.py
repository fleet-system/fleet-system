"""v1.39: تسريع الفتح: الصفحات تُحمَّل عند فتحها فقط، وكل صفحات القائمة تفتح بلا أخطاء. بيانات وهمية فقط.
Usage: python3 -I ui_lazy.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, re
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'js', 'app.js'), encoding='utf-8').read()
ok(not re.search(r"^import .* from '\./pages/(?!login)", src, re.M), 'app.js has no static page imports except login')
ok("FN.renderDashboard" in src and "'./pages/office.js'" in src, 'lazy table present')
ids = re.findall(r"\{ id: '([a-z]+)'", src)
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={'width': 390, 'height': 844}, locale='ar-SA', timezone_id='Asia/Riyadh')
    g = c.new_page(); errs = []
    g.on('pageerror', lambda e: errs.append(str(e)))
    urls = []; g.on('request', lambda r: urls.append(r.url))
    g.goto(BASE); g.wait_for_selector('form.login-card')
    pages_before = [u for u in urls if '/js/pages/' in u]
    ok(all(('login' in u or 'dashboard' in u or u.split('/js/pages/')[1].split('?')[0] in ('settings.js','vehicles.js','renewal.js','predict.js')) for u in pages_before), f'login screen loads only login + dashboard deps ({len(pages_before)} page files)')
    ok(not any('/pages/office.js' in u or '/pages/costs.js' in u or '/pages/vehicle.js' in u for u in urls), 'heavy pages not loaded at login')
    g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]')
    g.wait_for_selector('.panels')
    ok(True, 'dashboard renders after login')
    for pid in ids + ['search?q=1']:
        g.evaluate(f"location.hash = '#/{pid}'")
        try:
            g.wait_for_function("() => !document.querySelector('#page .view .loading')", timeout=20000); done = True
        except Exception: done = False
        txt = g.inner_text('#page')
        ok(done and 'تعذر' not in txt[:200], f'#{pid} opens')
    g.evaluate("location.hash = '#/vehicles'"); g.wait_for_function("() => !document.querySelector('#page .view .loading')", timeout=20000)
    vid = g.evaluate("(document.querySelector('a[href^=\"#/vehicles/\"]')||{}).getAttribute ? document.querySelector('a[href^=\"#/vehicles/\"]').getAttribute('href') : ''")
    if vid:
        g.evaluate(f"location.hash = '{vid}'"); g.wait_for_function("() => !document.querySelector('#page .view .loading')", timeout=20000)
        ok(g.locator('#page .view').count() == 1, 'vehicle card opens (lazy vehicle.js)')
    g.reload(); g.wait_for_selector('#page .view', timeout=20000)
    ok(True, 'reload while signed in works')
    ok(not errs, f'no page errors {errs[:3]}')
    b.close()
for m in passed: print('PASS', m)
for m in problems: print('FAIL', m)
print(f'PASS {len(passed)} FAIL {len(problems)}')
