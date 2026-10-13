"""Phase 3 browser test: sites, vehicles, vehicle file, employees, documents, permissions.
Requires a fresh fleet_ui DB (reset_ui_db.sh) and mock_supabase.py on :8787.
Usage: python3 -I ui_phase3.py OUTDIR"""
import sys, os, re
from playwright.sync_api import sync_playwright, expect
import datetime as _dt, zoneinfo as _zi
_T0 = _dt.datetime.now(_zi.ZoneInfo('Asia/Riyadh')).date()
def _d(n=0, sep='/'): return (_T0 + _dt.timedelta(days=n)).strftime(f'%Y{sep}%m{sep}%d')

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []

def ok(cond, msg):
    (passed if cond else problems).append(msg)

def login(pg, email):
    pg.goto(BASE); pg.wait_for_selector('form.login-card')
    pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'test1234'); pg.click('button[type=submit]')
    pg.wait_for_selector('.panels')

def modal_fill(pg, values):
    for name, val in values.items():
        el = pg.locator(f'.modal [name="{name}"]').first
        tag = el.evaluate('e => e.tagName')
        if tag == 'SELECT':
            if val.startswith('label:'): el.select_option(label=val[6:])
            else: el.select_option(value=val)
        elif el.get_attribute('type') == 'checkbox':
            (el.check() if val else el.uncheck())
        else:
            el.fill(val)

