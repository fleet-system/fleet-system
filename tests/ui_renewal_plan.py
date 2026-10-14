"""v1.17: «خطة تجديد المركبة والمفوض» inside the dashboard card «وثائق السيارات»: five ordered steps per vehicle
(delegate licence, inspection, insurance, fines and fees, registration), a step completes only after the user confirms,
two-way sync with the vehicle card and the delegate file, one delegate linked to several vehicles, duplicate warning
and merge, plan counts per vehicle status, global search, PDF report, permissions, phone layout.
Usage: python3 -I ui_renewal_plan.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess
import datetime as _dt, zoneinfo as _zi
from playwright.sync_api import sync_playwright
_T0 = _dt.datetime.now(_zi.ZoneInfo('Asia/Riyadh')).date()
def _d(n=0, sep='/'): return (_T0 + _dt.timedelta(days=n)).strftime(f'%Y{sep}%m{sep}%d')
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def new_ctx(b, w=1280, h=900):
    c = b.new_context(viewport={'width': w, 'height': h}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2, accept_downloads=True)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def go(g, h, sel): g.goto(f'{BASE}{h}{"&" if "?" in h else "?"}r={os.urandom(3).hex()}'); g.wait_for_selector(sel); g.wait_for_timeout(300)
def save(g): g.click('.modal [data-save]'); g.wait_for_timeout(400)
def yes(g): g.wait_for_selector('.modal [data-yes]'); g.click('.modal [data-yes]'); g.wait_for_timeout(400)
def closed(g): g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_timeout(500)
def fill_date(g, name, v): g.fill(f'.modal [name={name}]', v); g.locator(f'.modal [name={name}]').dispatch_event('input'); g.wait_for_timeout(150)
def toast(g): return ' '.join(g.locator('.toast').all_inner_texts())
def overflow(g): return g.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1')
V = {n: f'b0000000-0000-0000-0000-00000000000{n}' for n in range(1, 6)}
# fake data: vehicle 1 has expired inspection, registration and insurance
sql(f"update documents set expiry_date = app_today() - 20 where vehicle_id = '{V[1]}' and doc_type = 'periodic_inspection'; update documents set expiry_date = app_today() - 5 where vehicle_id = '{V[1]}' and doc_type = 'registration'; "
    f"insert into documents(doc_type, vehicle_id, expiry_date) select t, '{V[1]}', app_today() - 7 from unnest(array['periodic_inspection','registration']::doc_type[]) t where not exists (select 1 from documents d where d.vehicle_id = '{V[1]}' and d.doc_type = t); "
    f"update vehicles set insurance_expiry = app_today() - 10 where id = '{V[1]}'")
PLATE1 = sql(f"select plate_no from vehicles where id = '{V[1]}'")

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = new_ctx(b); login(g)
    # 1) dashboard: section inside the vehicle documents card, before the nearest-documents list
    go(g, '#/dashboard', '[data-vdocs] [data-renewal]')
    ok(g.evaluate("(() => { const s = document.querySelector('[data-vdocs] [data-renewal]'), b = document.querySelector('[data-vdocs] .vdoc-boxes'), l = document.querySelector('[data-vdocs] [data-vdocs-list]'); return !!(b.compareDocumentPosition(s) & 4) && !!(s.compareDocumentPosition(l) & 4); })()"), 'renewal section is inside «وثائق السيارات» between the status boxes and the nearest list')
    ok(g.locator('[data-vdocs] .vdoc-boxes li .rn-plans-link').count() == 6, 'every status box shows its number of renewal plans')
    g.screenshot(path=f'{OUT}/01-dashboard-desktop.png', full_page=True)
    # 2) new plan from the dashboard
    g.click('[data-renewal] [data-act=rn-new]'); g.wait_for_selector('.modal [name=vehicle_id]')
    g.select_option('.modal [name=vehicle_id]', value=V[1]); save(g); g.wait_for_selector('.rn-steps'); g.wait_for_timeout(400)
    ok(g.locator('.rn-step').count() == 5, 'plan page shows five steps')
    names = g.evaluate("[...document.querySelectorAll('.rn-step .rn-head b')].map(x => x.textContent)")
    ok(['رخصة' in names[0], 'الفحص' in names[1], 'تأمين' in names[2], 'المخالفات' in names[3], 'استمارة' in names[4]] == [True] * 5, f'steps in the required order {names}')
    ok(g.locator('.rn-step.next').count() == 1 and g.get_attribute('.rn-step.next', 'data-step') == '1', 'next step shown automatically (1)')
    ok(g.locator('.rn-step.locked').count() == 0 and g.locator('.rn-step [data-act=confirm]').count() == 5, 'all steps are open (none locked)')
    ok(g.locator('.rn-step.next [data-next-alert]').count() == 1 and g.locator('[data-next-alert]').count() == 1, 'warning mark only on the next step')
    ban = g.inner_text('.rn-banner')
    ok('غير نظامية' in ban and 'الفحص' in ban and 'التأمين' in ban and 'الاستمارة' in ban, f'vehicle shown as not regular with the expired documents [{ban}]')
    plan_id = sql(f"select id from renewal_plans where vehicle_id = '{V[1]}'")
    # 3) delegate for step 1
    g.click('.rn-step.next [data-act=set-delegate]'); g.wait_for_selector('.modal [name=name]'); g.fill('.modal [name=name]', 'مفوض تجريبي أحمد'); save(g); closed(g)
    g.wait_for_selector('.rn-step.next a[href^="#/delegates/"]')
    ok(sql(f"select authorized_name from vehicles where id = '{V[1]}'") == 'مفوض تجريبي أحمد', 'delegate name appears in the vehicle record')
    # save without confirming
    g.click('.rn-step.next [data-act=save]'); g.wait_for_selector('.modal [name=new_expiry]'); fill_date(g, 'new_expiry', _d(730)); save(g); closed(g)
    ok('بانتظار التأكيد' in g.inner_text('.rn-step.next'), 'saved step waits for confirmation')
    ok(sql(f"select status from renewal_steps where plan_id = '{plan_id}' and step_no = 1") == 'entered', 'not complete before confirmation')
    ok(sql("select coalesce(license_expiry::text, '') from delegates") == '', 'licence not written before confirmation')
    g.click('.rn-step.next [data-act=confirm]'); g.wait_for_selector('.modal [name=new_expiry]'); save(g); closed(g)
    ok(sql(f"select status from renewal_steps where plan_id = '{plan_id}' and step_no = 1") == 'done', 'step 1 complete after confirmation')
    ok(sql('select license_expiry from delegates') == _d(730, '-'), 'licence date written to the delegate file')
    ok(g.get_attribute('.rn-step.next', 'data-step') == '2', 'next step moves to 2')
    # 4) inspection: failed cannot complete
    g.click('.rn-step.next [data-act=confirm]'); g.wait_for_selector('.modal [name=result]'); g.select_option('.modal [name=result]', value='failed'); fill_date(g, 'new_expiry', _d(365)); save(g)
    ok(g.locator('.modal [name=result]').count() == 1 and 'اجتاز' in g.inner_text('.modal'), 'failed inspection refused with a message')
    g.select_option('.modal [name=result]', value='passed'); save(g); closed(g)
    ok(sql(f"select max(expiry_date) from documents where vehicle_id = '{V[1]}' and doc_type = 'periodic_inspection'") == _d(365, '-'), 'inspection date written to the vehicle')
    # 5) vehicle card: delegate + licence shown, insurance updated there completes step 3
    go(g, f'#/vehicles/{V[1]}', '.vhead')
    sec = g.inner_text('[data-panel=basic]')
    ok('مفوض تجريبي أحمد' in sec and _d(730) in sec, 'vehicle card shows the delegate and licence expiry')
    ok(g.locator('[data-plan-link]').count() == 1 and '2 من 5' in g.inner_text('[data-plan-link]'), 'vehicle card links to its plan with progress')
    g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=delegate_name]'); g.wait_for_timeout(300)
    ok(g.input_value('.modal [name=delegate_name]') == 'مفوض تجريبي أحمد' and g.input_value('.modal [name=delegate_license_expiry]') == _d(730), 'card form shows the delegate and licence date')
    fill_date(g, 'insurance_expiry', _d(330)); save(g); closed(g)
    ok(sql(f"select status || '/' || source from renewal_steps where plan_id = '{plan_id}' and step_no = 3") == 'done/card', 'insurance from the card completes step 3')
    # 6) fines + registration -> plan complete with a notification
    go(g, f'#/renewal/{plan_id}', '.rn-steps')
    ok(g.get_attribute('.rn-step.next', 'data-step') == '4' and 'بطاقة السيارة' in g.inner_text('.rn-step[data-step="3"]'), 'plan shows step 3 done from the card, next step 4')
    g.click('.rn-step.next [data-act=confirm]'); g.wait_for_selector('.modal [name=fines_status]'); g.select_option('.modal [name=fines_status]', value='paid'); g.fill('.modal [name=notes]', 'سداد تجريبي'); save(g); closed(g)
    g.click('.rn-step.next [data-act=confirm]'); g.wait_for_selector('.modal [name=new_expiry]'); fill_date(g, 'new_expiry', _d(1095)); save(g); g.wait_for_selector('.toast'); closed(g)
    ok('اكتملت خطة تجديد السيارة' in toast(g), f'notification when the plan completes [{toast(g)}]')
    g.wait_for_selector('.rn-banner.ok-box')
    ok(sql(f"select status from renewal_plans where id = '{plan_id}'") == 'completed', 'plan completed in the database')
    ok(sql(f"select max(expiry_date) from documents where vehicle_id = '{V[1]}' and doc_type = 'registration'") == _d(1095, '-'), 'registration date written to the vehicle')
    with g.expect_download(timeout=60000) as dl:
        g.click('[data-act=pdf]')
    f = dl.value.path(); head = open(f, 'rb').read(5)
    ok(head == b'%PDF-' and dl.value.suggested_filename == PLATE1 + '.pdf', f'PDF report downloaded ({dl.value.suggested_filename})')
    # 7) same delegate on a second vehicle (typed differently) -> one record; licence change asks first
    go(g, f'#/vehicles/{V[2]}', '.vhead')
    g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=delegate_name]'); g.wait_for_timeout(300)
    g.fill('.modal [name=delegate_name]', 'مفوض  تجريبي احمد'); g.locator('.modal [name=delegate_name]').dispatch_event('input'); g.wait_for_timeout(300)
    ok(g.input_value('.modal [name=delegate_license_expiry]') == _d(730), 'choosing a saved delegate fills his licence date')
    fill_date(g, 'delegate_license_expiry', _d(1826)); save(g)
    g.wait_for_selector('.modal [data-yes]')
    ok('2 سيارات' in g.inner_text('.modal:last-of-type'), 'asks before updating the licence of a delegate with several vehicles')
    yes(g); closed(g)
    ok(sql('select count(*) from delegates') == '1', 'no duplicate delegate created (one file, two vehicles)')
    ok(sql(f"select count(*) from vehicles where delegate_id is not null") == '2', 'delegate linked to two vehicles')
    ok(sql('select license_expiry from delegates') == _d(1826, '-'), 'licence updated once for all vehicles')
    ok('مفوّض على' in g.inner_text('[data-panel=basic]'), 'card says the delegate has several vehicles')
    # 8) duplicate warning and merge
    sql("insert into delegates(full_name) values ('مفوض تجريبى احمد')")
    go(g, f'#/vehicles/{V[1]}', '.vhead')
    ok(g.locator('.dlg-dup-alert').count() == 1, 'vehicle card warns that the delegate is duplicated')
    g.click('.dlg-dup-alert a'); g.wait_for_selector('[data-merge]'); g.click('[data-merge]'); yes(g); g.wait_for_timeout(600)
    ok(sql('select count(*) from delegates where deleted_at is null') == '1' and sql('select count(*) from delegates') == '2', 'merge keeps one file and archives the copy (nothing deleted)')
    go(g, f'#/vehicles/{V[1]}', '.vhead')
    ok(g.locator('.dlg-dup-alert').count() == 0, 'warning gone after merge')
    # 9) plans by vehicle status + search
    go(g, '#/renewal?status=', '.rn-list')
    ok(g.locator('.rn-chip').count() == 7, 'plans can be filtered by the six vehicle statuses')
    go(g, '#/search?q=' + 'احمد', '.page-head')
    ok(g.locator('[data-search-delegates] .rn-card').count() == 1 and g.locator('[data-search-plans] .rn-card').count() >= 1, 'search by delegate name finds the delegate and his plans')
    go(g, '#/search?q=' + PLATE1.split()[-1], '.page-head')
    ok(g.locator(f'[data-search-plans] [data-plan="{plan_id}"]').count() == 1, 'search by plate finds the plan')
    # 10) dashboard counts per status, phone layout
    sql(f"select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-000000000001', false); select create_renewal_plan('{V[2]}')")
    go(g, '#/dashboard', '[data-renewal]')
    outside = g.locator('[data-vdocs] .vdoc-boxes li[data-k=outside] .rn-plans-link').inner_text()
    ok('1' in outside, f'plan counted under the status of its vehicle (outside: {outside})')
    # clicking a status box shows its plans right there; a vehicle row opens or creates its plan directly
    g.click('[data-vdocs] [data-dpick=outside]'); g.wait_for_timeout(300)
    ok(g.locator(f'[data-renewal] [data-plan="{sql(chr(32).join(["select id from renewal_plans where vehicle_id =", repr(V[2]), "and deleted_at is null"]))}"]').count() == 1 and 'خارج المواقع' in g.inner_text('[data-renewal] h3'), 'status box shows its plans directly in the section')
    g.click('[data-vdocs] [data-dpick=inside]'); g.wait_for_timeout(300)
    ok(g.locator('[data-renewal] .rn-card').count() == 0 and 'داخل المواقع' in g.inner_text('[data-renewal]'), 'box without active plans says so')
    g.click('[data-vdocs] .vdoc-boxes li[data-k=outside] [data-rn-place]'); g.wait_for_timeout(300)
    ok(g.locator('[data-vdocs] [data-dpick=outside].on').count() == 1 and g.url.endswith('dashboard') or '#/dashboard' in g.url, 'plans count link filters in place (no page change)')
    for k in ['inside', 'stopped', 'maintenance', 'accident', 'workshop']:
        if g.locator('[data-vdocs] [data-dpick].on').count(): g.click('[data-vdocs] [data-dpick].on'); g.wait_for_timeout(200)
        g.click(f'[data-vdocs] [data-dpick={k}]'); g.wait_for_timeout(300)
        if g.locator('[data-vdocs-list] [data-rn-create]').count(): break
    rows_create = g.locator('[data-vdocs-list] [data-rn-create]')
    if rows_create.count():
        vid = rows_create.first.get_attribute('data-rn-create'); rows_create.first.click(); g.wait_for_selector('.rn-steps')
        ok(sql(f"select count(*) from renewal_plans where vehicle_id = '{vid}' and deleted_at is null") == '1', '«+ خطة» beside a vehicle creates its plan and opens it')
    else:
        ok(g.locator('[data-vdocs-list] [data-rn-open]').count() >= 1, 'vehicle rows link straight to their plans')
    # date checks before saving (Saudi periods): wrong insurance length / older date -> warning, «تصحيح» keeps the form
    p2 = sql(f"select id from renewal_plans where vehicle_id = '{V[2]}' and deleted_at is null")
    go(g, f'#/renewal/{p2}', '.rn-steps')
    g.click('.rn-step[data-step="3"] [data-act=confirm]'); g.wait_for_selector('.modal [name=new_expiry]'); fill_date(g, 'new_expiry', _d(900)); save(g)
    g.wait_for_selector('.modal [data-yes]'); txt = g.inner_text('.modal:last-of-type')
    ok('سنة واحدة' in txt and 'حفظ على أي حال' in txt, f'warning when the insurance period is not one year [{txt[:120]}]')
    g.click('.modal [data-no]'); g.wait_for_timeout(400)
    ok(g.locator('.modal [name=new_expiry]').count() == 1 and sql(f"select status from renewal_steps where plan_id = '{p2}' and step_no = 3") != 'done', '«تصحيح» returns to the form without saving')
    fill_date(g, 'new_expiry', _d(-2)); save(g); g.wait_for_selector('.modal [data-yes]')
    ok('قبل اليوم' in g.inner_text('.modal:last-of-type'), 'warning when the new date is before today')
    g.click('.modal [data-no]'); g.wait_for_timeout(300)
    fill_date(g, 'new_expiry', _d(365)); save(g); closed(g)
    ok(sql(f"select status from renewal_steps where plan_id = '{p2}' and step_no = 3") == 'done', 'a correct one-year insurance date saves with no warning')
    g.click('[data-plan-note] [data-act=note]'); g.wait_for_selector('.modal [name=note]'); g.fill('.modal [name=note]', 'ملاحظة تجريبية على السيارة'); save(g); closed(g)
    ok(sql(f"select notes from renewal_plans where id = '{p2}'") == 'ملاحظة تجريبية على السيارة' and 'ملاحظة تجريبية' in g.inner_text('[data-plan-note]'), 'plan note written and shown on the plan page')
    g.click('.rn-step[data-step="5"] [data-act=confirm]'); g.wait_for_selector('.modal [name=new_expiry]'); fill_date(g, 'new_expiry', _d(1095)); save(g)
    g.wait_for_selector('.modal [data-yes]'); txt = g.inner_text('.modal:last-of-type')
    ok('المخالفات' in txt, 'registration renewal warns when fines are not settled')
    g.click('.modal [data-no]'); g.wait_for_timeout(300); g.click('.modal [data-close].btn'); g.wait_for_timeout(300)
    if g.locator('.modal [data-yes]').count(): g.click('.modal [data-yes]')
    c.close()
    c, g = new_ctx(b, 390, 844); login(g)
    for h, sel, n in [('#/dashboard', '[data-renewal]', '02-dashboard-phone'), (f'#/renewal/{plan_id}', '.rn-steps', '03-plan-phone'), ('#/delegates', '.rn-list', '04-delegates-phone')]:
        go(g, h, sel); ok(not overflow(g), f'no sideways scrolling on the phone: {h}'); g.screenshot(path=f'{OUT}/{n}.png', full_page=True)
    p2 = sql(f"select id from renewal_plans where vehicle_id = '{V[2]}' and deleted_at is null")
    go(g, f'#/renewal/{p2}', '.rn-steps'); g.screenshot(path=f'{OUT}/05-plan2-phone.png', full_page=True)
    c.close()
    # 11) view-only user: can read, cannot confirm
    c, g = new_ctx(b); login(g, 'viewer@test.local')
    go(g, f'#/renewal/{p2}', '.rn-steps')
    ok(g.locator('[data-act=confirm]').count() == 0 and g.locator('[data-act=save]').count() == 0, 'view-only user cannot record or confirm steps')
    c.close(); b.close()

for m in passed: print('PASS', m)
for m in problems: print('FAIL', m)
print(f'PASS {len(passed)} FAIL {len(problems)}')
