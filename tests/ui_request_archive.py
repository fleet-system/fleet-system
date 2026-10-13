"""v1.9: Settings -> «إدارة طلبات الصيانة»: deleting a maintenance request moves it to «سجل الطلبات المحذوفة»
(nothing is erased), the change is in the audit log, and it can be restored exactly as it was.
Usage: python3 -I ui_request_archive.py OUTDIR   (fresh fleet_ui + mock server)"""
import sys, os, subprocess
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'http://localhost:8787/'
ADMIN = 'a0000000-0000-0000-0000-000000000001'
V1 = 'b0000000-0000-0000-0000-000000000001'
problems, passed = [], []
def ok(c, m): (passed if c else problems).append(m)
def sql(q): return subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-c', q], capture_output=True, text=True)
def val(q): return sql(q).stdout.strip()
def as_user(uid, q):
    r = sql(f"begin; set local role authenticated; set local request.jwt.claim.sub='{uid}'; set local request.jwt.claims='{{\"sub\":\"{uid}\",\"role\":\"authenticated\"}}'; {q}; commit;")
    return r.stdout.strip(), r.stderr.strip()

# three requests: one new, one approved (locked content), one rejected
ids = {}
for key, fault in [('new', 'صوت في المكابح — اختبار الحذف'), ('approved', 'تسريب زيت المحرك — اختبار الحذف'), ('rejected', 'تغيير الإطارات — اختبار الحذف')]:
    out, err = as_user(ADMIN, f"insert into maintenance_requests(vehicle_id, fault, notes) values ('{V1}', '{fault}', 'ملاحظة {key}') returning id")
    ids[key] = out.splitlines()[0] if out else None
    ok(bool(ids[key]), f'seed request {key} {err[:80]}')
as_user(ADMIN, f"update maintenance_requests set status='approved', approver_name='مشرف تجريبي' where id='{ids['approved']}'")
as_user(ADMIN, f"update maintenance_requests set status='rejected', approver_name='مشرف تجريبي', approval_notes='غير لازم' where id='{ids['rejected']}'")
as_user(ADMIN, f"insert into attachments(entity_type, entity_id, category, file_name, storage_path, mime_type, size_bytes) values ('maintenance_request', '{ids['approved']}', 'fault_photo', 'fault.jpg', 'test/{ids['approved']}/fault.jpg', 'image/jpeg', 1000)")
ok(val(f"select status from maintenance_requests where id='{ids['approved']}'") == 'approved', 'request approved (content locked)')
CONTENT = ("select md5(to_jsonb(r)::text) from (select id, request_no, request_date, site_id, company_id, vehicle_id, plate_no, model, driver_id, driver_name, meter_reading, "
           "fault, fault_cause, technician_opinion, site_notes, status, supervisor_name, approver_name, approval_notes, decided_at, maintenance_id, notes, created_at, created_by "
           "from maintenance_requests where id='%s') r")
before = {k: val(CONTENT % v) for k, v in ids.items()}
att_before = val(f"select count(*) from attachments where entity_id='{ids['approved']}'")
total_before = val('select count(*) from maintenance_requests')

def new_ctx(b, w=1280):
    c = b.new_context(viewport={'width': w, 'height': 900}, locale='ar-SA', timezone_id='Asia/Riyadh', device_scale_factor=2)
    g = c.new_page(); g.route('**/fonts.googleapis.com/**', lambda r: r.abort())
    g.on('pageerror', lambda e: problems.append(f'page error: {e}'))
    return c, g
def login(g, email='admin@test.local'):
    g.goto(BASE); g.wait_for_selector('form.login-card'); g.fill('input[name=email]', email); g.fill('input[name=password]', 'test1234'); g.click('button[type=submit]'); g.wait_for_selector('.panels')
def goto(g, h, sel): g.goto(f'{BASE}#/{h}{"&" if "?" in h else "?"}r={os.urandom(3).hex()}'); g.wait_for_selector(sel)
def submit(g): g.click('.modal [data-save]'); g.wait_for_selector('.modal', state='detached', timeout=30000)
def req_no(k): return val(f"select request_no from maintenance_requests where id='{ids[k]}'")