def modal_save(pg):
    pg.click('.modal [data-save]')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='ar-SA', timezone_id='Asia/Riyadh')
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    pg.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and '400' not in m.text and '403' not in m.text and problems.append(f'console: {m.text}'))
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    login(pg, 'admin@test.local')

    # ---------- vehicles list ----------
    pg.goto(BASE + '#/vehicles'); pg.wait_for_selector('table.rtable')
    ok(pg.locator('table.rtable tbody tr').count() == 5, 'vehicles list shows 5 vehicles')
    lt = pg.inner_text('table.rtable'); th = pg.locator('table.rtable thead').text_content()
    ok('انتهاء الاستمارة' in th and 'انتهاء الفحص الدوري' in th and 'منتهية منذ 4 يوم' in lt and 'باقي 300 يوم' in lt, 'list shows registration and inspection expiry columns')
    pg.fill('#page input[name=q]', '5678'); pg.wait_for_timeout(200)
    ok(pg.locator('table.rtable tbody tr').count() == 1, 'search by plate filters to 1')
    pg.fill('#page input[name=q]', ''); pg.select_option('select[name=op]', 'under_maintenance'); pg.wait_for_timeout(200)
    ok(pg.locator('table.rtable tbody tr').count() == 1, 'filter by op status')
    pg.select_option('select[name=op]', '')
    pg.screenshot(path=f'{OUT}/p3-vehicles-mobile.png', full_page=False)

    # ---------- add vehicle with an invalid date first ----------
    pg.click('[data-act=new]'); pg.wait_for_selector('.modal')
    modal_fill(pg, {'plate_letters': 'ن و ه', 'plate_digits': '7777', 'make': 'تويوتا', 'model': 'هايلكس', 'manufacture_year': '2024',
                    'owner_company': 'شركة عبد الرحمن الفهاد', 'site_name': 'مزرعة البركة', 'registration_expiry': '20260231'})
    ok(pg.input_value('.modal [name=registration_expiry]') == '2026/02/31', 'date auto-formats while typing (20260231 -> 2026/02/31)')
    modal_save(pg); pg.wait_for_selector('.modal .form-error:not([hidden])')
    ok('غير موجود في التقويم' in pg.inner_text('.modal .form-error'), 'invalid date 2026/02/31 rejected with Arabic message')
    ok(pg.input_value('.modal [name=plate_letters]') == 'ن و ه' and pg.input_value('.modal [name=plate_digits]') == '7777', 'entered data kept after error')
    pg.screenshot(path=f'{OUT}/p3-form-error.png')
    modal_fill(pg, {'registration_expiry': '2027/01/15', 'inspection_expiry': '2026/11/05'})
    modal_save(pg)
    pg.wait_for_selector('.vhead'); pg.wait_for_selector('#toast.show')
    ok('VEH-0006' in pg.inner_text('.vhead'), 'new vehicle saved as VEH-0006 and file opened')
    ok('شركة عبد الرحمن الفهاد' in pg.inner_text('.vfacts') and 'مزرعة البركة' in pg.inner_text('.vfacts'), 'owner company independent of operating site')
    ok(pg.locator('.tabbtn').count() == 11, 'vehicle file has 11 tabs')
    ok('2026/11/05' in pg.inner_text('.vfacts'), 'inspection expiry from add form saved; nearest document = 2026/11/05')
    vf = pg.inner_text('.vfacts')
    ok('انتهاء الاستمارة' in vf and '2027/01/15' in vf and 'انتهاء الفحص الدوري' in vf, 'header shows registration and inspection expiry dates')
    pg.click('.tabbtn[data-tab=docs]'); dt = pg.inner_text('.tab-panel.on')
    ok('2027/01/15' in dt and '2026/11/05' in dt, 'registration and inspection expiries saved from add form')
    pg.click('.tabbtn[data-tab=basic]')
    pg.screenshot(path=f'{OUT}/p3-vehicle-file.png', full_page=True)
    vurl = pg.url

    # ---------- odometer ----------
    pg.click('.vactions [data-act=odo]'); modal_fill(pg, {'reading': '1500'}); modal_save(pg)
    pg.wait_for_selector('.modal', state='detached'); pg.wait_for_function("(document.querySelector('.vfacts')?.innerText||'').includes('1,500')")
    pg.click('.vactions [data-act=odo]'); modal_fill(pg, {'reading': '1200'}); modal_save(pg)
    pg.wait_for_selector('.modal .form-error:not([hidden])')
    ok('أقل من آخر قراءة' in pg.inner_text('.modal .form-error'), 'lower odometer requires confirmation reason')
    modal_fill(pg, {'reason': 'خطأ في الإدخال الأول'}); modal_save(pg)
    pg.wait_for_selector('.modal', state='detached'); pg.wait_for_function("(document.querySelector('.vfacts')?.innerText||'').includes('1,200')")
    ok(True, 'odometer corrected with reason')
    pg.click('.vactions [data-act=odo]'); modal_fill(pg, {'reading': '2500'}); modal_save(pg)
    pg.wait_for_selector('.modal', state='detached'); pg.wait_for_function("(document.querySelector('.vfacts')?.innerText||'').includes('2,500')")
    ok(True, 'odometer increased normally')

    # ---------- driver, authorization, documents ----------
    pg.click('.tabbtn[data-tab=driver]'); pg.click('.tab-panel.on [data-act=driver]')
    modal_fill(pg, {'driver': 'مشرف تجريبي (EMP-0005)'}); modal_save(pg)
    pg.wait_for_selector('.modal', state='detached'); pg.wait_for_selector('.tab-panel.on[data-panel=driver] .person')
    ok('مشرف تجريبي' in pg.inner_text('.tab-panel.on'), 'driver assigned and shown')
    ok('غير متوفر' in pg.inner_text('.vfacts'), 'new driver authorization shows "غير متوفر" (not assumed)')
    pg.click('.tabbtn[data-tab=auth]')
    ok(pg.locator('.tab-panel.on .bad-box').count() == 1, 'warning shown when driver not authorized')
    pg.click('.tab-panel.on [data-act=auth]'); modal_fill(pg, {'auth_no': 'T-77', 'expiry_date': '2027/03/01'}); modal_save(pg)
    pg.wait_for_selector('.modal', state='detached'); pg.wait_for_selector('.tab-panel.on[data-panel=auth]')
    ok('ساري' in pg.inner_text('.vfacts') and pg.locator('.tab-panel.on .bad-box').count() == 0, 'authorization added -> ساري, warning gone')
    pg.click('.tabbtn[data-tab=docs]'); pg.click('.tab-panel.on [data-act=doc-edit][data-type=registration]')
    ok(pg.input_value('.modal [name=expiry_date]') == '2027/01/15', 'edit form loads current document')
    modal_fill(pg, {'doc_no': 'R-7777', 'expiry_date': _d(8)}); modal_save(pg)
    pg.wait_for_selector('.modal', state='detached'); pg.wait_for_selector('.tab-panel.on[data-panel=docs] .doc-card')
    ok('باقي 8 يوم' in pg.inner_text('.tab-panel.on'), 'registration expiring in 8 days computed in Riyadh date')
    ok(_d(8) in pg.inner_text('.vfacts'), 'nearest document shown in header')

    # ---------- edit vehicle (move site) -> history ----------
    pg.click('.vactions [data-act=edit]'); modal_fill(pg, {'site_name': 'مزرعة ارم', 'op_state': 'outside'}); modal_save(pg)
    pg.wait_for_selector('.modal', state='detached'); pg.wait_for_function("(document.querySelector('.vfacts')?.innerText||'').includes('مزرعة ارم')")
    pg.click('.tabbtn[data-tab=log]'); txt = pg.inner_text('.tab-panel.on')
    ok('مزرعة البركة' in txt and 'مزرعة ارم' in txt and 'الموقع' in txt, 'site change kept with previous value in history')
    ok('تصحيح مؤكد' in txt and 'خطأ في الإدخال الأول' in txt, 'odometer correction and reason in history')
    ok('السائق المسؤول' in txt, 'driver change in history')
    pg.screenshot(path=f'{OUT}/p3-history.png', full_page=True)

    # ---------- employees ----------
    pg.goto(BASE + '#/employees'); pg.wait_for_selector('table.rtable')
    ok(pg.locator('table.rtable tbody tr').count() == 5, 'employees list shows 5 active')
    pg.click('[data-act=new]'); pg.wait_for_selector('.modal')
    modal_fill(pg, {'full_name': 'موظف جديد تجريبي', 'site_name': 'مشتل الغملاس', 'job_title': 'عامل', 'iqama_no': '12345', 'mobile': '0500000009', 'iqama_expiry': '2026/11/01'})
    modal_save(pg); pg.wait_for_selector('.modal .form-error:not([hidden])')
    ok('10 أرقام' in pg.inner_text('.modal .form-error'), 'invalid iqama rejected')
    modal_fill(pg, {'iqama_no': '٢٠٠٠٠٠٠٠٠٩'}); modal_save(pg)
    pg.wait_for_selector('.vhead'); t = pg.inner_text('#page')
    ok('EMP-0006' in t and '2000000009' in t and '0500000009' in t, 'employee saved; Arabic digits converted; sensitive data visible to admin')
    ok('شركة عبد الرحمن الفهاد' in t, 'company filled from site automatically')
    ok('2026/11/01' in t, 'iqama expiry stored as document')
    pg.screenshot(path=f'{OUT}/p3-employee.png', full_page=True)
    pg.goto(BASE + '#/employees'); pg.wait_for_selector('table.rtable'); pg.fill('#page input[name=q]', '2000000009'); pg.wait_for_timeout(200)
    ok(pg.locator('table.rtable tbody tr').count() == 1, 'search employees by iqama number')

    # ---------- documents page ----------
    pg.goto(BASE + '#/documents'); pg.wait_for_selector('#dt')
    ok(pg.locator('.chip').count() >= 3, 'status chips shown')
    n_attn = pg.locator('#dt tbody tr').count()
    pg.select_option('select[name=show]', 'all'); pg.wait_for_timeout(200)
    ok(pg.locator('#dt tbody tr').count() > n_attn, 'show all includes valid documents')
    pg.select_option('select[name=type]', 'iqama'); pg.wait_for_timeout(200)
    ok(all('الإقامة' in r for r in pg.locator('#dt tbody tr td:nth-child(2)').all_inner_texts()), 'filter by doc type')
    pg.select_option('select[name=show]', 'attn'); pg.select_option('select[name=type]', '')
    pg.screenshot(path=f'{OUT}/p3-documents.png', full_page=False)

    # ---------- sites ----------
    pg.goto(BASE + '#/sites'); pg.wait_for_selector('.site-list')
    ok(pg.locator('.site-list li').count() == 4, '4 sites listed')
    pg.locator('[data-act=edit-site]').nth(0).click(); old = pg.input_value('.modal [name=name]')
    modal_fill(pg, {'name': old + ' (معدّل)'}); modal_save(pg); pg.wait_for_selector('.modal', state='detached')
    pg.wait_for_selector(f'text={old} (معدّل)')
    ok(True, 'site renamed')
    pg.screenshot(path=f'{OUT}/p3-sites.png', full_page=True)

    # ---------- header add menu ----------
    pg.goto(BASE + '#/dashboard'); pg.wait_for_selector('.panels')
    pg.click('[data-act=add]'); pg.click('.pop-add a[href="#/vehicles?new=1"]'); pg.wait_for_selector('.modal')
    ok('إضافة سيارة' in pg.inner_text('.modal h2'), 'header add menu opens vehicle form')
    (pg.click('.modal [data-close]'), pg.wait_for_timeout(150), pg.locator('[data-yes]').count() and pg.click('[data-yes]'))

    # desktop screenshots
    pg.set_viewport_size({'width': 1360, 'height': 900})
    pg.goto(vurl.split('?')[0] + '?tab=basic'); pg.wait_for_selector('.vhead'); pg.screenshot(path=f'{OUT}/p3-vehicle-desktop.png', full_page=True)
    pg.goto(BASE + '#/vehicles'); pg.wait_for_selector('table.rtable'); pg.screenshot(path=f'{OUT}/p3-vehicles-desktop.png', full_page=True)
    ctx.close()

    # ---------- viewer permissions ----------
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page()
    pg.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    login(pg, 'viewer@test.local')
    pg.goto(BASE + '#/vehicles'); pg.wait_for_selector('table.rtable')
    ok(pg.locator('[data-act=new]').count() == 0, 'viewer sees no add button')
    pg.goto(vurl); pg.wait_for_selector('.vhead')
    ok(pg.locator('.vactions [data-act=edit]').count() == 0, 'viewer sees no edit button')
    pg.goto(BASE + '#/employees'); pg.wait_for_selector('table.rtable')
    ok('2000000009' not in pg.inner_text('#page'), 'viewer cannot see iqama numbers')
    pg.locator('table.rtable a.code').first.click(); pg.wait_for_selector('.vhead')
    ok('مخفية' in pg.inner_text('#page'), 'employee file hides sensitive data for viewer')
    b.close()

print(f'PASSED {len(passed)}')
for m in problems: print('FAIL:', m)
print('ALL PHASE 3 CHECKS PASSED' if not problems else f'{len(problems)} problem(s)')
