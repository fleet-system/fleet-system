"""Phase 6 browser test: users & permissions, audit log, settings, backup + full restore into a new DB.
Usage: python3 -I ui_phase6.py OUTDIR"""
import sys, os, json, subprocess
from playwright.sync_api import sync_playwright

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'http://localhost:8787/'
VIEWER = 'a0000000-0000-0000-0000-000000000002'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
PSQL = ['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At']
def sql(db, q): return subprocess.run(PSQL + ['-d', db, '-c', q], capture_output=True, text=True).stdout.strip()

def login(pg, email):
    pg.goto(BASE); pg.wait_for_selector('form.login-card')
    pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'test1234'); pg.click('button[type=submit]')

def new_page(b, w=390):
    c = b.new_context(viewport={'width': w, 'height': 844}, device_scale_factor=2, locale='ar-SA', timezone_id='Asia/Riyadh', accept_downloads=True)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = new_page(b)
    login(pg, 'admin@test.local'); pg.wait_for_selector('.panels')
    ok(pg.locator('#nudge .backup-nudge').count() == 1, 'dashboard reminds admin: no backup yet')

    # ---------------- users ----------------
    pg.goto(BASE + '#/users'); pg.wait_for_selector('.users')
    ok(pg.locator('.user').count() == 3, 'users page lists 3 accounts')
    pg.click(f'[data-edit="{VIEWER}"]'); pg.wait_for_selector('.modal')
    pg.select_option('.modal [name=preset]', 'clerk'); pg.wait_for_timeout(100)
    ok(pg.is_checked('.modal [name=p_create]') and pg.is_checked('.modal [name=p_edit]') and not pg.is_checked('.modal [name=p_invoices]'), 'preset «مدخل بيانات» ticks view/create/edit')
    pg.click('.modal [data-save]'); pg.wait_for_selector('.modal', state='detached'); pg.wait_for_selector('.users')
    ok(sql('fleet_ui', f"select string_agg(permission::text, ',' order by permission) from user_permissions where user_id='{VIEWER}'") == 'view,create,edit', 'permissions saved (view, create, edit)')
    pg.screenshot(path=f'{OUT}/p6-users.png', full_page=True)
    # cannot disable last admin
    me = sql('fleet_ui', "select user_id from profiles where email='admin@test.local'")
    pg.click(f'[data-edit="{me}"]'); pg.wait_for_selector('.modal'); pg.uncheck('.modal [name=is_admin]'); pg.click('.modal [data-save]')
    pg.wait_for_selector('.modal .form-error:not([hidden])')
    ok('آخر مسؤول' in pg.inner_text('.modal .form-error'), 'cannot remove the last admin (Arabic message)')
    (pg.click('.modal [data-close]'), pg.wait_for_timeout(150), pg.locator('[data-yes]').count() and pg.click('[data-yes]'))

    c2, g2 = new_page(b); login(g2, 'viewer@test.local'); g2.wait_for_selector('.panels')
    g2.goto(BASE + '#/vehicles'); g2.wait_for_selector('table.rtable')
    ok(g2.locator('[data-act=new]').count() == 1, 'promoted user now sees «إضافة سيارة»')
    ok(g2.locator('.sidebar, .sheet').count() >= 1, 'shell ok'); c2.close()

    # deactivate viewer
    pg.click(f'[data-edit="{VIEWER}"]'); pg.wait_for_selector('.modal'); pg.uncheck('.modal [name=is_active]'); pg.click('.modal [data-save]'); pg.wait_for_selector('.modal', state='detached')
    c2, g2 = new_page(b); login(g2, 'viewer@test.local'); g2.wait_for_selector('text=الحساب معطّل')
    ok(True, 'deactivated user cannot use the system'); c2.close()

    # ---------------- audit ----------------
    pg.goto(BASE + '#/vehicles/b0000000-0000-0000-0000-000000000005'); pg.wait_for_selector('.vhead')
    pg.click('.vactions [data-act=edit]'); pg.wait_for_selector('.modal'); pg.select_option('.modal [name=op_state]', 'outside'); pg.fill('.modal [name=notes]', 'ملاحظة التدقيق')
    pg.click('.modal [data-save]'); pg.wait_for_selector('.modal', state='detached')
    pg.goto(BASE + '#/audit'); pg.wait_for_selector('.audit')
    pg.select_option('#page select[name=table]', 'vehicles'); pg.wait_for_timeout(600)
    t = pg.inner_text('.audit li:first-child')
    ok('تعديل' in t and 'الحالة التشغيلية' in t and 'تعمل خارج الموقع' in t and 'ملاحظات' in t and 'ملاحظة التدقيق' in t and 'عبدالله المسؤول' in t,
       'audit shows who changed what: operating state and note in Arabic')
    pg.select_option('#page select[name=table]', 'user_permissions'); pg.wait_for_timeout(600)
    ok(pg.locator('.audit li').count() >= 2, 'permission grants are audited')
    pg.select_option('#page select[name=table]', ''); pg.fill('#page input[name=from]', '2026/02/31'); pg.dispatch_event('#page input[name=from]', 'change'); pg.wait_for_timeout(300)
    ok('غير موجود' in pg.inner_text('.audit-body'), 'audit date filter rejects 2026/02/31')
    pg.fill('#page input[name=from]', ''); pg.dispatch_event('#page input[name=from]', 'change'); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{OUT}/p6-audit.png')

    # ---------------- settings ----------------
    pg.goto(BASE + '#/settings'); pg.wait_for_selector('.backup')
    pg.click('[data-act=edit]'); pg.wait_for_selector('.modal')
    pg.fill('.modal [name=vat_percent]', '5'); pg.fill('.modal [name=doc_alert_days]', '120، 30, 7')
    pg.click('.modal [data-save]'); pg.wait_for_selector('.modal', state='detached'); pg.wait_for_selector('.backup')
    ok(sql('fleet_ui', "select value::text from app_settings where key='default_vat_rate'") == '0.05' and sql('fleet_ui', "select value::text from app_settings where key='doc_alert_days'") == '[120, 30, 7]', 'settings saved (VAT 5%, alert days 120/30/7 with Arabic comma)')
    pg.goto(BASE + '#/maintenance'); pg.wait_for_selector('.list-body'); pg.click('[data-list-add]'); pg.wait_for_selector('.modal')
    ok('5%' in pg.inner_text('.modal'), 'maintenance form uses the new VAT rate (5%)')
    (pg.click('.modal [data-close]'), pg.wait_for_timeout(150), pg.locator('[data-yes]').count() and pg.click('[data-yes]'))
    exp = int(sql('fleet_ui', "select count(*) from v_document_status where status='expiring'"))
    ok(exp >= 5, f'documents within 120 days now flagged as expiring ({exp})')

    # ---------------- backup ----------------
    pg.goto(BASE + '#/backup'); pg.wait_for_selector('[data-act=pre]'); pg.click('details.howto summary')
    with pg.expect_download() as dl:
        pg.click('[data-act=legacy-dl]')
    bpath = os.path.join(OUT, 'backup.json'); dl.value.save_as(bpath)
    bk = json.load(open(bpath, encoding='utf-8'))
    ok(bk['format'] == 'fleet-backup' and len(bk['tables']['vehicles']) == 5 and len(bk['tables']['employee_private']) >= 0 and len(bk['tables']['audit_log']) > 50, 'backup JSON contains all tables')
    pg.wait_for_selector('#toast.show:has-text("تم التنزيل")'); pg.goto(BASE + '#/dashboard'); pg.wait_for_selector('.panels'); pg.wait_for_timeout(500)
    ok(pg.locator('#nudge .backup-nudge').count() == 0, 'reminder disappears after backup')
    pg.screenshot(path=f'{OUT}/p6-dashboard.png')

    # ---------------- restore SQL ----------------
    pg.goto(BASE + '#/backup?r=2'); pg.wait_for_selector('[data-act=pre]'); pg.click('details.howto summary')
    with pg.expect_download() as dl2:
        with pg.expect_file_chooser() as fc:
            pg.click('[data-act=legacy-sql]')
        fc.value.set_files(bpath)
    rpath = os.path.join(OUT, 'restore.sql'); dl2.value.save_as(rpath)
    raw = open(rpath, 'rb').read()
    ok(all(c < 128 for c in raw), 'restore SQL is pure ASCII (safe to paste from iPhone)')
    pg.goto(BASE + '#/settings'); pg.wait_for_selector('.backup'); pg.screenshot(path=f'{OUT}/p6-settings.png', full_page=True)
    ctx.close(); b.close()

