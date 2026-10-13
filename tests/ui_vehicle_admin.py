"""v1.6: «إدارة بيانات السيارات» (field names, lists, extra fields, undo), «حذف البطاقة إلى السجل», archived log + restore,
full change history per vehicle with old/new values, full snapshot and «استعادة البيانات السابقة».
Usage: python3 -I ui_vehicle_admin.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
V1, V2 = 'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
OTHERS = ("select md5(string_agg(to_jsonb(v)::text, '|' order by id)) from (select id, plate_no, make, model, owner_company_id, site_id, current_driver_id, current_user_name, current_user_mobile, "
          "insurance_expiry, notes, custom_fields, deleted_at from vehicles where id::text like 'b0000000-%%' and id not in ('%s','%s')) v" % (V1, V2))
RECS = lambda vid: sql(f"select concat_ws('|', (select count(*) from oil_changes where vehicle_id='{vid}'), (select count(*) from maintenance where vehicle_id='{vid}'), (select count(*) from accidents where vehicle_id='{vid}'), (select count(*) from documents where vehicle_id='{vid}'), (select count(*) from handovers where vehicle_id='{vid}'))")

def new_ctx(b, w=1280):
    c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def goto(g, h, sel): g.goto(f'{BASE}#/{h}{"&" if "?" in h else "?"}r={os.urandom(3).hex()}'); g.wait_for_selector(sel)
def open_vehicle(g, vid, tab='basic'): goto(g, f'vehicles/{vid}?tab={tab}', '.vhead')
def save(g): g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000)
def edit(g, vid, vals, reason=None):
    open_vehicle(g, vid); g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=plate_letters]'); g.wait_for_timeout(250)
    for k, v in vals.items():
        el = g.locator(f'.modal [name="{k}"]').first
        if el.evaluate('e => e.tagName') == 'SELECT': el.select_option(value=v)
        else: el.fill(v)
    if reason: g.locator('.modal [name=change_note]').fill(reason)
    save(g); g.wait_for_selector('.vhead')

with sync_playwright() as p:
    b = p.chromium.launch()
    others0 = sql(OTHERS); recs1 = RECS(V1)
    sql(f"update vehicles set insurance_expiry = app_today() + 5 where id = '{V1}'")
    c, g = new_ctx(b); login(g)

    # ---------- 1. edit -> old and new kept
    edit(g, V1, {'current_user_name': 'أحمد محمد'})
    edit(g, V1, {'current_user_name': 'خالد علي'}, reason='تسليم السيارة لسائق جديد')
    open_vehicle(g, V1, 'log'); t = g.inner_text('[data-panel=log]')
    ok('سجل التعديلات' in g.inner_text('.tabs'), '1. vehicle file has a «سجل التعديلات» tab')
    ok('المستخدم الحالي' in t and 'أحمد محمد' in t and 'خالد علي' in t and 'تسليم السيارة لسائق جديد' in t and 'عبدالله المسؤول' in t,
       '1. history shows field, old value, new value, user and reason')
    ok(t.count('تعديل') >= 2 and t.index('خالد علي') < t.rindex('أحمد محمد'), '1. earlier change still there after a newer one (newest first)')
    g.locator('[data-panel=log] [data-hx-view]').first.click(); g.wait_for_selector('.snapshot')
    st = g.inner_text('.snapshot')
    ok('قبل التعديل' in st and 'بعد التعديل' in st and 'أحمد محمد' in st and 'خالد علي' in st and 'رقم اللوحة' in st, '1. full snapshot of the card before / after the change')
    g.screenshot(path=f'{OUT}/va-snapshot.png'); g.click('[data-no]'); g.wait_for_timeout(200)

    # ---------- 2. settings: extra fields, names, lists, undo
    nbk = int(sql("select count(*) from system_backups"))
    goto(g, 'settings', '.page-head'); ok('إدارة بيانات السيارات' in g.inner_text('#page') and 'سجل السيارات المحذوفة' in g.inner_text('#page'), '2. settings has «إدارة بيانات السيارات» and «سجل السيارات المحذوفة»')
    goto(g, 'settings/vehicle-fields', '[data-act=cf-new]')
    g.click('[data-act=cf-new]'); g.wait_for_selector('.modal [name=label]')
    g.fill('.modal [name=label]', 'لون الطلاء'); g.select_option('.modal [name=type]', 'select'); g.fill('.modal [name=options]', 'أبيض\nأسود\nفضي')
    g.select_option('.modal [name=section]', '1'); g.check('.modal [name=in_list]'); save(g); g.wait_for_selector('[data-cf-edit]')
    g.click('[data-act=cf-new]'); g.wait_for_selector('.modal [name=label]')
    g.fill('.modal [name=label]', 'تاريخ آخر غسيل'); g.select_option('.modal [name=type]', 'date'); g.select_option('.modal [name=section]', '6'); save(g); g.wait_for_timeout(500)
    ok(int(sql("select count(*) from system_backups")) > nbk, '2. automatic backup taken before saving field settings')
    ok('لون الطلاء' in g.inner_text('#page') and 'تاريخ آخر غسيل' in g.inner_text('#page'), '2. new fields listed in the settings')
    lab = g.locator('.labels-form [name=current_user_name]'); lab.fill('مستخدم السيارة'); g.click('[data-act=labels-save]'); g.wait_for_timeout(700)
    goto(g, 'settings/vehicle-fields', '[data-act=cf-new]')
    g.fill('.lists-form [name=registration_type]', 'خصوصي\nنقل خاص\nمؤقت'); g.click('[data-act=lists-save]'); g.wait_for_timeout(700)
    g.screenshot(path=f'{OUT}/va-settings.png', full_page=True)
    # the new field in the card form, saved and shown
    open_vehicle(g, V1); g.click('[data-panel=basic] [data-act=edit]'); g.wait_for_selector('.modal [name=plate_letters]'); g.wait_for_timeout(250)
    names = g.evaluate("[...document.querySelectorAll('.modal form [name]')].map(e => e.name)")
    ok('cf__' + sql("select x->>'key' from app_settings, jsonb_array_elements(value->'custom') x where key='vehicle_fields_config' and x->>'label'='لون الطلاء'") in names, '2. new field appears in the vehicle card form')
    ok('مستخدم السيارة' in g.inner_text('.modal') and 'مؤقت' in g.evaluate("[...document.querySelector('.modal [name=registration_type]').list.options].map(o=>o.value)"), '2. renamed field and new list option used in the form')
    key1 = sql("select x->>'key' from app_settings, jsonb_array_elements(value->'custom') x where key='vehicle_fields_config' and x->>'label'='لون الطلاء'")
    key2 = sql("select x->>'key' from app_settings, jsonb_array_elements(value->'custom') x where key='vehicle_fields_config' and x->>'label'='تاريخ آخر غسيل'")
    g.select_option(f'.modal [name=cf__{key1}]', 'أسود'); g.fill(f'.modal [name=cf__{key2}]', '2026/10/01'); save(g); g.wait_for_selector('.vhead')
    ok(sql(f"select custom_fields->>'{key1}' || '|' || (custom_fields->>'{key2}') from vehicles where id='{V1}'") == 'أسود|2026-10-01', '2. extra field values saved with the vehicle')
    t = g.inner_text('[data-panel=basic]')
    ok('لون الطلاء' in t and 'أسود' in t and 'تاريخ آخر غسيل' in t and '2026/10/01' in t and 'مستخدم السيارة' in t and 'خالد علي' in t, '2. card shows the extra fields and the renamed field (data unchanged)')
    goto(g, 'vehicles', '#vt'); ok('لون الطلاء' in g.inner_text('#vt thead') and 'أسود' in g.inner_text('#vt'), '2. extra field as a column in the vehicles list')
    # undo the settings (rename) -> back; extra fields created later are only switched off, values kept
    goto(g, 'settings/vehicle-fields', '[data-act=cf-new]')
    g.locator('[data-cfg-undo]').nth(3).click(); g.wait_for_selector('[data-yes]'); g.click('[data-yes]'); g.wait_for_timeout(900)
    cfg = sql("select value::text from app_settings where key='vehicle_fields_config'")
    ok('مستخدم السيارة' not in cfg and '"active": false' in cfg, f'2. undo: settings back to an earlier state; later fields switched off, not deleted')
    ok(sql(f"select custom_fields->>'{key1}' from vehicles where id='{V1}'") == 'أسود', '2. undo never removes stored values')
    open_vehicle(g, V1); t = g.inner_text('[data-panel=basic]')
    ok('المستخدم الحالي' in t and 'أسود' in t, '2. card back to the default name; switched-off field still shows its saved value')
    # re-activate field
    goto(g, 'settings/vehicle-fields', '[data-act=cf-new]'); g.click(f'[data-cf-edit="{key1}"]'); g.wait_for_selector('.modal [name=active]'); g.check('.modal [name=active]'); save(g); g.wait_for_timeout(600)

    # ---------- 3. delete card to the log
    al0 = sql(f"select count(*) from v_followups where subject_id='{V1}'")
    open_vehicle(g, V1); g.click('[data-act=archive]'); g.wait_for_selector('.modal [name=reason]')
    ok('لن يُحذف أي شيء' in g.inner_text('.modal'), '3. confirmation explains nothing is deleted')
    g.fill('.modal [name=reason]', 'بيعت السيارة'); save(g); g.wait_for_selector('#vt')
    ok('VEH-0001' not in g.inner_text('#vt'), '3. card gone from the active vehicles list')
    ok(int(al0) >= 1 and sql(f"select count(*) from v_followups where subject_id='{V1}'") == '0', f'3. all its alerts stopped (insurance, documents, oil...) ({al0} -> 0)')
    ok(sql(f"select (deleted_at is not null)::text || '|' || delete_reason || '|' || (deleted_by is not null)::text from vehicles where id='{V1}'") == 'true|بيعت السيارة|true', '3. date/time, user and reason recorded')
    ok(RECS(V1) == recs1, '3. its oil, maintenance, accidents, documents and handovers untouched')
    goto(g, 'dashboard', '.panels'); g.reload(); g.wait_for_selector('.panels'); g.wait_for_timeout(600); g.click('.bell'); g.wait_for_timeout(300)
    ok('VEH-0001' not in g.inner_text('.pop-bell'), '3. bell no longer shows its alerts')
    goto(g, 'settings/vehicles-archive', '#arch')
    t = g.inner_text('#arch'); ok('VEH-0001' in t and 'بيعت السيارة' in t and 'عبدالله المسؤول' in t, '3. archived log lists the card with date, user and reason')
    g.fill('#page [name=q]', 'بيعت'); g.wait_for_timeout(200); ok(g.locator('#arch tbody tr').count() == 1, '3. search in the archived log')
    g.screenshot(path=f'{OUT}/va-archive.png', full_page=True)
    open_vehicle(g, V1)
    t = g.inner_text('#page')
    ok('سجل السيارات المحذوفة' in t and 'لون الطلاء' in g.inner_text('[data-panel=basic]') and g.locator('.vactions [data-act=edit]').count() == 0, '3. archived card opens read-only with all its information')
    g.click('.tabbtn[data-tab=oil]'); ok('OIL-' in g.inner_text('.tab-panel.on') or RECS(V1).split('|')[0] == '0', '3. archived card still shows its oil records')
    g.click('.tabbtn[data-tab=log]'); ok('حذف البطاقة إلى السجل' in g.inner_text('.tab-panel.on'), '3. deletion recorded in the change history')

    # ---------- 4. restore the card
    g.click('[data-act=restore-card]'); g.wait_for_selector('.modal [name=reason]'); save(g); g.wait_for_selector('.vhead'); g.wait_for_timeout(500)
    ok(sql(f"select (deleted_at is null)::text || '|' || code || '|' || (restored_by is not null)::text from vehicles where id='{V1}'") == 'true|VEH-0001|true', '4. same card back (same ID and number), restore user/time recorded')
    ok(RECS(V1) == recs1 and sql("select count(*) from vehicles where plate_no = (select plate_no from vehicles where id='%s')" % V1) == '1', '4. all records back, no duplicate vehicle')
    ok(sql(f"select count(*) from v_followups where subject_id='{V1}'") == al0, '4. alerts back, no duplicates')
    goto(g, 'vehicles', '#vt'); ok('VEH-0001' in g.inner_text('#vt'), '4. card back in the active list')
    open_vehicle(g, V1, 'log'); t = g.inner_text('[data-panel=log]'); ok('استرداد البطاقة' in t and 'حذف البطاقة إلى السجل' in t, '4. both deletion and restore kept in the history')

    # ---------- 5. restore an old value
    nh = len(g.locator('[data-panel=log] .hx-item').all())
    items = g.locator('[data-panel=log] .hx-item')
    idx = [i for i in range(items.count()) if 'تسليم السيارة لسائق جديد' in items.nth(i).inner_text()][0]
    items.nth(idx).locator('[data-hx-restore]').click(); g.wait_for_selector('.modal [type=checkbox]')
    pv = g.inner_text('.modal'); ok('خالد علي' in pv and 'أحمد محمد' in pv, '5. preview: current value and the value to restore')
    g.screenshot(path=f'{OUT}/va-restore-preview.png')
    save_btn = g.locator('.modal [data-save]'); save_btn.click(); g.wait_for_selector('[data-yes]'); g.click('[data-yes]')
    g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_timeout(600)
    ok(sql(f"select current_user_name from vehicles where id='{V1}'") == 'أحمد محمد', '5. old value restored')
    open_vehicle(g, V1, 'log'); t = g.inner_text('[data-panel=log]')
    ok(g.locator('[data-panel=log] .hx-item').count() == nh + 1 and 'استعادة قيم سابقة' in t and 'تسليم السيارة لسائق جديد' in t, '5. restore logged as a new change; all earlier changes still there')

    # ---------- 6. reload keeps everything
    g.reload(); g.wait_for_selector('.vhead'); g.click('.tabbtn[data-tab=basic]')
    ok('أحمد محمد' in g.inner_text('[data-panel=basic]') and 'أسود' in g.inner_text('[data-panel=basic]'), '6. after reload: data and extra fields still there')

    # ---------- restore blocked when another active vehicle took the plate
    plate2 = sql(f"select plate_no from vehicles where id='{V2}'")
    sql(f"begin; set local role authenticated; set local request.jwt.claim.sub='a0000000-0000-0000-0000-000000000001'; select archive_vehicle('{V2}', 'اختبار'); commit;")
    sql(f"insert into vehicles(plate_no, owner_company_id) values ('{plate2}', '11111111-1111-1111-1111-111111111111')")
    goto(g, 'settings/vehicles-archive', '#arch'); g.click(f'[data-restore="{V2}"]'); g.wait_for_selector('.modal [name=reason]')
    g.click('.modal [data-save]'); g.wait_for_selector('.modal .form-error:not([hidden])')
    ok('نفس رقم اللوحة' in g.inner_text('.modal .form-error') and sql(f"select (deleted_at is not null)::text from vehicles where id='{V2}'") == 'true', '7. restore refused safely when another active vehicle uses the plate (nothing changed)')
    c.close()

    # viewer: no delete button, no field management
    c, g = new_ctx(b, 390); login(g, 'viewer@test.local'); open_vehicle(g, V1)
    ok(g.locator('[data-act=archive]').count() == 0, 'viewer cannot delete cards')
    goto(g, 'settings/vehicle-fields', '#page h1'); ok('تحتاج صلاحية' in g.inner_text('#page'), 'viewer cannot manage fields')
    c.close(); b.close()

ok(sql(OTHERS) == others0, '7. no other vehicle changed by any of these operations')
ok(sql("select count(*) from audit_log where table_name='vehicles' and record_id='%s'" % V1) != '0' and sql("select has_table_privilege('authenticated', 'audit_log', 'UPDATE')::text || has_table_privilege('authenticated', 'audit_log', 'DELETE')::text") == 'falsefalse', 'history protected: signed-in users cannot edit or delete it')

print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
