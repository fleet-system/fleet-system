"""v1.4 browser test: «النسخ الاحتياطي وحماية البيانات» — create before update, download (json + zip with files),
check, merge restore, full restore with explicit confirmation, undo, upload file, tampered file, admin only.
Usage: python3 -I ui_backup.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess, json, hashlib, zipfile, io
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
V2 = 'b0000000-0000-0000-0000-000000000002'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True).stdout.strip()
def cnt(t, w='true'): return int(sql(f'select count(*) from {t} where {w}'))
def new_ctx(b, w=1280):
    c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2, accept_downloads=True)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def page(g):
    g.goto(BASE + '#/backup?r=' + os.urandom(3).hex()); g.wait_for_timeout(300); g.wait_for_selector('[data-act=pre]')
def counts():
    return {t: cnt(t) for t in ['vehicles', 'oil_changes', 'maintenance', 'maintenance_items', 'accidents', 'documents', 'sites', 'housing_maintenance', 'attachments']}

with sync_playwright() as p:
    b = p.chromium.launch()
    # -------- viewer: no access
    c, g = new_ctx(b, 390); login(g, 'viewer@test.local')
    ok('النسخ الاحتياطي' not in g.inner_text('.sheet, .sidebar, nav') , 'viewer does not see the backup page in the menu')
    g.goto(BASE + '#/backup'); g.wait_for_timeout(800)
    ok('لمسؤول النظام فقط' in g.inner_text('#page') and g.locator('[data-act=pre]').count() == 0, 'viewer cannot open the backup page')
    c.close()

    c, g = new_ctx(b); login(g)
    ok('النسخ الاحتياطي وحماية البيانات' in g.inner_text('nav.nav'), 'admin sees «النسخ الاحتياطي وحماية البيانات» in the menu')
    # an attachment (invoice photo) so the zip has a real file
    g.goto(f'{BASE}#/vehicles/{V2}?tab=basic'); g.wait_for_selector('.vhead'); g.click('.vactions [data-act=oil]'); g.wait_for_selector('.modal [name=odometer]'); g.wait_for_timeout(200)
    g.locator('.modal [name=oil_cost]').fill('120'); g.locator('.modal input[name=invoice_file]').set_input_files(os.path.join(FX, 'invoice.jpg'))
    g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000); g.wait_for_timeout(600)
    c0 = counts()

    # -------- 1. before updating the site
    page(g)
    for t in ['إنشاء نسخة قبل تعديل الموقع', 'تنزيل نسخة جميع المعلومات', 'استعادة المعلومات بعد تعديل الموقع', 'فحص النسخة']:
        ok(t in g.inner_text('#page'), f'page has «{t}»')
    g.fill('[name=pre_note]', 'قبل تحديث الإصدار'); g.click('[data-act=pre]'); g.wait_for_selector('[data-out=pre] .ok-box', timeout=30000)
    t = g.inner_text('[data-out=pre]')
    bk1 = sql("select backup_no from system_backups where kind='pre_update' order by created_at desc limit 1")
    ok('تم التحقق' in t and bk1 in t and '2026' in t, f'1. success message with number {bk1}, date/time, verified')
    ok(sql(f"select verified::text||'|'||(md5(payload::text)=checksum)::text||'|'||note from system_backups where backup_no='{bk1}'") == 'true|true|قبل تحديث الإصدار', '1. stored in the database, checksum verified')
    g.screenshot(path=f'{OUT}/bk-created.png', full_page=True)
    c0 = counts()

    # -------- 2. download (json) and (zip with files)
    with g.expect_download() as d: g.click('[data-act=download]')
    path = d.value.path(); name = d.value.suggested_filename; raw = open(path, 'rb').read().decode()
    doc = json.loads(raw)
    bkd = doc['integrity']['backup_no']
    body = raw[raw.index('"backup":') + 9:-1]
    ok(name.endswith('.json') and doc['backup']['format'] == 'fleet-backup' and doc['integrity']['md5'] == sql(f"select checksum from system_backups where backup_no='{bkd}'"), f'2. downloaded {name} with integrity fingerprint')
    ok(hashlib.md5(body.encode()).hexdigest() == doc['integrity']['md5'], '2. file content matches its fingerprint exactly')
    ok(all(k in doc['backup']['tables'] for k in ['vehicles', 'oil_changes', 'maintenance', 'accidents', 'handovers', 'documents', 'sites', 'housing_maintenance', 'food_supplies', 'attachments', 'app_settings']), '2. file contains every section')
    open(f'{OUT}/backup.json', 'w').write(raw)
    g.check('[name=withfiles]')
    with g.expect_download(timeout=60000) as d: g.click('[data-act=download]')
    zp = d.value.path(); zname = d.value.suggested_filename
    z = zipfile.ZipFile(zp); names = z.namelist()
    ok(zname.endswith('.zip') and 'fleet-backup.json' in names and any(n.startswith('files/') for n in names), f'2. zip with the data file and {sum(n.startswith("files/") for n in names)} attachment file(s)')
    import shutil; shutil.copy(zp, f'{OUT}/backup.zip')
    g.wait_for_timeout(300)

    # -------- after "site update": some data lost + new data added
    g.goto(f'{BASE}#/vehicles'); g.wait_for_selector('#vt'); g.click('[data-act=new]'); g.wait_for_selector('.modal [name=plate_letters]'); g.wait_for_timeout(200)
    g.locator('.modal [name=plate_letters]').fill('ج د د'); g.locator('.modal [name=plate_digits]').fill('7070'); g.locator('.modal [name=owner_company]').fill('شركة روى الرمال الزراعية')
    g.click('.modal [data-save]'); g.wait_for_selector('.vhead', timeout=30000)
    lost_oil = sql("select id from oil_changes order by created_at limit 1"); lost_acc = sql("select id from accidents order by created_at limit 1")
    sql(f"alter table oil_changes disable trigger user; delete from oil_changes where id='{lost_oil}'; alter table oil_changes enable trigger user;"
        f" alter table accidents disable trigger user; delete from accidents where id='{lost_acc}'; alter table accidents enable trigger user")
    ok(cnt('oil_changes') == c0['oil_changes'] - 1, '(setup) an oil change and an accident lost, a new vehicle added after the backup')

    # -------- 3. check + merge restore
    page(g)
    g.select_option('[name=bk]', label=[o for o in g.locator('[name=bk] option').all_inner_texts() if o.startswith(bk1)][0])
    g.click('[data-act=check]'); g.wait_for_selector('[data-out=check] .check-box, [data-out=check] .bad-box', timeout=30000)
    t = g.inner_text('[data-out=check]')
    ok('نجح فحص النسخة' in t and bk1 in t and 'دمج البيانات' in t and 'استعادة كاملة' in t, '3. check: summary with date, counts and both options')
    ok('ستُزال سجلات أُضيفت بعد النسخة' in t and 'السيارات: 1' in t, '3. clear warning: full mode would remove the vehicle added after the backup')
    ok(cnt('oil_changes') == c0['oil_changes'] - 1 and cnt('vehicles') == c0['vehicles'] + 1, '3. checking changed nothing')
    g.screenshot(path=f'{OUT}/bk-check.png', full_page=True)
    g.click('[data-act=restore]'); g.wait_for_selector('[data-yes]'); g.click('[data-yes]')
    g.wait_for_selector('[data-out=restore] .ok-box, [data-out=restore] .bad-box', timeout=60000)
    t = g.inner_text('[data-out=restore]')
    ok('تمت استعادة المعلومات' in t and 'دمج' in t, '3. merge restore: final success message')
    ok(cnt('oil_changes') == c0['oil_changes'] and cnt('accidents') == c0['accidents'] and cnt('oil_changes', f"id='{lost_oil}'") == 1, '3. lost oil change and accident back, same IDs')
    ok(cnt('vehicles') == c0['vehicles'] + 1 and cnt('vehicles', "plate_no='ج د د 7070'") == 1, '3. vehicle added after the backup kept (merge never deletes)')
    ok(sql(f"select vehicle_id from oil_changes where id='{lost_oil}'") != '' and cnt('oil_changes o join vehicles v on v.id=o.vehicle_id', f"o.id='{lost_oil}'") == 1, '3. restored oil change linked to its original vehicle')
    pre1 = sql("select backup_no from system_backups where kind='pre_restore' order by created_at desc limit 1")
    ok(pre1 and pre1 in t, f'3. automatic copy before the restore ({pre1}) shown for undo')
    g.screenshot(path=f'{OUT}/bk-merge-result.png', full_page=True)

    # -------- 4. full restore needs the word «استبدال»
    page(g)
    g.select_option('[name=bk]', label=[o for o in g.locator('[name=bk] option').all_inner_texts() if o.startswith(bk1)][0])
    g.click('[data-act=check]'); g.wait_for_selector('[data-out=check] .check-box', timeout=30000)
    g.check('[name=mode][value=full]')
    ok(g.locator('.confirm-full').is_visible(), '4. full mode asks to type «استبدال»')
    g.click('[data-act=restore]'); g.wait_for_timeout(300)
    ok('استبدال' in g.inner_text('[data-out=restore]') and cnt('vehicles', "plate_no='ج د د 7070'") == 1, '4. without the word nothing happens')
    g.fill('[name=confirm_full]', 'استبدال'); g.click('[data-act=restore]'); g.wait_for_selector('[data-yes]'); g.click('[data-yes]')
    g.wait_for_selector('[data-out=restore] .check-box, [data-out=restore] div.bad-box', timeout=60000)
    t = g.inner_text('[data-out=restore]')
    ok('استعادة كاملة' in t and counts() == c0, f'4. full restore: data exactly as in the backup {(counts(), c0) if counts() != c0 else ""}')
    pre2 = sql("select backup_no from system_backups where kind='pre_restore' order by created_at desc limit 1")
    # undo: restore the automatic copy
    page(g)
    g.select_option('[name=bk]', label=[o for o in g.locator('[name=bk] option').all_inner_texts() if o.startswith(pre2)][0])
    g.click('[data-act=check]'); g.wait_for_selector('[data-out=check] .check-box', timeout=30000)
    g.click('[data-act=restore]'); g.wait_for_selector('[data-yes]'); g.click('[data-yes]'); g.wait_for_selector('[data-out=restore] .ok-box', timeout=60000)
    ok(cnt('vehicles', "plate_no='ج د د 7070'") == 1, f'4. undo: restoring the automatic copy {pre2} brings the newer vehicle back')

    # -------- 5. upload the downloaded file / tampered file / zip with files
    page(g)
    with g.expect_file_chooser() as fc: g.click('[data-act=attach]')
    fc.value.set_files(f'{OUT}/backup.json'); g.wait_for_selector('[data-out=attach] .ok-box, [data-out=attach] .bad-box', timeout=30000)
    t = g.inner_text('[data-out=attach]')
    ok('تم رفع الملف' in t and 'مطابقة' in t, '5. downloaded file accepted (fingerprint matches)')
    g.click('[data-act=check]'); g.wait_for_selector('[data-out=check] .check-box', timeout=30000)
    ok('نجح فحص النسخة' in g.inner_text('[data-out=check]'), '5. uploaded file passes the check')
    open(f'{OUT}/tampered.json', 'w').write(raw.replace('"oil_cost": 120', '"oil_cost": 999', 1) if '"oil_cost": 120' in raw else raw.replace('"plate_no": "', '"plate_no": "Z', 1))
    with g.expect_file_chooser() as fc: g.click('[data-act=attach]')
    fc.value.set_files(f'{OUT}/tampered.json'); g.wait_for_selector('[data-out=attach] .bad-box', timeout=30000)
    ok('تالف' in g.inner_text('[data-out=attach]'), '5. a hand-edited file is rejected')
    open(f'{OUT}/other.json', 'w').write('{"name": "not a backup"}')
    with g.expect_file_chooser() as fc: g.click('[data-act=attach]')
    fc.value.set_files(f'{OUT}/other.json'); g.wait_for_selector('[data-out=attach] .bad-box', timeout=30000)
    ok('ليس نسخة' in g.inner_text('[data-out=attach]'), '5. a file from another program is rejected')
    # zip: the attachment file is missing from storage -> put back after restore
    att = sql("select storage_path from attachments limit 1")
    sql(f"delete from storage.objects where name = '{att}'")
    with g.expect_file_chooser() as fc: g.click('[data-act=attach]')
    fc.value.set_files(f'{OUT}/backup.zip'); g.wait_for_selector('[data-out=attach] .ok-box', timeout=30000)
    ok('ملف مرفق' in g.inner_text('[data-out=attach]'), '5. zip accepted with its attachment files')
    g.click('[data-act=check]'); g.wait_for_selector('[data-out=check] .check-box', timeout=30000)
    g.click('[data-act=restore]'); g.wait_for_selector('[data-yes]'); g.click('[data-yes]')
    g.wait_for_selector('[data-out=restore] .ok-box', timeout=60000); g.wait_for_timeout(1500)
    t = g.inner_text('[data-out=restore]')
    ok('المرفقات: أُعيد 1' in t and sql(f"select count(*) from storage.objects where name = '{att}'") == '1', f'5. missing attachment file put back in storage ({t[-80:]})')
    ok(cnt('vehicles', "plate_no='ج د د 7070'") == 1 and cnt('oil_changes') == c0['oil_changes'], '5. merge from the file: no duplicates, newer data kept')

    # -------- log
    page(g)
    t = g.inner_text('#page')
    ok(all(x in t for x in ['إنشاء نسخة', 'تنزيل', 'رفع ملف', 'فحص', 'استعادة (دمج)', 'استعادة كاملة']), '6. every operation listed in «سجل العمليات»')
    g.screenshot(path=f'{OUT}/bk-page.png', full_page=True)
    c.close()
    c, g = new_ctx(b, 390); login(g); page(g); g.screenshot(path=f'{OUT}/bk-mobile.png', full_page=True)
    ok(g.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'mobile: page fits the screen')
    c.close()
    b.close()

print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