# apply restore to a brand-new database: stub + setup + same auth users (as recreated in a new project)
subprocess.run(PSQL + ['-d', 'postgres', '-c', 'drop database if exists fleet_restore', '-c', 'create database fleet_restore'], capture_output=True)
for f in [os.path.join(HERE, 'supabase_stub.sql'), os.path.join(HERE, '..', 'supabase', 'setup_clean.sql')]:
    subprocess.run(PSQL + ['-v', 'ON_ERROR_STOP=1', '-d', 'fleet_restore', '-f', f], capture_output=True)
users = sql('fleet_ui', "select string_agg(format('(%L,%L)', id, email), ',') from auth.users")
sql('fleet_restore', f"insert into auth.users(id, email) values {users}")
r = subprocess.run(PSQL + ['-v', 'ON_ERROR_STOP=1', '-d', 'fleet_restore', '-f', os.path.join(OUT, 'restore.sql')], capture_output=True, text=True)
ok(r.returncode == 0 and 'RESTORE_OK' in r.stdout, 'restore SQL runs successfully on a new database' + ('' if r.returncode == 0 else ' — ' + r.stderr[-300:]))
tables = ['companies', 'sites', 'employees', 'employee_private', 'vehicles', 'vehicle_assignments', 'odometer_readings', 'vehicle_field_history', 'authorizations', 'documents',
          'oil_changes', 'maintenance', 'maintenance_items', 'accidents', 'handovers', 'housing_maintenance', 'food_supplies', 'attachments', 'profiles', 'user_permissions', 'app_settings']
