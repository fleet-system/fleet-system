"""Phase 8: security probes run exactly as Supabase runs app requests (role anon / authenticated + JWT sub),
covering privilege escalation, sensitive data, disabled users, anonymous access and the catalog itself.
Usage: python3 -I security_probe.py   (fleet_ui reset with ui_seed.sql)"""
import subprocess, json

PSQL = ['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-d', 'fleet_ui', '-v', 'ON_ERROR_STOP=1']
def run(sql, as_user=None, anon=False):
    pre = 'begin;\n'
    if anon: pre += 'set local role anon;\n'
    elif as_user: pre += f"set local role authenticated;\nset local request.jwt.claim.sub = '{as_user}';\n"
    p = subprocess.run(PSQL + ['-c', pre + sql + ';\nrollback;'], capture_output=True, text=True)
    return p.returncode == 0, (p.stdout.strip().splitlines() or [''])[-1] if p.returncode == 0 else p.stderr.strip().splitlines()[0]

passed, problems = [], []
def expect_denied(name, sql, user=None, anon=False):
    if sql.split()[0].lower() in ('update', 'insert', 'delete') and 'returning' not in sql: sql += ' returning 1'
    okk, out = run(sql, user, anon)
    denied = (not okk) or out in ('0', '')
    (passed if denied else problems).append(f'{name} -> {"denied" if denied else "ALLOWED"} ({out[:90]})')
def expect_ok(name, sql, user, want=None):
    okk, out = run(sql, user)
    good = okk and (want is None or out == str(want))
    (passed if good else problems).append(f'{name} -> {"ok" if good else "FAILED"} ({out[:90]})')

ADMIN, VIEWER, ACCT = 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003'
CLERK, NOPERM, INACTIVE, MGR = 'a0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000014'
setup = f"""
insert into auth.users(id, email, raw_user_meta_data) values
 ('{CLERK}', 'clerk@test.local', '{{"full_name":"مدخل"}}'), ('{NOPERM}', 'noperm@test.local', '{{"full_name":"بلا صلاحيات"}}'),
 ('{INACTIVE}', 'off@test.local', '{{"full_name":"معطل"}}'), ('{MGR}', 'mgr@test.local', '{{"full_name":"مدير مستخدمين"}}')
 on conflict do nothing;
insert into user_permissions(user_id, permission) select '{CLERK}', p::app_permission from unnest(array['view','create','edit']) p on conflict do nothing;
insert into user_permissions(user_id, permission) select '{INACTIVE}', p::app_permission from unnest(enum_range(null::app_permission)::text[]) p on conflict do nothing;
insert into user_permissions(user_id, permission) select '{MGR}', p::app_permission from unnest(array['view','manage_users']) p on conflict do nothing;
update profiles set is_active = false where user_id = '{INACTIVE}';
insert into employee_private(employee_id, iqama_no, mobile) values ('e0000000-0000-0000-0000-000000000001', '2000000009', '0500000009') on conflict do nothing;
"""
p = subprocess.run(PSQL + ['-c', f"set request.jwt.claim.sub = '{ADMIN}';" + setup], capture_output=True, text=True)
if p.returncode: raise SystemExit(p.stderr)

TABLES = [r for r in subprocess.run(PSQL + ['-c', "select tablename from pg_tables where schemaname='public' order by 1"], capture_output=True, text=True).stdout.split()]
VIEWS = ['v_vehicles_overview', 'v_document_status', 'v_expenses', 'v_followups', 'v_vehicle_oil_status', 'v_vehicle_authorization']

# ---- catalog
okk, out = run("select string_agg(tablename, ',') from pg_tables where schemaname='public' and not rowsecurity")
(passed if okk and out == '' else problems).append(f'RLS enabled on every table ({len(TABLES)} tables) [{out}]')
okk, out = run("select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')")
(passed if okk and out == '' else problems).append(f'every SECURITY DEFINER function pins search_path [{out}]')
okk, out = run("select string_agg(distinct table_name, ',') from information_schema.role_table_grants where grantee in ('anon','public') and table_schema='public'")
(passed if okk and out == '' else problems).append(f'no table/view granted to anon or public [{out}]')
okk, out = run("select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute') and p.proname <> 'keepalive'")
(passed if okk and out == '' else problems).append(f'anon cannot execute any public function except keepalive [{out}]')
okk, out = run("select keepalive()", anon=True)
(passed if okk and out == 'ok' else problems).append(f'anon keepalive() returns only ok [{out}]')
okk, out = run("select p.prosecdef::text || ':' || (select count(*) from pg_proc q join pg_namespace m on m.oid=q.pronamespace where m.nspname='public' and q.proname='keepalive') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='keepalive'")
(passed if okk and out == 'false:1' else problems).append(f'keepalive is a single non-definer function [{out}]')

