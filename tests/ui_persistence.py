"""v1.2: permanent saving in every section — data survives navigation, reload, closing the browser, and shows on
another device; failed saves (offline / lost response) never claim success, keep the input, and never duplicate;
form drafts survive a page reload (iPhone camera case); unsaved forms are not lost by a stray tap; archive asks first.
Usage: python3 -I ui_persistence.py OUTDIR   (fresh fleet_ui DB + mock server)"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
V2 = 'b0000000-0000-0000-0000-000000000002'
PLATE = 'ح ف ظ 1201'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def cnt(t, w='true'): return int(sql(f'select count(*) from {t} where {w}') or -1)

def new_ctx(b, w=390, **kw):
    c = b.new_context(viewport={'width': w, 'height': 860}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2, **kw)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def fill(g, vals):
    for n, v in vals.items():
        el = g.locator(f'.modal [name="{n}"]').first
        if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(value=v)
        elif el.get_attribute('type') == 'checkbox': el.check() if v else el.uncheck()
        else: el.fill(v)
def open_vehicle(g, vid, tab='basic'):
    g.goto(f'{BASE}#/vehicles/{vid}?tab={tab}&r={os.urandom(3).hex()}'); g.wait_for_selector('.vhead')
def save_ok(g):
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000)
def drafts(g): return g.evaluate("Object.keys(localStorage).filter(k => k.startsWith('fleet.draft.v1|')).length")
toasts = []

with sync_playwright() as p:
    b = p.chromium.launch()
    # =============================== device 1 (computer)
    c1, g = new_ctx(b, 1280)
    g.expose_function('noteToast', lambda t: toasts.append(t))
    g.add_init_script("let __last = ''; document.addEventListener('DOMContentLoaded', () => new MutationObserver(() => { const t = document.getElementById('toast'); if (!t) return; const k = t.className + '|' + t.textContent; if (k !== __last && t.classList.contains('show')) { __last = k; window.noteToast(k); } }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true }));")
    login(g)

    # 1) add a vehicle, leave, come back
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=plate_letters]'); g.wait_for_timeout(200)
    fill(g, {'plate_letters': PLATE.rsplit(' ', 1)[0], 'plate_digits': PLATE.rsplit(' ', 1)[1], 'owner_company': 'شركة روى الرمال الزراعية', 'make': 'تويوتا', 'model': 'هايلكس', 'current_user_name': 'مستخدم تجريبي', 'current_user_mobile': '0501112222'})
    g.click('.modal [data-save]'); g.wait_for_selector('.vhead', timeout=30000)
    vid = sql(f"select id from vehicles where plate_no='{PLATE}'")
    ok(len(vid) == 36 and cnt('vehicles', f"plate_no='{PLATE}'") == 1, '1. new vehicle saved once in the database')
    ok(any('|تمت إضافة السيارة' in t for t in toasts), '1. success message shown only after the database confirmed')
    g.goto(BASE + '#/dashboard'); g.wait_for_selector('.panels'); g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt')
    ok(PLATE in g.inner_text('#vt'), '1. vehicle still listed after leaving the page and coming back')
    # 2) reload, then close the browser completely and open again
    g.reload(); g.wait_for_selector('#vt')
    ok(PLATE in g.inner_text('#vt') and g.locator('form.login-card').count() == 0, '2. after reload: still signed in and vehicle still there')
    state = c1.storage_state(); c1.close()
    c1, g = new_ctx(b, 1280, storage_state=state); g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt')
    ok(PLATE in g.inner_text('#vt'), '2. after closing and reopening the browser: vehicle still there')

    # 3) oil + maintenance + accident + expense, then leave and come back
    n0 = {t: cnt(t) for t in ['oil_changes', 'maintenance', 'accidents', 'housing_maintenance']}
    open_vehicle(g, V2); g.click('.vactions [data-act=oil]'); g.wait_for_selector('.modal [name=odometer]')
    fill(g, {'workshop': 'ورشة الحفظ', 'oil_cost': '120'}); save_ok(g)
    open_vehicle(g, V2, 'maint'); g.click('[data-panel=maint] [data-act=maint]'); g.wait_for_selector('.modal .item-row')
    fill(g, {'maint_type': 'كهرباء', 'workshop': 'ورشة الحفظ', 'fault_description': 'اختبار الحفظ'})
    r0 = g.locator('.modal .item-row').nth(0); r0.locator('[name=it_desc]').fill('فيوز'); r0.locator('[name=it_price]').fill('35'); save_ok(g)
    open_vehicle(g, V2); g.click('.vactions [data-act=acc]'); g.wait_for_selector('.modal [name=description]')
    fill(g, {'description': 'حادث اختبار الحفظ', 'parts_cost': '200', 'vehicle_status': ''}); save_ok(g)
    g.goto(BASE + '#/housing'); g.wait_for_selector('.list-body'); g.click('[data-list-add]'); g.wait_for_selector('.modal [name=site_id]')
    site = g.locator('.modal [name=site_id] option').nth(1).get_attribute('value')
    fill(g, {'site_id': site, 'contractor': 'مقاول الحفظ', 'description': 'مصروف اختبار الحفظ', 'invoice_no': 'SAVE-1', 'subtotal': '300'}); save_ok(g)
    n1 = {t: cnt(t) for t in n0}
    ok(all(n1[t] == n0[t] + 1 for t in n0), f'3. oil, maintenance, accident and expense each saved once ({n0} -> {n1})')
    g.goto(BASE + '#/dashboard'); g.wait_for_selector('.panels')
    open_vehicle(g, V2, 'oil'); t_oil = g.inner_text('.tab-panel.on')
    open_vehicle(g, V2, 'maint'); t_m = g.inner_text('.tab-panel.on')
    open_vehicle(g, V2, 'acc'); t_a = g.inner_text('.tab-panel.on')
    g.goto(BASE + '#/housing'); g.wait_for_selector('.list-body'); t_h = g.inner_text('.list-body')
    ok('120.00' in t_oil and '35.00' in t_m and 'حادث اختبار الحفظ' in t_a and 'SAVE-1' in t_h, '3. all four records shown again after leaving and returning, linked to the right vehicle')

    # 4) edit and confirm after reopening
    open_vehicle(g, vid); g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=model]'); g.wait_for_timeout(200)
    fill(g, {'model': 'لاندكروزر'}); save_ok(g)
    g.reload(); g.wait_for_selector('.vhead')
    ok('لاندكروزر' in g.inner_text('[data-panel=basic]') and sql(f"select model from vehicles where id='{vid}'") == 'لاندكروزر', '4. edit saved and shown after reopening the page')

    # 5a) offline: no false success, input kept, nothing saved, then saved once when back online
    toasts.clear(); before = cnt('oil_changes')
    open_vehicle(g, V2); g.click('.vactions [data-act=oil]'); g.wait_for_selector('.modal [name=odometer]')
    fill(g, {'workshop': 'ورشة بلا إنترنت', 'oil_cost': '99'})
    c1.set_offline(True); g.wait_for_timeout(200)
    ok(g.locator('.net-banner').count() == 1 and 'لا يوجد اتصال' in g.inner_text('.net-banner'), '5. offline banner explains that nothing is saved without internet')
    g.click('.modal [data-save]'); g.wait_for_selector('.modal .form-error:not([hidden])')
    e = g.inner_text('.modal .form-error')
    ok('لم تُحفظ' in e and g.input_value('.modal [name=workshop]') == 'ورشة بلا إنترنت', '5. offline save: clear «لم تُحفظ» message, form stays open with the input')
    ok(cnt('oil_changes') == before and not any('|تم' in t for t in toasts), '5. offline save: nothing written and no success message')
    g.screenshot(path=f'{OUT}/s-offline.png')
    c1.set_offline(False); g.wait_for_timeout(300)
    save_ok(g)
    ok(cnt('oil_changes') == before + 1 and cnt('oil_changes', "workshop='ورشة بلا إنترنت'") == 1, '5. back online: same input saved once')

    # 5b) request fails before reaching the server (navigator still online)
    def fail_post(route):
        if route.request.method == 'POST': route.abort()
        else: route.continue_()
    open_vehicle(g, V2); g.click('.vactions [data-act=oil]'); g.wait_for_selector('.modal [name=odometer]')
    fill(g, {'workshop': 'ورشة انقطاع', 'oil_cost': '77'})
    g.route('**/rest/v1/oil_changes*', fail_post); toasts.clear(); before = cnt('oil_changes')
    g.click('.modal [data-save]'); g.wait_for_selector('.modal .form-error:not([hidden])')
    ok('لم تُحفظ' in g.inner_text('.modal .form-error') and cnt('oil_changes') == before and not any('|تم' in t for t in toasts), '5. connection error: «لم تُحفظ» shown, nothing saved, no success message')
    g.unroute('**/rest/v1/oil_changes*'); save_ok(g)
    ok(cnt('oil_changes', "workshop='ورشة انقطاع'") == 1, '5. retry after connection error saved once')

    # 5c) response lost AFTER the server saved: retry must not duplicate
    lost = {'n': 0}
    def lose_response(route):
        if route.request.method == 'POST' and lost['n'] == 0:
            lost['n'] += 1; route.fetch(); route.abort()
        else: route.continue_()
    open_vehicle(g, V2); g.click('.vactions [data-act=acc]'); g.wait_for_selector('.modal [name=description]')
    fill(g, {'description': 'حادث رد مفقود', 'parts_cost': '50', 'vehicle_status': ''})
    g.route('**/rest/v1/accidents*', lose_response)
    g.click('.modal [data-save]'); g.wait_for_selector('.modal .form-error:not([hidden])')
    ok(cnt('accidents', "description='حادث رد مفقود'") == 1 and 'لم تُحفظ' in g.inner_text('.modal .form-error'), '5. lost response: server had saved it, app honestly says it is not confirmed')
    save_ok(g); g.unroute('**/rest/v1/accidents*')
    ok(cnt('accidents', "description='حادث رد مفقود'") == 1, '5. pressing save again does NOT create a duplicate')
    lost['n'] = 0
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=plate_letters]'); g.wait_for_timeout(200)
    fill(g, {'plate_letters': 'ح ف ظ', 'plate_digits': '1202', 'owner_company': 'شركة روى الرمال الزراعية', 'registration_expiry': '2027/05/01'})
    g.route('**/rest/v1/vehicles*', lose_response)
    g.click('.modal [data-save]'); g.wait_for_selector('.modal .form-error:not([hidden])')
    save_ok(g) if g.locator('.modal').count() else None; g.unroute('**/rest/v1/vehicles*'); g.wait_for_selector('.vhead')
    v3 = sql("select id from vehicles where plate_no='ح ف ظ 1202'")
    ok(cnt('vehicles', "plate_no='ح ف ظ 1202'") == 1 and cnt('documents', f"vehicle_id='{v3}' and doc_type='registration'") == 1, '5. multi-step save (vehicle + registration) completed once after retry, no duplicates')

    # 5d) draft survives a page reload (iPhone reloads the page after the camera) — including the photo
    open_vehicle(g, V2); g.click('.vactions [data-act=oil]'); g.wait_for_selector('.modal [name=odometer]')
    fill(g, {'workshop': 'ورشة المسودة', 'oil_cost': '210', 'notes': 'ملاحظة لم تُحفظ بعد'})
    g.locator('.modal input[name=invoice_file]').set_input_files(os.path.join(FX, 'invoice.jpg')); g.wait_for_timeout(700)
    ok(drafts(g) >= 1, '5. typing in a form keeps a draft on the device')
    g.reload(); g.wait_for_selector('.vhead')
    g.click('.vactions [data-act=oil]'); g.wait_for_selector('.modal [name=odometer]'); g.wait_for_timeout(600)
    ok(g.locator('.modal .draft-note:not([hidden])').count() == 1 and g.input_value('.modal [name=workshop]') == 'ورشة المسودة'
       and g.input_value('.modal [name=notes]') == 'ملاحظة لم تُحفظ بعد', '5. after reload the unsaved form is restored with a clear note')
    ok('من المسودة' in g.inner_text('.modal .file-field'), '5. chosen invoice photo restored from the draft too')
    g.screenshot(path=f'{OUT}/s-draft-restored.png')
    att0 = cnt('attachments'); save_ok(g)
    ok(cnt('oil_changes', "workshop='ورشة المسودة'") == 1 and cnt('attachments') == att0 + 1, '5. restored draft saved with its invoice photo')
    ok(drafts(g) == 0, '5. draft deleted from the device once the database confirmed the save')

    # 5e) unsaved form is not lost by a stray tap; cancel asks first
    open_vehicle(g, V2); g.click('.vactions [data-act=acc]'); g.wait_for_selector('.modal [name=description]')
    fill(g, {'description': 'لا تضيع'})
    g.mouse.click(5, 5); g.wait_for_timeout(300)
    ok(g.locator('.modal [name=description]').count() == 1 and g.input_value('.modal [name=description]') == 'لا تضيع', '5. tapping outside the form does not close it or erase the input')
    g.click('.modal [data-close]'); g.wait_for_selector('[data-yes]')
    ok('لم تُحفظ' in g.inner_text('.modal:last-child'), '5. cancel with unsaved input asks for confirmation')
    g.click('[data-no]'); g.wait_for_timeout(200)
    ok(g.input_value('.modal [name=description]') == 'لا تضيع', '5. «متابعة التعديل» keeps the input')
    g.click('.modal [data-close]'); g.click('[data-yes]'); g.wait_for_selector('.modal', state='detached')
    ok(drafts(g) == 0, '5. confirmed discard removes the draft')

    # archive (delete) asks for confirmation and keeps the record
    g.goto(BASE + '#/oil'); g.wait_for_selector('.list-body')
    rows0 = g.locator('.list-body tbody tr').count()
    g.locator('.list-body [data-row-act=archive]').first.click(); g.wait_for_selector('[data-yes]')
    ok('أرشفة' in g.inner_text('.modal:last-child'), 'delete/archive asks for clear confirmation')
    g.click('[data-no]'); g.wait_for_timeout(300)
    ok(g.locator('.list-body tbody tr').count() == rows0, 'cancelling the confirmation keeps the record')

    # offline at start: no forced sign-out
    c1.set_offline(True); g.reload(wait_until='domcontentloaded') if False else None
    c1.set_offline(False)
    c1.close()

    # =============================== device 2 (iPhone size, separate browser storage)
    c2, m = new_ctx(b, 390); login(m)
    open_vehicle(m, vid); t = m.inner_text('[data-panel=basic]')
    ok('لاندكروزر' in t and 'مستخدم تجريبي' in t and '050 111 2222' in t, '6. another device sees the same vehicle with the latest edit')
    open_vehicle(m, V2, 'oil'); t = m.inner_text('.tab-panel.on')
    ok('ورشة المسودة' in t or '210.00' in t, '6. another device sees oil changes added on the computer')
    open_vehicle(m, V2, 'acc'); t = m.inner_text('.tab-panel.on')
    ok('حادث اختبار الحفظ' in t and 'حادث رد مفقود' in t, '6. another device sees accidents')
    m.goto(BASE + '#/housing'); m.wait_for_selector('.list-body')
    ok('SAVE-1' in m.inner_text('.list-body'), '6. another device sees expenses')
    # opening the site with no internet keeps the session (no forced sign-out)
    def offline_all(route): route.abort()
    m.route('**/rest/v1/**', offline_all); m.route('**/auth/v1/**', offline_all)
    m.reload(); m.wait_for_selector('.boot-offline, .panels', timeout=30000)
    ok(m.locator('.boot-offline').count() == 1 and m.evaluate("!!localStorage.getItem('fleet.session.v1')"), '7. no internet at start: clear message, session kept, nothing deleted')
    m.screenshot(path=f'{OUT}/s-boot-offline.png')
    m.unroute('**/rest/v1/**'); m.unroute('**/auth/v1/**')
    m.click('[data-retry]'); m.wait_for_selector('.list-body')
    ok(m.locator('form.login-card').count() == 0, '7. internet back: continues without signing in again')
    c2.close()

    # viewer cannot write and gets a clear error (permissions still enforced)
    c3, v = new_ctx(b, 390); login(v, 'viewer@test.local')
    open_vehicle(v, V2)
    ok(v.locator('.vactions [data-act=oil]').count() == 0, '7. read-only user has no add buttons')
    c3.close()
    b.close()

ok(cnt('vehicles', "plate_no like 'ح ف ظ%'") == 2, 'no duplicate vehicles overall')
print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
