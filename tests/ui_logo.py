"""Logo replacement (1.7): the new logo shows on the login page, sidebar, top bar, favicon,
home-screen icon and app manifest; every image loads, keeps its aspect ratio and is not cropped;
the rest of the app (data on the dashboard) still works. Usage: python3 -I ui_logo.py OUTDIR"""
import sys, os, json, urllib.request
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def check(ok, name): (passed if ok else problems).append(name)

# static files exist and are real PNGs of the expected size
from PIL import Image
WEB = os.path.join(os.path.dirname(__file__), '..', 'web')
for f, size in [('logo.png', None), ('logo-mark.png', (192, 192)), ('icon-192.png', (192, 192)), ('icon-512.png', (512, 512)),
                ('apple-touch-icon.png', (180, 180)), ('favicon-32.png', (32, 32)), ('favicon-48.png', (48, 48))]:
    im = Image.open(os.path.join(WEB, f)); check(im.format == 'PNG' and (size is None or im.size == size), f'{f} is a PNG {im.size}')
man = json.load(open(os.path.join(WEB, 'manifest.webmanifest'), encoding='utf-8'))
check([i['src'] for i in man['icons']] == ['icon-192.png', 'icon-512.png'], 'manifest uses the new icons')
check(os.path.exists(os.path.join(WEB, 'icon.svg')), 'old icon kept (not deleted)')

def imgs_ok(pg, sel, tag):
    info = pg.eval_on_selector_all(sel, '''els => els.map(e => ({src: e.getAttribute("src"), ok: e.complete && e.naturalWidth > 0,
        nr: e.naturalWidth / e.naturalHeight, rr: e.getBoundingClientRect().width / e.getBoundingClientRect().height,
        w: e.getBoundingClientRect().width, fit: getComputedStyle(e).objectFit}))''')
    check(len(info) > 0, f'[{tag}] {sel} present')
    for i in info:
        check(i['ok'], f'[{tag}] {i["src"]} loaded')
        check(abs(i['nr'] - i['rr']) < 0.03, f'[{tag}] {i["src"]} not stretched ({i["nr"]:.3f} vs {i["rr"]:.3f})')
        check(i['fit'] == 'contain', f'[{tag}] {i["src"]} object-fit contain (no crop)')
        check(i['w'] >= 30, f'[{tag}] {i["src"]} visible width {i["w"]:.0f}')
    return info

with sync_playwright() as p:
    b = p.chromium.launch()
    for tag, vp in [('mobile', {'width': 390, 'height': 844}), ('desktop', {'width': 1360, 'height': 900})]:
        ctx = b.new_context(viewport=vp, device_scale_factor=2, locale='ar-SA', timezone_id='Asia/Riyadh')
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('response', lambda r: r.status >= 400 and r.url.endswith('.png') and errs.append(f'{r.status} {r.url}'))
        pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        pg.goto(BASE); pg.wait_for_selector('form.login-card'); pg.wait_for_load_state('networkidle')
        imgs_ok(pg, '.login-brand img', tag)
        pg.screenshot(path=f'{OUT}/{tag}-login.png')
        heads = pg.eval_on_selector_all('link[rel~=icon], link[rel=apple-touch-icon]', 'els => els.map(e => e.getAttribute("href"))')
        check(heads == ['favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png'], f'[{tag}] favicon links {heads}')
        for h in heads:
            r = pg.request.get(BASE + h); check(r.ok and r.headers.get('content-type', '').startswith('image/png'), f'[{tag}] {h} served as png')
        pg.fill('input[name=email]', 'admin@test.local'); pg.fill('input[name=password]', 'test1234'); pg.click('button[type=submit]')
        pg.wait_for_selector('.panels'); pg.wait_for_load_state('networkidle')
        imgs_ok(pg, '.topbar .tb-logo', tag)
        if tag == 'desktop':
            imgs_ok(pg, '.sidebar .brand-logo img', tag)
            check('نظام إدارة الأسطول' in pg.inner_text('.sidebar .brand'), '[desktop] sidebar title kept')
            check('1.26' in pg.inner_text('.sidebar .brand'), '[desktop] version 1.26 shown')
        check('نظام إدارة الأسطول والمواقع الزراعية' in pg.inner_text('.tb-name'), f'[{tag}] top bar title kept')
        check(pg.inner_text('.tb-company').strip() == 'شركة روى الرمال الزراعية' and pg.is_visible('.tb-company'), f'[{tag}] company name beside the logo in the top bar')
        txt = pg.inner_text('#page'); check('لوحة التحكم' in txt and 'المهام التي تحتاج إلى متابعة' in txt, f'[{tag}] dashboard data still shows')
        pg.screenshot(path=f'{OUT}/{tag}-dashboard.png')
        # vehicles list still loads data
        pg.goto(BASE + '#/vehicles'); pg.wait_for_selector('#page table, #page .card-list, #page .vlist', timeout=15000)
        check(pg.locator('#page').inner_text().count('ر') > 0, f'[{tag}] vehicles page renders')
        check(not errs, f'[{tag}] no page errors / broken images {errs}')
        ctx.close()
    b.close()

for x in passed: print('PASS', x)
for x in problems: print('FAIL', x)
print(f'PASS {len(passed)} FAIL {len(problems)}')
sys.exit(1 if problems else 0)