with sync_playwright() as p:
    b = p.chromium.launch()
    c, g = new_ctx(b); login(g)
    # settings has the new section
    goto(g, 'settings', '.page-head')
    ok(g.locator('a[href="#/settings/requests"]').count() == 1 and g.locator('a[href="#/settings/requests?tab=archive"]').count() == 1, 'settings: «إدارة طلبات الصيانة» and «سجل الطلبات المحذوفة» links')
    g.click('a[href="#/settings/requests"]'); g.wait_for_selector('#req-list')
    txt = g.inner_text('#req-list')
    ok(all(req_no(k) in txt for k in ids), 'active tab lists the requests')
    g.screenshot(path=f'{OUT}/1-active.png', full_page=True)

    # 1) delete the APPROVED request from settings, with a reason
    g.click(f'[data-archive="{ids["approved"]}"]'); g.wait_for_selector('.modal [name=reason]')
    ok('لا يُمسح أي شيء' in g.inner_text('.modal'), 'delete dialog explains nothing is erased')
    g.fill('.modal [name=reason]', 'طلب مكرر'); submit(g); g.wait_for_timeout(600)
    r = val(f"select concat_ws('|', deleted_at is not null, deleted_by, delete_reason, status) from maintenance_requests where id='{ids['approved']}'")
    ok(r == f't|{ADMIN}|طلب مكرر|approved', f'approved request moved to the log with who/why, status kept [{r}]')
    ok(val(CONTENT % ids['approved']) == before['approved'], 'request content unchanged after delete')
    ok(val(f"select count(*) from attachments where entity_id='{ids['approved']}'") == att_before, 'attachments kept')
    ok(val('select count(*) from maintenance_requests') == total_before, 'no row removed from the database')
    ok(req_no('approved') not in g.inner_text('#req-list'), 'gone from the active tab')
    aud = val(f"select count(*) from audit_log where table_name='maintenance_requests' and record_id='{ids['approved']}' and action='ARCHIVE' and changes ? 'deleted_at'")
    ok(aud == '1', f'delete recorded in the audit log [{aud}]')
    # hidden everywhere else
    goto(g, 'requests', '#page')
    g.wait_for_timeout(800); ok(req_no('approved') not in g.inner_text('#page') and req_no('new') in g.inner_text('#page'), 'requests list hides the deleted request only')
    ok(val(f"select count(*) from v_followups where subject_id='{ids['approved']}'") == '0', 'no alerts for the deleted request')
    goto(g, f'vehicles/{V1}?tab=maint', '.vhead'); g.wait_for_timeout(800)
    ok(req_no('approved') not in g.inner_text('#page'), 'vehicle file hides the deleted request')

    # 2) archive tab shows it; opening it is read-only with a restore button
    goto(g, 'settings/requests?tab=archive', '#req-list')
    txt = g.inner_text('#req-list')
    ok(req_no('approved') in txt and 'طلب مكرر' in txt and 'عبدالله المسؤول' in txt, 'archive tab: number, reason and who deleted')
    g.screenshot(path=f'{OUT}/2-archive.png', full_page=True)
    goto(g, f'requests/{ids["approved"]}', '.archived-box')
    ok('سجل طلبات الصيانة المحذوفة' in g.inner_text('.archived-box') and 'طلب مكرر' in g.inner_text('.archived-box'), 'opened deleted request shows the archived banner')
    ok(g.locator('[data-act=archive], [data-act=edit], [data-act=start], [data-act=done], [data-act=decide]').count() == 0, 'no edit/delete actions on a deleted request')
    ok('تسريب زيت المحرك' in g.inner_text('#page'), 'deleted request content still readable')
    g.screenshot(path=f'{OUT}/3-archived-request.png', full_page=True)

    # 3) restore from the request page
    g.click('[data-act=restore]'); g.wait_for_selector('.modal [name=reason]'); g.fill('.modal [name=reason]', 'أُعيد بطلب المشرف'); submit(g)
    g.wait_for_selector('.archived-box', state='detached', timeout=15000)
    r = val(f"select concat_ws('|', deleted_at is null, restored_by, restore_note, status) from maintenance_requests where id='{ids['approved']}'")
    ok(r == f't|{ADMIN}|أُعيد بطلب المشرف|approved', f'restored with who/note, same status [{r}]')
    ok(val(CONTENT % ids['approved']) == before['approved'], 'content identical after restore')
    goto(g, 'requests', '#page'); g.wait_for_timeout(800); ok(req_no('approved') in g.inner_text('#page'), 'back in the requests list')

    # 4) delete from the request page itself (new request), restore from the archive tab
    goto(g, f'requests/{ids["new"]}', '[data-act=archive]')
    g.click('[data-act=archive]'); g.wait_for_selector('.modal [name=reason]'); submit(g)
    g.wait_for_function("location.hash.startsWith('#/requests') && !location.hash.includes('" + ids['new'] + "')", timeout=15000)
    ok(val(f"select deleted_at is not null from maintenance_requests where id='{ids['new']}'") == 't', 'delete from the request page works')
    goto(g, 'settings/requests?tab=archive', '#req-list')
    g.click(f'[data-restore="{ids["new"]}"]'); g.wait_for_selector('.modal [name=reason]'); submit(g); g.wait_for_timeout(700)
    ok(val(f"select deleted_at is null from maintenance_requests where id='{ids['new']}'") == 't', 'restore from the archive tab works')
    ok(all(val(CONTENT % v) == before[k] for k, v in ids.items()), 'all request contents unchanged after the whole round trip')
    # search / filter in the archive
    as_user(ADMIN, f"select archive_request('{ids['rejected']}', 'سبب للبحث')")
    goto(g, 'settings/requests?tab=archive', '#req-list')
    g.fill('#page [name=q]', 'سبب للبحث'); g.wait_for_timeout(300)
    ok(req_no('rejected') in g.inner_text('#req-list'), 'archive search by reason')
    g.fill('#page [name=q]', 'zzz-no-match'); g.wait_for_timeout(300)
    ok('لا توجد طلبات مطابقة' in g.inner_text('#req-list'), f"archive search with no match [{g.inner_text('#req-list')[:80]}]")
    c.close()

    # 5) mobile layout
    c, g = new_ctx(b, 390); login(g)
    goto(g, 'settings/requests?tab=archive', '#req-list'); g.screenshot(path=f'{OUT}/4-mobile-archive.png', full_page=True)
    ok(g.evaluate('document.documentElement.scrollWidth') <= 391, 'mobile: no horizontal overflow')
    c.close()

    # 6) a viewer cannot delete or restore
    c, g = new_ctx(b); login(g, 'viewer@test.local')
    goto(g, 'settings/requests?tab=archive', '#req-list')
    ok(g.locator('[data-restore], [data-archive]').count() == 0, 'viewer sees no delete/restore buttons')
    goto(g, f'requests/{ids["rejected"]}', '.archived-box')
    ok(g.locator('[data-act=restore]').count() == 0, 'viewer: no restore on the request page')
    c.close()
    b.close()