okk, out = run("select string_agg(distinct table_name||':'||privilege_type, ',') from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and privilege_type in ('DELETE','TRUNCATE','TRIGGER','REFERENCES') and not (table_name='user_permissions' and privilege_type='DELETE')")
(passed if okk and out == '' else problems).append(f'signed-in users have no DELETE/TRUNCATE rights (except revoking a permission) [{out}]')
okk, out = run("select string_agg(distinct table_name||':'||privilege_type, ',') from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and table_name like 'v\\_%' and privilege_type <> 'SELECT'")
(passed if okk and out == '' else problems).append(f'report views are read-only [{out}]')
for who, uid in [('viewer', VIEWER), ('admin', ADMIN)]:
    expect_denied(f'{who} truncates oil_changes', 'truncate oil_changes cascade', uid)

# ---- anonymous (not signed in)
for t in TABLES + VIEWS: expect_denied(f'anon reads {t}', f'select count(*) from {t}', anon=True)
expect_denied('anon inserts a vehicle', "insert into vehicles(plate_no, owner_company_id) values ('x', '11111111-1111-1111-1111-111111111111')", anon=True)
expect_denied('anon calls dashboard_stats', 'select dashboard_stats()', anon=True)

# ---- signed in but no permission / disabled
for who, uid in [('user with no permissions', NOPERM), ('disabled user (has every permission)', INACTIVE)]:
    for t in ['vehicles', 'employees', 'employee_private', 'attachments', 'oil_changes', 'v_expenses', 'v_document_status', 'audit_log', 'companies', 'app_settings']:
        expect_denied(f'{who} reads {t}', f'select count(*) from {t}', uid)
    expect_denied(f'{who} inserts a vehicle', "insert into vehicles(plate_no, owner_company_id) values ('ت ت ت 1', '11111111-1111-1111-1111-111111111111')", uid)
    expect_denied(f'{who} gets dashboard numbers', "select (dashboard_stats()->>'vehicles_total')::int", uid)

# ---- privilege escalation attempts
for who, uid in [('viewer', VIEWER), ('clerk', CLERK), ('accountant', ACCT)]:
    expect_denied(f'{who} makes himself admin', f"update profiles set is_admin = true where user_id = '{uid}'", uid)
    expect_denied(f'{who} grants himself manage_users', f"insert into user_permissions(user_id, permission) values ('{uid}', 'manage_users')", uid)
    expect_denied(f'{who} grants himself view_sensitive', f"insert into user_permissions(user_id, permission) values ('{uid}', 'view_sensitive')", uid)
    expect_denied(f'{who} re-enables a disabled user', f"update profiles set is_active = true where user_id = '{INACTIVE}'", uid)
    expect_denied(f'{who} creates a profile', f"insert into profiles(user_id, email, is_admin) values (gen_random_uuid(), 'x@x', true)", uid)
    expect_denied(f'{who} edits audit log', 'update audit_log set changed_by = null', uid)
    expect_denied(f'{who} deletes audit log', 'delete from audit_log', uid)
    expect_denied(f'{who} writes audit log', "insert into audit_log(table_name, action) values ('x','INSERT')", uid)
    expect_denied(f'{who} changes VAT setting', "update app_settings set value = '0' where key = 'default_vat_rate'", uid)
    expect_denied(f'{who} adds a company', "insert into companies(name) values ('شركة دخيلة')", uid)
    expect_denied(f'{who} calls bump_odometer directly', "select bump_odometer('b0000000-0000-0000-0000-000000000001', 1, 'manual')", uid)
    expect_denied(f'{who} hard-deletes a vehicle', "delete from vehicles where id = 'b0000000-0000-0000-0000-000000000005'", uid)
    expect_denied(f'{who} reads other users permissions', f"select count(*) from user_permissions where user_id <> '{uid}'", uid)
