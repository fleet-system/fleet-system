"""v1.3: new vehicle card (add + edit): five sections in order, manual input + suggestions, operating state with
three options (+ free text for «أخرى»), document days/status, costs without double counting, permanent saving,
old vehicles open and edit without losing data, ID numbers protected. Usage: python3 -I ui_vehicle_card.py OUTDIR"""
import sys, os, subprocess, re
import datetime as _dt, zoneinfo as _zi
from playwright.sync_api import sync_playwright
_T0 = _dt.datetime.now(_zi.ZoneInfo('Asia/Riyadh')).date()
def _d(n=0, sep='/'): return (_T0 + _dt.timedelta(days=n)).strftime(f'%Y{sep}%m{sep}%d')
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
V2 = 'b0000000-0000-0000-0000-000000000002'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def new_ctx(b, w):
    c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.app, .panels, #page')
    g.wait_for_timeout(300)
def fill(g, vals):
    for n, v in vals.items():
        el = g.locator(f'.modal [name="{n}"]').first
        if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(value=v)
        else: el.fill(v)
    g.wait_for_timeout(120)
def opts(g, name): return g.evaluate(f"[...document.querySelector('.modal [name={name}]').list.options].map(o => o.value)")
def open_vehicle(g, vid, tab='basic'):
    g.goto(f'{BASE}#/vehicles/{vid}?tab={tab}&r={os.urandom(3).hex()}'); g.wait_for_selector('.vhead')
def edit(g, vid):
    open_vehicle(g, vid); g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=plate_letters]'); g.wait_for_timeout(200)
