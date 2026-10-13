"""v1.0: free-text company/site/people, registration data, driver documents, employee links,
oil payer text and invoice photo inside the oil form. Every value is re-opened and checked in the database.
Usage: python3 -I ui_freetext.py OUTDIR   (fleet_ui reset with ui_seed.sql)"""
import sys, os, subprocess, datetime
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__)); FX = os.path.join(HERE, 'fixtures')
BASE = 'http://localhost:8787/'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
PSQL = ['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui']
def sql(q): return subprocess.run(PSQL + ['-c', q], capture_output=True, text=True).stdout.strip()
TODAY = datetime.date.fromisoformat(sql('select app_today()'))
d = lambda n: (TODAY + datetime.timedelta(days=n)).strftime('%Y/%m/%d')

def ctx(b, w=1280):
    c = b.new_context(viewport={'width': w, 'height': 900}, device_scale_factor=2, locale='ar-SA', timezone_id='Asia/Riyadh')
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card')
    g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def fill(g, vals):
    for n, v in vals.items():
        el = g.locator(f'.modal [name="{n}"]').last
        if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(value=v)
        elif el.get_attribute('type') == 'checkbox': el.check() if v else el.uncheck()
        else: el.fill(v)
def val(g, n): return g.locator(f'.modal [name="{n}"]').last.input_value()

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = ctx(b); login(g)

    # ---------- add vehicle (v1.3 card) with free-text values: new owner company and new project
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=registration_type]')
    ok(g.locator('.modal [name=owner_company]').get_attribute('list') is not None and g.locator('.modal [name=current_user_name]').get_attribute('list') is not None,
       'owner and current user are free-text fields with suggestions')
    fill(g, {'plate_letters': 'ح ط ي', 'plate_digits': '7788', 'registration_type': 'نقل خاص', 'registration_serial': 'SN-778899', 'make': 'إيسوزو', 'model': 'D-Max',
             'owner_company': 'شركة الاختبار للنقل', 'site_name': 'مستودع الخرج', 'current_user_name': 'محمد المستخدم', 'registration_expiry': d(300)})
    g.screenshot(path=f'{OUT}/f-add-vehicle.png', full_page=True)
    g.click('.modal [data-save]'); g.wait_for_selector('.vhead', timeout=30000)
    row = sql("select v.registration_type||'|'||v.registration_serial||'|'||c.name||'|'||s.name||'|'||sc.name||'|'||v.current_user_name "
              "from vehicles v join companies c on c.id=v.owner_company_id join sites s on s.id=v.site_id join companies sc on sc.id=s.company_id where v.plate_no='ح ط ي 7788'")
    ok(row == 'نقل خاص|SN-778899|شركة الاختبار للنقل|مستودع الخرج|شركة الاختبار للنقل|محمد المستخدم',
       f'vehicle saved: registration, new company + new site registered ({row})')
    # driver: typed new name in the driver tab creates the employee and links it
    g.click('.tabbtn[data-tab=driver]'); g.click('.tab-panel.on [data-act=driver]'); g.wait_for_selector('.modal [name=driver]')
    fill(g, {'driver': 'سالم السائق الجديد'}); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_selector('.tab-panel.on[data-panel=driver] .person')
    eid = sql("select id from employees where full_name='سالم السائق الجديد'")
    ok(len(eid) == 36 and sql(f"select count(*) from vehicle_assignments where employee_id='{eid}' and end_at is null") == '1', 'new driver created, linked, responsibility period opened')
    g.click('[data-act=ddocs]'); g.wait_for_selector('.modal [name=license_expiry]')
    fill(g, {'iqama_no': '2000000123', 'iqama_expiry': d(20), 'license_expiry': d(-5)}); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(700)
    ok(sql(f"select iqama_no from employee_private where employee_id='{eid}'") == '2000000123', 'driver iqama number saved (sensitive table)')
    ok(sql(f"select string_agg(doc_type||'='||expiry_date, ',' order by doc_type::text) from documents where employee_id='{eid}'") ==
       f"driving_license={(TODAY + datetime.timedelta(days=-5)).isoformat()},iqama={(TODAY + datetime.timedelta(days=20)).isoformat()}", 'driver iqama and license expiry saved as documents')

    # ---------- vehicle file shows everything; driver documents with status
    g.click('.tabbtn[data-tab=basic]'); t = g.inner_text('[data-panel=basic]')
    for frag in ['نقل خاص', 'SN-778899', 'محمد المستخدم', 'شركة الاختبار للنقل', 'مستودع الخرج']:
        ok(frag in t, f'vehicle file shows «{frag}»')
    g.click('.tabbtn[data-tab=driver]'); g.wait_for_timeout(200)
    t = g.inner_text('[data-panel=driver]')
    ok('وثائق السائق' in t and 'سالم السائق الجديد' in t and '2000000123' in t, 'driver documents section with name and iqama number')
    ok('اقتربت من الانتهاء' in t and 'باقي 20 يوم' in t, 'iqama: expiring soon, 20 days left')
    ok('منتهية' in t and 'منتهية منذ 5 يوم' in t, 'license: expired 5 days ago')
    g.screenshot(path=f'{OUT}/f-driver-docs.png', full_page=True)
    g.click('[data-act=ddocs]'); g.wait_for_selector('.modal [name=license_expiry]')
    fill(g, {'license_expiry': '2028/05/01'}); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(700)
    g.click('.tabbtn[data-tab=driver]'); g.wait_for_timeout(200)
    t = g.inner_text('[data-panel=driver]')
    ok('2028/05/01' in t and 'سارية' in t, 'license renewed: new date, status «سارية»')
    ok(sql(f"select count(*) from documents where employee_id='{eid}' and doc_type='driving_license'") == '2', 'old license record kept (history)')

    # ---------- edit vehicle: switch to an existing company, change driver to existing employee
    vid = sql("select id from vehicles where plate_no='ح ط ي 7788'")
    g.click('.tabbtn[data-tab=basic]'); g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=owner_company]'); g.wait_for_timeout(200)
    ok(val(g, 'owner_company') == 'شركة الاختبار للنقل' and val(g, 'site_name') == 'مستودع الخرج' and val(g, 'registration_serial') == 'SN-778899',
       'edit form re-opens with saved values')
    fill(g, {'owner_company': 'شركة روى الرمال الزراعية', 'current_user_name': 'أحمد المستخدم'})
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(800)
    g.click('.tabbtn[data-tab=driver]'); g.click('.tab-panel.on [data-act=driver]'); g.wait_for_selector('.modal [name=driver]')
    fill(g, {'driver': 'مشرف تجريبي'}); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(800)
    ok(sql(f"select c.name||'|'||v.current_user_name||'|'||e.full_name from vehicles v join companies c on c.id=v.owner_company_id join employees e on e.id=v.current_driver_id where v.id='{vid}'")
       == 'شركة روى الرمال الزراعية|أحمد المستخدم|مشرف تجريبي', 'edit saved: existing company linked, user text, driver switched')
    ok(sql(f"select count(*) from vehicle_assignments where vehicle_id='{vid}'") == '2' and sql(f"select count(*) from vehicle_assignments where employee_id='{eid}' and end_at is not null") == '1',
       'previous driver period closed and kept')
    ok(sql("select count(*) from companies where name='شركة الاختبار للنقل'") == '1', 'typed company not duplicated')

    # ---------- add employee with new company/site and link to a vehicle
    g.goto(BASE + '#/employees'); g.wait_for_selector('#et'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=company_name]')
    fill(g, {'full_name': 'عامل تجريبي جديد', 'company_name': 'مؤسسة الصيانة المتحدة', 'site_name': 'فرع الرياض', 'job_title': 'سائق',
             'vehicle_id': 'b0000000-0000-0000-0000-000000000005', 'iqama_expiry': d(100)})
    g.click('.modal [data-save]'); g.wait_for_selector('.vhead', timeout=30000)
    r = sql("select c.name||'|'||s.name||'|'||sc.name from employees e join companies c on c.id=e.company_id join sites s on s.id=e.site_id join companies sc on sc.id=s.company_id where e.full_name='عامل تجريبي جديد'")
    ok(r == 'مؤسسة الصيانة المتحدة|فرع الرياض|مؤسسة الصيانة المتحدة', f'employee: new company and site registered ({r})')
    ok(sql("select e.full_name from vehicles v join employees e on e.id=v.current_driver_id where v.id='b0000000-0000-0000-0000-000000000005'") == 'عامل تجريبي جديد', 'employee linked to the vehicle as driver')
    g.click('[data-act=edit]'); g.wait_for_selector('.modal [name=company_name]')
    ok(val(g, 'company_name') == 'مؤسسة الصيانة المتحدة' and val(g, 'site_name') == 'فرع الرياض', 'employee edit re-opens with company and site')
    fill(g, {'site_name': 'مزرعة الغملاس'}); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(500)
    ok(sql("select s.name from employees e join sites s on s.id=e.site_id where e.full_name='عامل تجريبي جديد'") == 'مزرعة الغملاس', 'employee moved to an existing site')

    # ---------- oil change: free-text payer + invoice photo with preview
    g.goto(BASE + '#/oil'); g.wait_for_selector('.list-body'); g.click('[data-list-add]'); g.wait_for_selector('.modal [name=payer]')
    fill(g, {'vehicle_id': vid}); g.wait_for_timeout(200)
    fill(g, {'odometer': '6000', 'oil_cost': '150', 'filter_cost': '40', 'invoice_no': 'INV-55', 'payer': 'العهدة - مشرف الموقع'})
    g.locator('.modal input[name=invoice_file]').set_input_files(os.path.join(FX, 'invoice.jpg')); g.wait_for_timeout(300)
    ok(g.locator('.modal .file-prev img').count() == 1 and 'invoice.jpg' in g.inner_text('.modal .file-prev'), 'invoice preview shown before saving')
    g.screenshot(path=f'{OUT}/f-oil-form.png', full_page=True)
    g.click('.modal [data-file-clear]'); g.wait_for_timeout(100)
    ok(g.locator('.modal .file-prev img').count() == 0, 'attachment can be removed before saving')
    g.locator('.modal input[name=invoice_file]').set_input_files(os.path.join(FX, 'invoice.jpg')); g.wait_for_timeout(200)
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_timeout(800)
    oid = sql(f"select id from oil_changes where vehicle_id='{vid}'")
    ok(sql(f"select coalesce(payer_text,'')||'|'||coalesce(payer_company_id::text,'null')||'|'||odometer||'|'||next_odometer||'|'||total from oil_changes where id='{oid}'")
       == 'العهدة - مشرف الموقع|null|6000|16000|190.00', 'oil saved: payer text, odometer, next change, total')
    ok(sql(f"select count(*) from attachments where entity_type='oil_change' and entity_id='{oid}' and category='oil_invoice' and deleted_at is null") == '1', 'invoice photo saved and linked to the oil change')
    t = g.inner_text('.list-body')
    ok('العهدة - مشرف الموقع' in t and 'مرفقة (1)' in t, 'oil list shows payer and attached invoice')
    g.locator('.list-body tr:has-text("العهدة - مشرف الموقع") [data-row-act=att]').click(); g.wait_for_selector('.modal .att-box figure'); g.wait_for_timeout(800)
    ok('فاتورة تغيير زيت' in g.inner_text('.modal .att-box') and g.locator('.modal .att-box img[src^="blob:"], .modal .att-box img[src*="token"]').count() >= 1, 'invoice opens later from the record')
    g.click('.modal [data-x]') if g.locator('.modal [data-x]').count() else (g.click('.modal [data-close]'), g.wait_for_timeout(150), g.locator('[data-yes]').count() and g.click('[data-yes]'))
    g.wait_for_timeout(300)
    # edit without a file keeps the attachment
    g.locator('.list-body tr:has-text("العهدة - مشرف الموقع") [data-row-act=edit]').click(); g.wait_for_selector('.modal [name=payer]')
    ok(val(g, 'payer') == 'العهدة - مشرف الموقع' and val(g, 'invoice_no') == 'INV-55', 'oil edit re-opens payer and invoice number')
    fill(g, {'notes': 'تعديل ملاحظة'}); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(500)
    ok(sql(f"select count(*) from attachments where entity_id='{oid}' and deleted_at is null") == '1', 'editing the record does not lose the attachment')
    # replace the invoice
    g.locator('.list-body tr:has-text("العهدة - مشرف الموقع") [data-row-act=edit]').click(); g.wait_for_selector('.modal [name=payer]')
    g.locator('.modal input[name=invoice_file]').set_input_files(os.path.join(FX, 'doc.pdf')); fill(g, {'replace_invoice': True, 'payer': 'شركة روى الرمال الزراعية'})
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_timeout(800)
    ok(sql(f"select count(*) filter (where deleted_at is null)||'|'||count(*) filter (where deleted_at is not null)||'|'||max(file_name) filter (where deleted_at is null) from attachments where entity_id='{oid}'") == '1|1|doc.pdf',
       'invoice replaced by a PDF; old photo archived (not deleted)')
    ok(sql(f"select coalesce(payer_text,'null')||'|'||(payer_company_id='11111111-1111-1111-1111-111111111111') from oil_changes where id='{oid}'") == 'null|true', 'payer matching a registered company is linked to it')
    st = sql(f"select status||'|'||remaining_km from v_vehicle_oil_status where vehicle_id='{vid}'")
    ok(st.startswith('not_due|'), f'next oil change still computed from the vehicle interval ({st})')
    c.close()

    # ---------- mobile
    c, m = ctx(b, 390); login(m)
    m.goto(BASE + '#/oil'); m.wait_for_selector('.list-body'); m.click('[data-list-add]'); m.wait_for_selector('.modal [name=payer]')
    m.locator('.modal input[name=invoice_file]').set_input_files(os.path.join(FX, 'invoice.jpg')); m.wait_for_timeout(300)
    m.locator('.modal .file-field').scroll_into_view_if_needed(); m.screenshot(path=f'{OUT}/f-oil-mobile.png')
    ok(m.evaluate('document.querySelector(".modal-panel").scrollWidth <= document.querySelector(".modal-panel").clientWidth + 1'), 'mobile oil form fits the screen')
    (m.click('.modal [data-close]'), m.wait_for_timeout(150), m.locator('[data-yes]').count() and m.click('[data-yes]'))
    m.goto(BASE + '#/vehicles'); m.wait_for_selector('#vt'); m.click('[data-act=new]'); m.wait_for_selector('.modal [name=owner_company]'); m.screenshot(path=f'{OUT}/f-add-vehicle-mobile.png', full_page=True)
    c.close()

    # ---------- user without invoice permission: no invoice upload in the form
    sql("insert into user_permissions(user_id, permission) values ('a0000000-0000-0000-0000-000000000002','create'),('a0000000-0000-0000-0000-000000000002','edit')")
    c, v = ctx(b); login(v, 'viewer@test.local')
    v.goto(BASE + '#/oil'); v.wait_for_selector('.list-body'); v.click('[data-list-add]'); v.wait_for_selector('.modal [name=payer]')
    ok(v.locator('.modal input[name=invoice_file]').count() == 0, 'without «إدارة الفواتير» the invoice field is hidden')
    c.close()
    b.close()

print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
