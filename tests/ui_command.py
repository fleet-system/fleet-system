"""v1.31: «غرفة العمليات»: الوضع الداكن المتوهج افتراضي، خريطة المزارع الحية في لوحة التحكم (من نفس بيانات السيارات)،
صفحة الترحيب ثلاثية الأبعاد خلف نموذج الدخول (three.js محلي في web/vendor)، وتبديل الشكل (داكن/فاتح) من الإعدادات.
Usage: python3 -I ui_command.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def new_ctx(b, w=1280, h=900, real=False):
    c = b.new_context(viewport={'width': w, 'height': h}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=1)
    if real: c.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false})")  # يشغّل الرسم ثلاثي الأبعاد
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def overflow(g, w, where): ok(g.evaluate('document.documentElement.scrollWidth') <= w, f'[{w}px] {where}: no horizontal overflow')

with sync_playwright() as p:
    b = p.chromium.launch()
    # 1) صفحة الترحيب ثلاثية الأبعاد
    for w, h in [(390, 844), (1360, 900)]:
        c, g = new_ctx(b, w, h, real=True)
        g.goto(BASE); g.wait_for_selector('form.login-card')
        ok(g.evaluate("document.documentElement.dataset.theme") == 'glass', f'[{w}] warm glass is the default (1.32)')
        ok(g.locator('.w3d .w3d-fallback').count() == 1, f'[{w}] CSS fallback scene present')
        try: g.wait_for_selector('.w3d-canvas.on', timeout=20000); drew = True
        except Exception: drew = False
        ok(drew, f'[{w}] no satellite tiles (offline) -> drawn 3D scene instead (local three.js)')
        ok(g.locator('.w3d-map').count() == 0, f'[{w}] satellite globe removed when tiles do not load')
        g.wait_for_timeout(800)
        import io
        from PIL import Image
        shot = Image.open(io.BytesIO(g.screenshot(clip={'x': 0, 'y': 0, 'width': w, 'height': 90}))).convert('RGB').resize((60, 12))
        px = len(shot.getcolors(1 << 16) or [])  # أعلى الشاشة (السماء والنجوم) فوق نموذج الدخول
        ok(px > 8, f'[{w}] 3D scene is not blank ({px} colors)')
        ok(g.locator('.login-card input[name=email]').is_visible() and g.locator('.login-card button[type=submit]').is_visible(), f'[{w}] login form usable above the scene')
        if w > 1000: ok('أسطولك' in g.inner_text('.w3d-hero'), '[desktop] welcome headline shown')
        overflow(g, w, 'login')
        g.screenshot(path=f'{OUT}/login-{w}.png')
        # بعد الدخول يُزال المشهد ويتوقف الرسم
        g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
        ok(g.locator('.w3d-canvas').count() == 0, f'[{w}] 3D scene removed after sign-in')
        c.close()
    # 1ب) مع صور القمر الصناعي (صور بديلة في الاختبار): الكرة الأرضية والنزول على المزارع الأربع
    from PIL import Image as _I
    tile = os.path.join(OUT, 'tile.jpg'); _I.new('RGB', (256, 256), (190, 150, 100)).save(tile)
    for w, h in [(390, 844), (1360, 900)]:
        c, g = new_ctx(b, w, h, real=True)
        seen = []
        g.route('**/World_Imagery/**', lambda r, *a: (seen.append(r.request.url), r.fulfill(path=tile, content_type='image/jpeg', headers={'Access-Control-Allow-Origin': '*'})))
        g.goto(BASE); g.wait_for_selector('form.login-card')
        try: g.wait_for_selector('.w3d-map.on', timeout=20000); real = True
        except Exception: real = False
        ok(real, f'[{w}] real satellite welcome shown')
        ok(g.locator('.w3d-pin').count() == 4, f'[{w}] 4 farm pins on the welcome globe')
        for _ in range(16):
            if len([u for u in seen if any(f'/tile/{z}/' in u for z in (13, 14, 15))]) >= 15: break
            g.wait_for_timeout(500)
        z15 = [u for u in seen if any(f'/tile/{z}/' in u for z in (13, 14, 15))]
        ok(len(z15) >= 15, f'[{w}] farm close-up tiles prefetched before the camera arrives ({len(z15)})')
        g.wait_for_timeout(11000)
        ok(g.locator('.w3d-canvas').count() == 0 and g.locator('.w3d-map').count() == 1, f'[{w}] satellite kept (no fallback) when tiles load')
        ok(g.locator('.login-card button[type=submit]').is_visible(), f'[{w}] login usable over the globe')
        overflow(g, w, 'login (satellite)')
        g.screenshot(path=f'{OUT}/login-sat-{w}.png')
        g.fill('input[name=email]', 'admin@test.local'); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
        g.wait_for_timeout(2000)
        ok(g.locator('.w3d-map').count() == 0, f'[{w}] welcome globe removed after sign-in')
        c.close()
    # 2) بدون WebGL/مكتبة (الاختبارات الآلية): يبقى البديل ولا أخطاء
    c, g = new_ctx(b)
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.wait_for_timeout(500)
    ok(g.locator('.w3d-canvas').count() == 0 and g.locator('.w3d-fallback').is_visible(), 'automated browser: CSS fallback only, no 3D')
    c.close()

    # 3) خريطة المزارع الحية = نفس بيانات السيارات
    for w in (1360, 390):
        c, g = new_ctx(b, w, 900); login(g)
        g.goto(f'{BASE}#/dashboard'); g.wait_for_selector('[data-fleet-map] .cc-real .cc-farm [data-car]'); g.wait_for_timeout(600)
        ok(g.locator('[data-fleet-map] svg').count() == 0, f'[{w}] real satellite map replaced the drawing')
        ok(g.locator('.cc-real .cc-farm').count() == 4, f'[{w}] 4 farms placed at their real locations')
        n_db = int(sql('select count(*) from v_vehicles_overview'))
        ok(g.locator('[data-fleet-map] [data-car]').count() == n_db, f'[{w}] map shows every vehicle ({n_db})')
        total = int(g.inner_text('.panel.fleet .big .num'))
        ok(total == n_db, f'[{w}] map count = dashboard total ({total})')
        for k in ['inside', 'outside', 'stopped', 'maintenance', 'accident', 'workshop']:
            box = int(g.inner_text(f'[data-fleet-place] [data-k={k}] b'))
            ok(g.locator(f'[data-fleet-map] [data-car].pl-{k}').count() == box, f'[{w}] map color «{k}» = dashboard box ({box})')
        # لكل موقع: عدد السيارات على الخريطة = عدد سياراته في قاعدة البيانات
        for sid, cnt in [r.split('|') for r in sql("select coalesce(site_id::text,''), count(*) from v_vehicles_overview group by 1").splitlines()]:
            if sid: ok(g.locator(f'[data-site-id="{sid}"] [data-car]').count() == int(cnt), f'[{w}] site {sid[:8]}: {cnt} vehicles on the map')
        names = g.inner_text('[data-fleet-map]')
        for nm in sql("select name from sites where is_active").splitlines(): ok(nm in names, f'[{w}] active site «{nm}» on the map')
        overflow(g, w, 'dashboard with map')
        g.screenshot(path=f'{OUT}/dashboard-{w}.png', full_page=True)
        # الضغط على سيارة يفتح بطاقتها بالمعرّف الداخلي
        car = g.locator('[data-fleet-map] [data-car]').first
        href = car.get_attribute('href'); plate = car.get_attribute('data-plate')
        if w > 1000:
            g.evaluate("document.querySelector('[data-fleet-map]').scrollIntoView({block: 'center'})"); g.wait_for_timeout(2500)  # بعد حركة الاقتراب
            car.dispatch_event('pointerover'); g.wait_for_timeout(200)
            ok(g.locator('.cc-info').is_visible() and plate in g.inner_text('.cc-info'), 'hover shows the vehicle plate')
        car.dispatch_event('click')
        g.wait_for_selector('.vhead'); vid = href.split('/')[-1]
        ok(sql(f"select plate_no from v_vehicles_overview where id = '{vid}'") == plate and plate in g.inner_text('.vhead'), f'[{w}] map dot opens the right vehicle card ({plate})')
        c.close()

    # 4) تغيير بيانات سيارة يظهر على الخريطة مباشرة (الحالة → اللون)
    c, g = new_ctx(b); login(g)
    vid = sql("select id from v_vehicles_overview where op_status <> 'accident_damaged' order by code limit 1")
    sql(f"update vehicles set op_status = 'accident_damaged' where id = '{vid}'")
    g.goto(f'{BASE}#/dashboard?r=1'); g.wait_for_selector('[data-fleet-map] [data-car]')
    ok('pl-accident' in (g.get_attribute(f'[data-fleet-map] [href="#/vehicles/{vid}"]', 'class') or ''), 'status change in the database shows on the map')

    # 5) 1.32: الزجاجي الدافئ افتراضي + تبديل الشكل من الإعدادات (يُحفظ على الجهاز)
    g.goto(f'{BASE}#/dashboard'); g.wait_for_selector('.panels')
    ok(g.evaluate("document.documentElement.dataset.theme") == 'glass', 'glass is the default theme')
    ok('blur' in g.evaluate("getComputedStyle(document.querySelector('.panel')).backdropFilter"), 'glass: panels are frosted (backdrop blur)')
    ok(g.evaluate("getComputedStyle(document.querySelector('.panel')).backgroundColor").startswith('rgba('), 'glass: panels are translucent')
    ok(g.locator('.page-head .greet').is_visible() and ('صباح الخير' in g.inner_text('.greet') or 'مساء الخير' in g.inner_text('.greet')), 'greeting shown on dashboard')
    for hid in ['accidents', 'housing', 'food']:
        ok(g.locator(f'.nav [data-nav="{hid}"], .nav a[href="#/{hid}"], .pop-add a[href^="#/{hid}"]').count() == 0, f'menu: «{hid}» hidden (owner request)')
    g.goto(f'{BASE}#/settings'); g.wait_for_selector('[data-theme-panel]')
    ok(g.locator('[data-theme-set]').count() == 3 and g.locator('[data-theme-set=glass].on').count() == 1, 'settings: 3 looks, glass selected')
    bg_glass = g.evaluate("getComputedStyle(document.body).backgroundColor")
    g.click('[data-theme-set=dark]'); g.reload(); g.wait_for_selector('[data-theme-panel]')
    ok(g.evaluate("document.documentElement.dataset.theme") == 'dark', 'dark choice kept after reload')
    bg_dark = g.evaluate("getComputedStyle(document.body).backgroundColor")
    g.click('[data-theme-set=light]')
    ok(g.evaluate("document.documentElement.dataset.theme") == 'light', 'switch to light')
    bg_light = g.evaluate("getComputedStyle(document.body).backgroundColor")
    ok(len({bg_glass, bg_dark, bg_light}) == 3, f'body color differs per look ({bg_glass} / {bg_dark} / {bg_light})')
    g.reload(); g.wait_for_selector('[data-theme-panel]')
    ok(g.evaluate("document.documentElement.dataset.theme") == 'light', 'light choice kept after reload')
    ok(g.evaluate("document.querySelector('meta[name=theme-color]').content") == '#1E4636', 'light: phone bar color restored')
    g.screenshot(path=f'{OUT}/settings-light.png', full_page=True)
    g.click('[data-theme-set=glass]'); g.reload(); g.wait_for_selector('[data-theme-panel]')
    ok(g.evaluate("document.documentElement.dataset.theme") == 'glass', 'back to glass after reload')
    ok(g.evaluate("document.querySelector('meta[name=theme-color]').content") == '#C9B6A4', 'glass: phone bar color')
    # الطباعة تبقى فاتحة: قواعد الأشكال داخل @media screen
    g.emulate_media(media='print')
    ok(g.evaluate("getComputedStyle(document.body).backgroundColor") in ('rgb(255, 255, 255)', 'rgb(241, 244, 240)'), 'print stays light')
    c.close()
    b.close()

for m in passed: print('ok  ', m)
for m in problems: print('FAIL', m)
print(f'PASS {len(passed)} FAIL {len(problems)}')