def save(g):
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_selector('.vhead')
def basic(g): return g.inner_text('[data-panel=basic]')

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = new_ctx(b, 1280); login(g)
    nveh = int(sql('select count(*) from vehicles'))

    # ---------- 1. add a vehicle with every field
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=plate_letters]'); g.wait_for_timeout(200)
    heads = g.locator('.modal .form-sec').all_inner_texts()
    ok([h.split(':')[0] for h in heads] == ['أولاً', 'ثانياً', 'ثالثاً', 'رابعاً', 'خامساً'], f'1. five sections in the requested order ({len(heads)})')
    names = g.evaluate("[...document.querySelectorAll('.modal form [name]')].filter(e => !e.classList.contains('native') && e.type !== 'file' && !e.name.endsWith('__t')).map(e => e.name)")
    want = ['plate_letters', 'plate_digits', 'make', 'model', 'manufacture_year', 'vin', 'registration_type', 'wheels_count',
            'site_name', 'op_state', 'op_state_text', 'notes', 'current_user_name', 'card_auth_status', 'card_auth_expiry', 'current_user_id_no', 'current_user_mobile', 'owner_company', 'owner_id_no',
            'registration_serial', 'registration_expiry', 'inspection_expiry', 'insurance_expiry', 'cost_oil', 'cost_maint', 'cost_maint_total']
    ok(names == want, f'1. fields in the requested order {names if names != want else ""}')
    subs = g.locator('.modal .form-subsec').all_inner_texts()
    ok(subs == ['أ. رخصة السير والاستمارة', 'ب. الفحص الدوري', 'ج. التأمين'], '1. documents split into three sub-parts')
    ok(g.inner_text('.modal [data-save]') == 'حفظ السيارة' and g.inner_text('.modal [data-close].btn') == 'إلغاء', '1. buttons «حفظ السيارة» and «إلغاء»')
    ok(g.evaluate("[...document.querySelector('.modal [name=op_state]').options].map(o => o.textContent)") == ['تعمل داخل الموقع', 'تعمل خارج الموقع', 'متوقفة', 'تحت الصيانة', 'متضررة بحادث', 'في الورشة', 'أخرى'], '4. operating state options (1.14: fixed states linked to the dashboard + «أخرى»)')
    ok(g.locator('.modal [name=op_state_text]').is_hidden(), '6. free-text state hidden unless «أخرى»')
    # 2. brand-new make and model (not in suggestions)
    ok('ماركة البطاقة' not in opts(g, 'make'), '2. new make not in suggestions before saving')
    fill(g, {'plate_letters': 'ب ط ق', 'plate_digits': '٤٥٦', 'make': 'ماركة البطاقة', 'model': 'طراز البطاقة', 'manufacture_year': '2022', 'vin': 'jt1 abc 123', 'registration_type': 'نقل خاص',
             'wheels_count': '6', 'site_name': 'مشروع البطاقة الجديد', 'op_state': 'inside', 'notes': 'سطر أول\nسطر ثانٍ للملاحظة',
             'current_user_name': 'مستخدم البطاقة', 'current_user_id_no': '0012345678', 'current_user_mobile': '0551234567',
             'owner_company': 'شركة روى الرمال الزراعية', 'owner_id_no': '0700000001',
             'registration_serial': '0099887', 'registration_expiry': _d(100), 'inspection_expiry': _d(10), 'insurance_expiry': _d(-5),
             'cost_oil': '150.50', 'cost_maint': '400'})
    g.wait_for_timeout(200)
    lv = lambda n: g.inner_text(f'.modal [data-live={n}]')
    ok('100 يوم' in lv('reg_live') and 'ساري' in lv('reg_live'), f'8. registration: 100 days, ساري ({lv("reg_live")})')
    ok('10 يوم' in lv('insp_live') and 'قريب الانتهاء' in lv('insp_live'), '8. inspection: 10 days, قريب الانتهاء')
    ok('منتهي منذ 5 يوم' in lv('ins_live') and 'منتهي' in lv('ins_live'), '8. insurance: expired 5 days ago')
    ok(g.locator('.modal [data-live=reg_live] input').count() == 0, '8. days/status are display only (not editable)')
    ok('550.50' in lv('cost_live') and 'مجموع' in lv('cost_live'), '9. total = 150.50 + 400 = 550.50 with its source')
    ok('✓' in g.inner_text('.modal [data-check=current_user_mobile]'), 'driver phone validated while typing')
    g.screenshot(path=f'{OUT}/vc-add-desktop.png', full_page=True)
    save(g)
    vid = sql("select id from vehicles where plate_no='ب ط ق 456'")
    ok(len(vid) == 36 and int(sql('select count(*) from vehicles')) == nveh + 1, '1. saved as one new vehicle (plate «ب ط ق 456»)')
    row = sql(f"select make||'|'||model||'|'||manufacture_year||'|'||vin||'|'||registration_type||'|'||wheels_count||'|'||op_state||'|'||location_status||'|'||current_user_name||'|'||current_user_mobile||'|'||registration_serial||'|'||insurance_expiry||'|'||cost_oil||'|'||cost_maint||'|'||coalesce(cost_maint_total::text,'NULL') from vehicles where id='{vid}'")
    ok(row == f"ماركة البطاقة|طراز البطاقة|2022|JT1ABC123|نقل خاص|6|inside|inside_site|مستخدم البطاقة|+966551234567|0099887|{_d(-5, '-')}|150.50|400.00|NULL", f'1. every field stored in the database ({row})')
    ok(sql(f"select current_user_id_no||'|'||owner_id_no from vehicle_private where vehicle_id='{vid}'") == '0012345678|0700000001', '1. ID numbers stored with leading zeros (protected table)')
    ok(sql(f"select string_agg(doc_type||'='||expiry_date, ',' order by doc_type::text) from documents where vehicle_id='{vid}'") == f"periodic_inspection={_d(10, '-')},registration={_d(100, '-')}", '8. registration + inspection saved as documents (alerts keep working)')
    ok(sql("select count(*) from sites where name='مشروع البطاقة الجديد'") == '1', '1. new project name saved for future suggestions')
    t = basic(g)
    order = [t.find(x) for x in ['أولاً', 'ثانياً', 'ثالثاً', 'رابعاً', 'خامساً']]
    ok(all(i >= 0 for i in order) and order == sorted(order), '1. vehicle card shows the five sections in order')
    for frag, what in [('ب ط ق', 'plate letters'), ('456', 'plate digits'), ('ماركة البطاقة', 'make'), ('طراز البطاقة', 'model'), ('JT1ABC123', 'VIN'), ('نقل خاص', 'registration type'),
                       ('مشروع البطاقة الجديد', 'project'), ('تعمل داخل الموقع', 'operating state'), ('سطر ثانٍ للملاحظة', 'note'), ('0012345678', 'user ID with zeros'),
                       ('0700000001', 'owner ID with zeros'), ('0099887', 'registration serial'), ('قريب الانتهاء', 'inspection status'), ('منتهي منذ 5 يوم', 'insurance expired'),
                       ('150.50', 'oil cost'), ('550.50', 'total')]:
        ok(frag in t, f'1. card shows {what}')
    g.screenshot(path=f'{OUT}/vc-card-desktop.png', full_page=True)

    # ---------- 2/3. suggestions
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt')
    ok('تعمل داخل الموقع' in g.inner_text('#vt'), '4. operating state shown in the vehicles list')
    g.click('[data-act=new]'); g.wait_for_selector('.modal [name=make]'); g.wait_for_timeout(200)
    ok('ماركة البطاقة' in opts(g, 'make'), '2. the new make is now suggested')
    fill(g, {'make': 'ماركة البطاقة'}); g.locator('.modal [name=make]').dispatch_event('change'); g.wait_for_timeout(150)
    ok('طراز البطاقة' in opts(g, 'model'), '2. its new model is suggested for that make')
    fill(g, {'make': 'تويوتا'}); g.locator('.modal [name=make]').dispatch_event('change'); g.wait_for_timeout(150)
    mo = opts(g, 'model')
    ok('هايلكس' in mo and 'نافارا' not in mo and 'طراز البطاقة' not in mo, '3. choosing a saved make shows only its models')
    ok('مشروع البطاقة الجديد' in opts(g, 'site_name') and 'مستخدم البطاقة' in opts(g, 'current_user_name') and 'نقل خاص' in opts(g, 'registration_type'),
       'suggestions for project, current user and registration type')
    g.click('.modal [data-close]'); g.wait_for_timeout(150)
    if g.locator('[data-yes]').count(): g.click('[data-yes]')
    g.wait_for_selector('.modal', state='detached')

    # ---------- 5. outside
    edit(g, vid)
    ok(g.inner_text('.modal [data-save]') == 'حفظ التعديلات', '5. edit button reads «حفظ التعديلات»')
    ok(g.input_value('.modal [name=current_user_mobile]') == '0551234567' and g.input_value('.modal [name=current_user_id_no]') == '0012345678', 'edit form keeps leading zeros (phone, ID)')
    ok(g.input_value('.modal [name=registration_expiry]') == _d(100) and g.input_value('.modal [name=notes]') == 'سطر أول\nسطر ثانٍ للملاحظة', '7. edit form loads saved dates and the note')
    fill(g, {'op_state': 'outside'}); save(g)
    ok('تعمل خارج الموقع' in basic(g) and sql(f"select op_state||'|'||location_status from vehicles where id='{vid}'") == 'outside|outside_site', '5. «تعمل خارج الموقع» saved and shown')
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); ok('تعمل خارج الموقع' in g.inner_text('#vt'), '5. list shows «تعمل خارج الموقع»')

    # ---------- 6. other + free text
    edit(g, vid); fill(g, {'op_state': 'other'})
    ok(g.locator('.modal [name=op_state_text]').is_visible(), '6. «أخرى» shows «اكتب الحالة التشغيلية»')
    g.click('.modal [data-save]'); g.wait_for_selector('.modal .form-error:not([hidden])')
    ok('اكتب الحالة التشغيلية' in g.inner_text('.modal .form-error'), '6. «أخرى» without a description is not saved, clear message')
    fill(g, {'op_state_text': 'متوقفة مؤقتاً بانتظار قطع غيار'})
    fill(g, {'op_state': 'inside'}); fill(g, {'cost_oil': '160'}); fill(g, {'op_state': 'other'})
    ok(g.input_value('.modal [name=op_state_text]') == 'متوقفة مؤقتاً بانتظار قطع غيار', '6. description kept while switching options and editing other fields')
    save(g)
    ok('أخرى: متوقفة مؤقتاً بانتظار قطع غيار' in basic(g), '6. card shows «أخرى» with the description')
    g.goto(BASE + '#/dashboard'); g.wait_for_timeout(500); open_vehicle(g, vid)
    ok('متوقفة مؤقتاً بانتظار قطع غيار' in basic(g), '6. description still there after leaving and coming back')
    g.reload(); g.wait_for_selector('.vhead')
    ok('متوقفة مؤقتاً بانتظار قطع غيار' in basic(g) and sql(f"select op_state||'|'||op_state_text from vehicles where id='{vid}'") == 'other|متوقفة مؤقتاً بانتظار قطع غيار', '11. after reload: «أخرى» + description from the database')
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); ok('أخرى: متوقفة مؤقتاً' in g.inner_text('#vt'), '6. list shows the description')
    edit(g, vid)
    ok(g.input_value('.modal [name=op_state]') == 'other' and g.locator('.modal [name=op_state_text]').is_visible(), '6. reopening the edit card shows «أخرى» and its text')
    # ---------- 8. change a document date: same document updated, no duplicate
    fill(g, {'inspection_expiry': _d(200), 'cost_maint_total': '600'}); save(g)
    ok(sql(f"select count(*)||'|'||max(expiry_date) from documents where vehicle_id='{vid}' and doc_type='periodic_inspection' and deleted_at is null") == f"1|{_d(200, '-')}", '8. changed inspection date updates the same document (no duplicate)')
    t = basic(g)
    ok('ساري' in t and '600.00' in t and 'مدخل يدوياً' in t, '9. manual total 600 shown as «مدخل يدوياً»')
    # ---------- 9. detailed records exist -> total from records only (no double counting)
    g.click('.vactions [data-act=oil]'); g.wait_for_selector('.modal [name=odometer]'); g.wait_for_timeout(200)
    fill(g, {'odometer': '1000', 'oil_cost': '100'}); g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached'); g.wait_for_timeout(500)
    open_vehicle(g, vid); t = basic(g)
    ok('100.00' in t and 'محسوب من السجلات' in t and '760' not in t, '9. with records the total comes from records only (100), manual amounts not added twice')
    edit(g, vid)
    ok(g.locator('.modal [name=cost_maint_total]').get_attribute('readonly') is not None and g.input_value('.modal [name=cost_maint_total]') in ('100', '100.00'), '9. total read-only in the form when calculated from records')
    fill(g, {'wheels_count': '4'}); save(g)
    ok(sql(f"select cost_maint_total from vehicles where id='{vid}'") == '600.00', '9. manual total kept in the database, not overwritten')
    ok(int(sql('select count(*) from vehicles')) == nveh + 1, '12. editing never creates a duplicate vehicle')

    # ---------- 12. old vehicle opens and edits without losing data
    before = sql(f"select concat_ws('|', coalesce(color,''), coalesce(vehicle_type,''), coalesce(engine_no,''), plate_no, location_status, coalesce(op_state,'NULL'), owner_company_id) from vehicles where id='{V2}'")
    edit(g, V2)
    ok(g.input_value('.modal [name=plate_letters]') == 'د هـ و' and g.input_value('.modal [name=plate_digits]') == '5678', '12. old plate split into letters and digits')
    ok(g.input_value('.modal [name=op_state]') in ('inside', 'outside', 'other'), '12. old vehicle shows an operating state taken from its saved location')
    fill(g, {'wheels_count': '4'}); save(g)
    after = sql(f"select concat_ws('|', coalesce(color,''), coalesce(vehicle_type,''), coalesce(engine_no,''), plate_no, location_status, coalesce(op_state,'NULL'), owner_company_id) from vehicles where id='{V2}'")
    ok(before.split('|')[:5] == after.split('|')[:5] and before.split('|')[6] == after.split('|')[6], f'12. old data unchanged (colour, type, engine, plate, location, owner): {before} -> {after}')
    ok(sql(f"select wheels_count from vehicles where id='{V2}'") == '4', '12. old vehicle edit saved to the same record')
    ok('بيانات أخرى محفوظة سابقاً' in basic(g), '12. old fields still viewable on the card (not deleted)')
    c.close()

    # ---------- viewer: IDs hidden
    c, g = new_ctx(b, 390); login(g, 'viewer@test.local'); open_vehicle(g, vid)
    t = basic(g)
    ok('0012345678' not in t and 'مخفي' in t, 'viewer cannot see ID numbers')
    c.close()
    # ---------- mobile layout + another device
    c, g = new_ctx(b, 390); login(g); open_vehicle(g, vid)
    ok('متوقفة مؤقتاً بانتظار قطع غيار' in basic(g), '10. another device sees the same saved card')
    g.screenshot(path=f'{OUT}/vc-card-mobile.png', full_page=True)
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=plate_letters]'); g.wait_for_timeout(200)
    cols = g.evaluate("getComputedStyle(document.querySelector('.modal .form-grid')).gridTemplateColumns.split(' ').length")
    ok(cols == 1 and g.evaluate('document.querySelector(".modal-panel").scrollWidth <= document.querySelector(".modal-panel").clientWidth + 1'), 'one column on mobile, no sideways scrolling')
    g.screenshot(path=f'{OUT}/vc-add-mobile.png', full_page=True)
    c.close()
    c, g = new_ctx(b, 1280); login(g)
    g.goto(BASE + '#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=plate_letters]'); g.wait_for_timeout(200)
    ok(g.evaluate("getComputedStyle(document.querySelector('.modal .form-grid')).gridTemplateColumns.split(' ').length") == 2, 'two columns on large screens')
    c.close()
    b.close()

print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
