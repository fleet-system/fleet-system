"""Phase 5 browser test: housing, food, attachments (upload, view, permissions, image shrink).
Requires fresh fleet_ui DB and mock server. Usage: python3 -I ui_phase5.py OUTDIR"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
import datetime as _dt, zoneinfo as _zi
_T0 = _dt.datetime.now(_zi.ZoneInfo('Asia/Riyadh')).date()
def _d(n=0, sep='/'): return (_T0 + _dt.timedelta(days=n)).strftime(f'%Y{sep}%m{sep}%d')

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
BASE = 'http://localhost:8787/'
V1 = 'b0000000-0000-0000-0000-000000000001'
E1 = 'e0000000-0000-0000-0000-000000000001'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'fleet_ui', '-Atc', q], capture_output=True, text=True).stdout.strip()

def login(pg, email):
    pg.goto(BASE); pg.wait_for_selector('form.login-card')
    pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'test1234'); pg.click('button[type=submit]'); pg.wait_for_selector('.panels')

def fill(pg, vals):
    for n, v in vals.items():
        el = pg.locator(f'.modal [name="{n}"]').last
        if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(value=v)
        elif el.get_attribute('type') == 'checkbox': el.check() if v else el.uncheck()
        else: el.fill(v)

def upload(pg, button_sel, files, category=None, scope='body'):
    with pg.expect_file_chooser() as fc:
        pg.locator(f'{scope} {button_sel}').last.click()
    fc.value.set_files([os.path.join(FX, f) for f in files])
    pg.wait_for_selector('.modal [name=category]')
    if category: pg.locator('.modal [name=category]').last.select_option(category)
    pg.locator('.modal [data-save]').last.click()
    pg.wait_for_selector('.modal [name=category]', state='detached', timeout=30000)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='ar-SA', timezone_id='Asia/Riyadh')
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and '400' not in m.text and problems.append(f'console: {m.text}'))
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    login(pg, 'admin@test.local')

    # ---------------- housing ----------------
    pg.goto(BASE + '#/housing'); pg.wait_for_selector('.list-body')
    ok(pg.locator('.list-body tbody tr').count() == 2, 'housing list shows seed records')
    pg.click('[data-list-add]'); pg.wait_for_selector('.modal')
    fill(pg, {'site_id': [o for o in pg.locator('.modal [name=site_id] option').evaluate_all('os => os.map(o => [o.value, o.textContent])') if 'مشتل' in o[1]][0][0],
              'contractor': 'مقاول تجريبي', 'description': 'إصلاح سباكة السكن', 'invoice_no': 'H-55', 'subtotal': '1000', 'with_vat': True, 'payment_status': 'paid'})
    pg.wait_for_timeout(150); t = pg.inner_text('.modal [data-live=calc]')
    ok('150.00' in t and '1,150.00' in t, 'housing live: 1000 + VAT 150 = 1,150')
    pg.click('.modal [data-save]'); pg.wait_for_selector('.modal', state='detached'); pg.wait_for_selector('.list-body tbody tr:nth-child(3)')
    ok(sql("select company_id::text||'|'||total||'|'||coalesce(paid_date::text,'') from housing_maintenance where invoice_no='H-55'").startswith('22222222-2222-2222-2222-222222222222|1150.00|' + _d(0, '-')),
       'housing saved: company from site, total 1150, paid date auto = today')
    tot = pg.inner_text('.list-total'); ok('3,220.00' in tot, 'housing list total 1380 + 690 + 1150 = 3,220')
    ok('مشتل الغملاس' in pg.inner_text('.sums') and 'شركة عبد الرحمن الفهاد' in pg.inner_text('.sums'), 'summary by site and company shown')
    pg.screenshot(path=f'{OUT}/p5-housing.png', full_page=True)

    # attach invoice to housing record
    pg.locator('[data-row-act=att]').first.click(); pg.wait_for_selector('.modal .att-box [data-up-file]')
    upload(pg, '[data-up-file]', ['invoice.jpg', 'doc.pdf'], 'housing_invoice', '.modal')
    pg.wait_for_selector('.modal .att-grid figure:nth-child(2)')
    ok(pg.locator('.modal .att-grid figure').count() == 2, 'two files uploaded to housing record (jpg + pdf)')
    pg.wait_for_function("document.querySelector('.modal .att img') && document.querySelector('.modal .att img').naturalWidth > 0")
    ok(True, 'image thumbnail loaded through signed URL')
    pg.screenshot(path=f'{OUT}/p5-att-dialog.png')
    with ctx.expect_page() as newp:
        pg.locator('.modal .att:has(img) [data-att-open]').first.click()
    np_ = newp.value
    try:
        np_.wait_for_url('**token=**', timeout=10000); ok('token=' in np_.url, 'opening a file uses a temporary signed URL')
    except Exception as e:
        ok(False, f'open file: {e}')
    np_.close()
    pg.locator('.modal [data-x]').click()

    # ---------------- food ----------------
    pg.goto(BASE + '#/food'); pg.wait_for_selector('.list-body')
    pg.click('[data-list-add]'); pg.wait_for_selector('.modal')
    fill(pg, {'site_id': [o for o in pg.locator('.modal [name=site_id] option').evaluate_all('os => os.map(o => [o.value, o.textContent])') if 'البركة' in o[1]][0][0],
              'supplier': 'مورد تجريبي', 'description': 'أرز', 'quantity': '10', 'unit': 'كيس', 'unit_price': '12.5', 'with_vat': True})
    pg.wait_for_timeout(150); t = pg.inner_text('.modal [data-live=calc]')
    ok('125.00' in t and '18.75' in t and '143.75' in t, 'food live: 10 × 12.5 = 125 + 18.75 = 143.75')
    pg.click('.modal [data-save]'); pg.wait_for_selector('.modal', state='detached'); pg.wait_for_timeout(300)
    ok(sql("select total from food_supplies where description='أرز'") == '143.75', 'food saved with total 143.75')
    pg.screenshot(path=f'{OUT}/p5-food.png', full_page=True)

    # ---------------- vehicle file: photos + linked oil invoice ----------------
    pg.goto(BASE + '#/oil'); pg.wait_for_selector('.list-body')
    pg.fill('#page input[name=q]', '1234'); pg.wait_for_timeout(150)
    pg.locator('[data-row-act=att]').first.click(); pg.wait_for_selector('.modal .att-box [data-up-file]')
    upload(pg, '[data-up-file]', ['invoice.jpg'], 'oil_invoice', '.modal'); pg.wait_for_selector('.modal .att-grid figure')
    pg.locator('.modal [data-x]').click()
    pg.goto(f'{BASE}#/vehicles/{V1}?tab=files'); pg.wait_for_selector('[data-panel=files] [data-up-cam]')
    upload(pg, '[data-up-cam]', ['big-photo.jpg'], 'vehicle_photo', '[data-panel=files]')
    pg.wait_for_selector('[data-panel=files] .att-grid figure:nth-child(2)')
    t = pg.inner_text('[data-panel=files]')
    ok('فاتورة تغيير زيت' in t and 'تغيير زيت OIL-' in t and 'صورة السيارة' in t, 'vehicle files tab shows its photo and linked oil invoice')
    size = int(sql("select size_bytes from attachments where file_name='big-photo.jpg'") or 0)
    ok(0 < size < 8450400 / 2, f'large photo shrunk before upload (8.4 MB -> {size/1048576:.1f} MB)')
    pg.screenshot(path=f'{OUT}/p5-vehicle-files.png', full_page=True)

    # ---------------- employee document image ----------------
    pg.goto(f'{BASE}#/employees/{E1}'); pg.wait_for_selector('.att-box [data-up-file]')
    upload(pg, '[data-up-file]', ['invoice.jpg'], 'document_image', '.att-box')
    pg.wait_for_selector('.att-box .att-grid figure')
    ok('صورة وثيقة' in pg.inner_text('.att-box'), 'employee document image uploaded')

    # ---------------- library ----------------
    pg.goto(BASE + '#/attachments'); pg.wait_for_selector('.lib')
    n_admin = pg.locator('.lib figure').count()
    ok(n_admin == 5, f'admin library shows all 5 files (got {n_admin})')
    pg.select_option('#page select[name=cat]', 'housing_invoice'); pg.wait_for_timeout(150)
    ok(pg.locator('.lib figure').count() == 2, 'library category filter works')
    pg.screenshot(path=f'{OUT}/p5-library.png', full_page=True)
    ctx.close()

    # ---------------- permissions ----------------
    def lib_count(email):
        c = b.new_context(viewport={'width': 390, 'height': 844}); g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
        login(g, email); g.goto(BASE + '#/attachments'); g.wait_for_selector('.lib'); g.wait_for_timeout(300)
        n = g.locator('.lib figure').count(); txt = g.inner_text('.lib')
        hasup = g.goto(f'{BASE}#/vehicles/{V1}?tab=files') and False
        g.wait_for_selector('[data-panel=files] .att-box'); g.wait_for_timeout(300)
        up = g.locator('[data-panel=files] [data-up-cam]').count()
        c.close(); return n, txt, up
    n, txt, up = lib_count('viewer@test.local')
    ok(n == 1 and 'صورة السيارة' in txt and 'فاتورة' not in txt, f'viewer sees only the vehicle photo (no invoices, no personal docs) — {n}')
    ok(up == 0, 'viewer cannot upload')
    n, txt, up = lib_count('acct@test.local')
    ok(n == 4 and 'صورة وثيقة' not in txt, f'accountant (view + invoices) sees invoices but not personal document images — {n}')
    # direct storage access check: viewer cannot sign an invoice path
    path = sql("select storage_path from attachments where category='housing_invoice' limit 1")
    c = b.new_context(); g = c.new_page(); login(g, 'viewer@test.local')
    res = g.evaluate("""async (p) => { const m = await import('/js/api.js'); try { await m.signedUrl(p); return 'signed'; } catch (e) { return 'denied'; } }""", path)
    ok(res == 'denied', 'viewer cannot get a link to an invoice file even with its exact path')
    c.close()
    b.close()

print(f'PASSED {len(passed)}')
for m in problems: print('FAIL:', m)
print('ALL PHASE 5 CHECKS PASSED' if not problems else f'{len(problems)} problem(s)')