expect_denied('user manager grants manage_users (admin only)', f"insert into user_permissions(user_id, permission) values ('{CLERK}', 'manage_users')", MGR)
expect_denied('user manager makes someone admin', f"update profiles set is_admin = true where user_id = '{CLERK}'", MGR)
expect_ok('user manager can grant ordinary permissions', f"insert into user_permissions(user_id, permission) values ('{NOPERM}', 'view') returning 1", MGR, 1)
expect_ok('user manager can disable a user', f"update profiles set is_active = false where user_id = '{CLERK}' returning 1", MGR, 1)

# ---- viewer is read-only
for t, sql in [('vehicles', "update vehicles set color = 'x'"), ('oil_changes', "update oil_changes set oil_cost = 0"), ('employees', "update employees set job_title = 'x'"),
               ('documents', "insert into documents(doc_type, vehicle_id, expiry_date) values ('registration', 'b0000000-0000-0000-0000-000000000001', '2030-01-01')"),
               ('archive', "update maintenance set deleted_at = now()")]:
    expect_denied(f'viewer writes {t}', sql, VIEWER)
expect_denied('viewer uploads a file to storage', "insert into storage.objects(bucket_id, name) values ('attachments', 'vehicle/x/y.jpg')", VIEWER)
expect_denied('viewer registers a company via ensure_company', "select ensure_company('شركة دخيلة')", VIEWER)
expect_denied('viewer registers a site via ensure_site', "select ensure_site('موقع دخيل', '11111111-1111-1111-1111-111111111111')", VIEWER)
expect_denied('anon calls ensure_company', "select ensure_company('x')", anon=True)
expect_denied('viewer calls correct_odometer', "select correct_odometer('b0000000-0000-0000-0000-000000000001', 1, 'x')", VIEWER)

# ---- sensitive data
for who, uid in [('viewer', VIEWER), ('accountant', ACCT), ('clerk', CLERK)]:
    expect_denied(f'{who} reads iqama/mobile numbers', 'select count(*) from employee_private', uid)
    expect_denied(f'{who} writes iqama numbers', "update employee_private set iqama_no = '2000000008'", uid)
    expect_denied(f'{who} sees iqama via any view column', "select count(*) from information_schema.columns where table_name like 'v\\_%' and column_name in ('iqama_no','mobile','driving_license_no')", uid)
    expect_denied(f'{who} reads vehicle ID numbers', 'select count(*) from vehicle_private', uid)
    expect_denied(f'{who} writes vehicle ID numbers', "insert into vehicle_private(vehicle_id, owner_id_no) values ('b0000000-0000-0000-0000-000000000001', '0123')", uid)
expect_denied('anon reads vehicle ID numbers', 'select count(*) from vehicle_private', anon=True)
expect_ok('admin writes vehicle ID numbers', "insert into vehicle_private(vehicle_id, owner_id_no) values ('b0000000-0000-0000-0000-000000000001', '0123') returning 1", ADMIN, 1)
expect_ok('vehicle ID numbers not stored in the audit log', "insert into vehicle_private(vehicle_id, owner_id_no) values ('b0000000-0000-0000-0000-000000000001', '0123'); select count(*) from audit_log where table_name = 'vehicle_private' and (coalesce(new_data::text, '') like '%0123%' or coalesce(changes::text, '') like '%0123%') and exists (select 1 from audit_log where table_name = 'vehicle_private')", ADMIN, 0)
expect_ok('admin reads iqama numbers', "select count(*) from employee_private where iqama_no is not null", ADMIN, 1)

# ---- clerk can do the daily work
expect_ok('clerk adds an oil change', "insert into oil_changes(vehicle_id, change_date, odometer, oil_cost) values ('b0000000-0000-0000-0000-000000000005', app_today(), 150000, 100) returning 1", CLERK, 1)
expect_ok('clerk edits a vehicle', "update vehicles set color = 'أزرق' where id = 'b0000000-0000-0000-0000-000000000005' returning 1", CLERK, 1)
expect_denied('clerk sees invoices (needs invoices permission)', "select count(*) from attachments where sensitivity = 'invoice'", CLERK)

print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