# database rules
_, err = as_user('a0000000-0000-0000-0000-000000000002', f"select archive_request('{ids['new']}', 'x')")
ok('PERMISSION_DENIED' in err, 'viewer RPC delete refused')
_, err = as_user('a0000000-0000-0000-0000-000000000002', f"select restore_request('{ids['rejected']}', 'x')")
ok('PERMISSION_DENIED' in err, 'viewer RPC restore refused')
_, err = as_user(ADMIN, f"select archive_request('{ids['rejected']}', 'x')")
ok('REQUEST_ALREADY_ARCHIVED' in err, 'cannot delete twice')
_, err = as_user(ADMIN, f"select restore_request('{ids['new']}', 'x')")
ok('REQUEST_NOT_ARCHIVED' in err, 'cannot restore an active request')
_, err = as_user(ADMIN, f"delete from maintenance_requests where id='{ids['new']}'")
ok(err != '' and val(f"select count(*) from maintenance_requests where id='{ids['new']}'") == '1', 'real DELETE still impossible')
_, err = sql("begin; set local role anon; select archive_request('%s', 'x'); commit;" % ids['new']).stdout, sql("begin; set local role anon; select archive_request('%s', 'x'); commit;" % ids['new']).stderr
ok('permission denied' in err.lower(), 'anonymous visitor cannot call archive_request')
ok(val('select count(*) from maintenance_requests') == total_before, 'request count unchanged at the end')

for x in passed: print('PASS', x)
for x in problems: print('FAIL', x)
print(f'PASS {len(passed)} FAIL {len(problems)}')
sys.exit(1 if problems else 0)