cnt = lambda db, t: sql(db, f"select count(*) from {t}" + (" where key <> 'last_backup'" if t == 'app_settings' else ''))
diff = [t for t in tables if cnt('fleet_ui', t) != cnt('fleet_restore', t)]
ok(not diff, f'every table restored with identical row counts {diff}')
money = "select (select coalesce(sum(total),0) from oil_changes)||'|'||(select coalesce(sum(total),0) from maintenance)||'|'||(select coalesce(sum(total),0) from accidents)||'|'||(select coalesce(sum(total),0) from food_supplies)"
ok(sql('fleet_ui', money) == sql('fleet_restore', money), 'all money totals identical after restore')
chk = "select string_agg(code||':'||plate_no||':'||odometer||':'||coalesce(current_driver_id::text,'-'), ',' order by code) from vehicles"
ok(sql('fleet_ui', chk) == sql('fleet_restore', chk), 'vehicles identical (Arabic plates, odometer, drivers)')
ok(sql('fleet_restore', "select nextval('vehicle_code_seq')") == '6', 'number sequences continue after restore (next vehicle = VEH-0006)')
ok(sql('fleet_restore', "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='vehicles' and t.tgenabled='D'") == '0', 'triggers re-enabled after restore')
r2 = subprocess.run(PSQL + ['-d', 'fleet_restore', '-f', os.path.join(OUT, 'restore.sql')], capture_output=True, text=True)
ok('RESTORE_ABORTED' in r2.stderr, 'running restore twice is refused (protects existing data)')

print(f'PASSED {len(passed)}')
for m in problems: print('FAIL:', m)
print('ALL PHASE 6 CHECKS PASSED' if not problems else f'{len(problems)} problem(s)')
