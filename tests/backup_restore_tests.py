"""v1.4 data protection: backup -> site update with changed structure -> restore (full + merge), conflicts,
corrupt files, failure in the middle of a restore. Runs on its own scratch database (fleet_bk), never on real data.
Usage: python3 -I backup_restore_tests.py"""
import subprocess, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = ['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']
DB = 'fleet_bk'
ADMIN, VIEWER = 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002'
V1, V3 = 'b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003'
passed, problems = [], []
def ok(c, m): (passed if c else problems).append(m)

def psql(sql, db=DB, check=True):
    p = subprocess.run(BASE + ['-d', db, '-c', sql], capture_output=True, text=True)
    if check and p.returncode: raise SystemExit(p.stderr)
    return p
def q(sql): return psql(sql).stdout.strip()
def as_user(sql, uid=ADMIN):
    p = subprocess.run(BASE + ['-d', DB], input=f"begin;\nset local role authenticated;\nset local request.jwt.claim.sub = '{uid}';\n{sql};\ncommit;\n", capture_output=True, text=True)
    lines = [l for l in p.stdout.splitlines() if l and l not in ('BEGIN', 'COMMIT', 'SET')]
    return p.returncode == 0, (lines[-1] if lines else ''), p.stderr.strip()
def rpc(fn, args, uid=ADMIN):
    good, out, err = as_user(f'select {fn}({args})', uid)
    return (json.loads(out) if good and out.startswith('{') else None), err
def lit(s): return "'" + s.replace("'", "''") + "'"

def fresh():
    psql(f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{DB}' and pid<>pg_backend_pid()", db='postgres')
    psql(f'drop database if exists {DB}', db='postgres'); psql(f'create database {DB}', db='postgres')
    p = subprocess.run(BASE + ['-d', DB, '-f', os.path.join(HERE, 'supabase_stub.sql'), '-f', os.path.join(HERE, '..', 'supabase', 'setup_clean.sql'), '-f', os.path.join(HERE, 'ui_seed.sql')], capture_output=True, text=True)
    if p.returncode: raise SystemExit(p.stderr[-2000:])
def counts():
    return {t: int(q(f'select count(*) from {t}')) for t in ['companies', 'sites', 'employees', 'vehicles', 'documents', 'oil_changes', 'maintenance', 'maintenance_items', 'accidents', 'handovers', 'housing_maintenance', 'food_supplies', 'attachments']}
def links():  # every record that belongs to a vehicle, with its vehicle
    return q("select string_agg(x, ',' order by x) from (select 'oil:'||id||'>'||vehicle_id x from oil_changes union all select 'mnt:'||id||'>'||vehicle_id from maintenance "
             "union all select 'acc:'||id||'>'||vehicle_id from accidents union all select 'doc:'||id||'>'||coalesce(vehicle_id::text, employee_id::text) from documents "
             "union all select 'item:'||id||'>'||maintenance_id from maintenance_items union all select 'veh:'||id||'>'||coalesce(site_id::text,'-')||'/'||owner_company_id from vehicles) s")

# ================================================================ A. create + permissions
fresh()
c0, l0 = counts(), links()
notes0 = q(f"select coalesce(notes,'') from vehicles where id='{V1}'")
q(f"update vehicles set notes = 'ملاحظة قديمة مهمة', color = 'رمادي' where id = '{V1}'")
c0, l0 = counts(), links()
b1, err = rpc('create_backup', "'pre_update', 'before site update', '1.4'")
ok(b1 and b1.get('verified') and b1['backup_no'].startswith('BK-') and b1['counts']['vehicles'] == c0['vehicles'], f'A. backup created, verified, numbered ({b1 and b1["backup_no"]})')
ok(q(f"select md5(payload::text) = checksum and verified from system_backups where id = '{b1['id']}'") == 't', 'A. stored copy checksum matches')
ok(q("select value->>'backup_no' from app_settings where key='last_backup'") == b1['backup_no'], 'A. «last backup» reminder updated')
for name, uid in [('viewer', VIEWER)]:
    r, err = rpc('create_backup', "'manual'", uid); ok(r is None and 'PERMISSION_DENIED' in err, f'A. {name} cannot create backups')
    good, out, err = as_user('select count(*) from system_backups', uid); ok(good and out == '0', f'A. {name} cannot see backups')
    r, err = rpc('restore_backup', f"'{b1['id']}', 'merge'", uid); ok(r is None and 'PERMISSION_DENIED' in err, f'A. {name} cannot restore')
p = subprocess.run(BASE + ['-d', DB], input="begin; set local role anon; select create_backup('manual'); commit;", capture_output=True, text=True)
ok(p.returncode != 0, 'A. anonymous cannot create backups')
payload_keys = q(f"select string_agg(k, ',' order by k) from system_backups b, jsonb_object_keys(b.payload->'tables') k where b.id='{b1['id']}'").split(',')
ok(all(t in payload_keys for t in ['vehicles', 'vehicle_private', 'oil_changes', 'maintenance', 'maintenance_items', 'accidents', 'handovers', 'documents', 'sites', 'companies', 'employees', 'housing_maintenance', 'food_supplies', 'attachments', 'audit_log', 'app_settings', 'user_permissions', 'profiles']),
   'A. backup includes every section (vehicles, maintenance, oil, accidents, handovers, documents, projects, expenses, attachments, settings, permissions, audit)')
ok(q(f"select count(*) from system_backups b, jsonb_array_elements(b.payload->'tables'->'profiles') x where b.id='{b1['id']}' and (x ? 'encrypted_password' or x ? 'password')") == '0', 'A. no passwords in the backup')

# ================================================================ B. site update changes the structure, then full restore
q("insert into vehicles(plate_no, owner_company_id) values ('ج د ي 9999', '11111111-1111-1111-1111-111111111111')")   # added after the backup
q(f"update vehicles set notes = 'تعديل بعد النسخة' where id = '{V1}'")
# "site update": a field renamed, a field removed, a new required field with a default
q("drop view if exists v_vehicles_overview cascade")
q("alter table vehicles rename column notes to remarks")
q("insert into field_migrations(table_name, old_column, new_column, note) values ('vehicles', 'notes', 'remarks', 'renamed in update')")
q("alter table vehicles drop column color cascade")
q("alter table vehicles add column fleet_group text not null default 'A'")
chk, err = rpc('check_backup', f"'{b1['id']}'")
ok(chk and chk['ok'] and chk['merge'].get('restored') == 0 and chk['full'].get('removed_not_in_backup', 0) >= 1, f'B. check passes; preview: full mode would remove {chk and chk["full"].get("removed_not_in_backup")} record(s) added after the backup')
ok(int(q("select count(*) from vehicles")) == c0['vehicles'] + 1, 'B. checking never changes data (trial run rolled back)')
r, err = rpc('restore_backup', f"'{b1['id']}', 'full'")
ok(r is None and 'CONFIRMATION' in err, 'B. full restore refused without explicit confirmation')
r, err = rpc('restore_backup', f"'{b1['id']}', 'full', 'REPLACE'")
ok(r and r['ok'] and r['failed_count'] == 0 and r['conflicts_count'] == 0, f'B. full restore succeeded ({r and r["restored"]} records, failed {r and r["failed_count"]}) {err[:200]}')
c1 = counts()
ok(c1 == c0, f'B. every section back to the backup state {c1 if c1 != c0 else ""}')
ok(links() == l0, 'B. every maintenance/oil/accident/document still linked to the same vehicle; vehicles to the same project and owner')
ok(q(f"select remarks from vehicles where id='{V1}'") == 'ملاحظة قديمة مهمة', 'B. renamed field: old «notes» value restored into the new field')
ok(q("select count(*) from vehicles where fleet_group = 'A'") == str(c0['vehicles']), 'B. new required field filled with its default')
ok(q(f"select data->>'color' from restore_leftovers where table_name='vehicles' and record_id='{V1}' and backup_label='{b1['backup_no']}'") == 'رمادي', 'B. value of a removed field kept for review (not dropped)')
ok(r['pre_restore']['backup_no'].startswith('BK-') and q(f"select kind from system_backups where backup_no='{r['pre_restore']['backup_no']}'") == 'pre_restore', 'B. automatic copy of the state before restoring (undo)')
ok(q("select count(*) from vehicles where plate_no = 'ج د ي 9999'") == '0' and r['removed_not_in_backup'] >= 1, 'B. full mode removed the record added after the backup (after warning + confirmation)')
pre_has = q(f"select count(*) from system_backups b, jsonb_array_elements(b.payload->'tables'->'vehicles') x where b.backup_no = '{r['pre_restore']['backup_no']}' and x->>'plate_no' = 'ج د ي 9999'")
ok(pre_has == '1', 'B. that record is still inside the automatic pre-restore copy (can be brought back)')
seq_ok = q("select nextval('vehicle_code_seq') > (select max(regexp_replace(code, '\\D', '', 'g')::int) from vehicles)")
ok(seq_ok == 't', 'B. vehicle numbering continues after the restored numbers')
ok(int(q("select count(*) from system_backup_log where action in ('create','check','restore_full')")) >= 3, 'B. every operation recorded in the log')

# ================================================================ C. merge: missing records come back, new ones stay, no duplicates
fresh()
b2, _ = rpc('create_backup', "'pre_update'")
c0, l0 = counts(), links()
q("insert into vehicles(plate_no, owner_company_id) values ('ن ج د 1111', '11111111-1111-1111-1111-111111111111')")   # new after backup
lost_oil = q("select id from oil_changes order by id limit 1")
lost_m = q("select id from maintenance order by id limit 1")
q(f"alter table oil_changes disable trigger user; delete from oil_changes where id = '{lost_oil}'; alter table oil_changes enable trigger user")
q(f"alter table maintenance_items disable trigger user; alter table maintenance disable trigger user; alter table maintenance_requests disable trigger user;"
  f" update maintenance_requests set maintenance_id = null where maintenance_id = '{lost_m}'; delete from maintenance_items where maintenance_id = '{lost_m}'; delete from maintenance where id = '{lost_m}';"
  f" alter table maintenance_items enable trigger user; alter table maintenance enable trigger user; alter table maintenance_requests enable trigger user")
chk, _ = rpc('check_backup', f"'{b2['id']}'")
ok(chk and chk['merge']['restored'] >= 2 and chk['merge']['conflicts_count'] == 0, f'C. check: merge would bring back {chk and chk["merge"]["restored"]} missing record(s)')
r, err = rpc('restore_backup', f"'{b2['id']}', 'merge'")
ok(r and r['ok'] and r['failed_count'] == 0, f'C. merge restore succeeded {err[:200]}')
c1 = counts()
ok(c1['vehicles'] == c0['vehicles'] + 1 and all(c1[k] == c0[k] for k in c0 if k != 'vehicles'), f'C. missing records restored, new vehicle kept, nothing duplicated {c1}')
ok(q(f"select count(*) from oil_changes where id = '{lost_oil}'") == '1' and q(f"select count(*) from maintenance_items where maintenance_id = '{lost_m}'") != '0', 'C. lost oil change and maintenance (with its items) back under their original IDs')
r2, _ = rpc('restore_backup', f"'{b2['id']}', 'merge'")
ok(r2 and r2['ok'] and r2['restored'] == 0 and counts() == c1, 'C. running the merge again adds nothing (no duplicates)')

# ================================================================ D. conflicts are listed, not merged blindly
plate3 = q(f"select plate_no from vehicles where id = '{V3}'")
q(f"alter table vehicles disable trigger user; alter table oil_changes disable trigger user; alter table documents disable trigger user; alter table maintenance disable trigger user;"
  f" alter table accidents disable trigger user; alter table handovers disable trigger user; alter table vehicle_assignments disable trigger user; alter table authorizations disable trigger user;"
  f" alter table odometer_readings disable trigger user; alter table vehicle_field_history disable trigger user; alter table maintenance_requests disable trigger user; alter table maintenance_items disable trigger user;"
  f" delete from maintenance_items where maintenance_id in (select id from maintenance where vehicle_id='{V3}'); delete from maintenance_requests where vehicle_id='{V3}';"
  f" delete from oil_changes where vehicle_id='{V3}'; delete from documents where vehicle_id='{V3}'; delete from maintenance where vehicle_id='{V3}'; delete from accidents where vehicle_id='{V3}';"
  f" delete from vehicle_assignments where vehicle_id='{V3}'; delete from handovers where vehicle_id='{V3}'; delete from authorizations where vehicle_id='{V3}'; delete from odometer_readings where vehicle_id='{V3}';"
  f" delete from vehicle_field_history where vehicle_id='{V3}'; delete from vehicles where id='{V3}';"
  f" alter table vehicles enable trigger user; alter table oil_changes enable trigger user; alter table documents enable trigger user; alter table maintenance enable trigger user;"
  f" alter table accidents enable trigger user; alter table handovers enable trigger user; alter table vehicle_assignments enable trigger user; alter table authorizations enable trigger user;"
  f" alter table odometer_readings enable trigger user; alter table vehicle_field_history enable trigger user; alter table maintenance_requests enable trigger user; alter table maintenance_items enable trigger user")
q(f"insert into vehicles(plate_no, owner_company_id) values ('{plate3}', '11111111-1111-1111-1111-111111111111')")   # another vehicle now uses the same plate
nveh = int(q('select count(*) from vehicles'))
r, err = rpc('restore_backup', f"'{b2['id']}', 'merge'")
conf = [c for c in (r or {}).get('conflicts', []) if c['table'] == 'vehicles']
ok(r and r['ok'] and conf and plate3 in conf[0]['label'], f'D. same plate under a different vehicle: listed as a conflict for review ({conf[:1]})')
ok(int(q('select count(*) from vehicles')) == nveh and q(f"select count(*) from vehicles where plate_no = '{plate3}'") == '1', 'D. conflicting vehicle not inserted (no duplicate plate)')
ok(r and r['failed_count'] >= 1 and all(f['reason'] == '23503' for f in r['failed']), 'D. its records listed as «cannot restore: vehicle missing» instead of being attached to the wrong vehicle')

# ================================================================ E. corrupt backup is refused and nothing changes
before = counts()
q(f"update system_backups set payload = jsonb_set(payload, '{{tables,vehicles,0,plate_no}}', '\"XXX\"') where id = '{b2['id']}'")
chk, _ = rpc('check_backup', f"'{b2['id']}'")
ok(chk and chk['ok'] is False and 'checksum' in chk['problems'], 'E. tampered backup fails the check')
r, _ = rpc('restore_backup', f"'{b2['id']}', 'full', 'REPLACE'")
ok(r and r['ok'] is False and r['error'] == 'BACKUP_CORRUPT' and counts() == before, 'E. restore refused, current data untouched')

# ================================================================ F. failure in the middle of a full restore -> everything undone
b3, _ = rpc('create_backup', "'manual'")
q("insert into vehicles(plate_no, owner_company_id) values ('ف ش ل 4040', '11111111-1111-1111-1111-111111111111')")
before, lb = counts(), links()
q("alter table food_supplies drop constraint food_supplies_pkey")   # breaks the restore near the end, after everything was deleted
r, err = rpc('restore_backup', f"'{b3['id']}', 'full', 'REPLACE'")
ok(r and r['ok'] is False, f'F. failing restore reports failure ({r and r.get("error", "")[:80]})')
ok(counts() == before and links() == lb and q("select count(*) from vehicles where plate_no='ف ش ل 4040'") == '1', 'F. after the failure all current data is exactly as before (nothing lost)')
ok(q("select ok::text from system_backup_log where action = 'restore_full' order by id desc limit 1") == 'false', 'F. failure recorded in the log')
ok(q("select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'vehicles' and not t.tgisinternal and t.tgenabled = 'D'") == '0', 'F. protections (triggers) active again after the failure')
q("alter table food_supplies add primary key (id)")

# ================================================================ G. download file -> upload -> restore
dl, _ = rpc('backup_download', f"'{b3['id']}'")
filetext = '{"integrity":{"md5":"' + dl['checksum'] + '","backup_no":"' + dl['backup_no'] + '"},"backup":' + dl['text'] + '}'
up, err = rpc('import_backup', f"{lit(filetext)}, 'fleet-backup.json'")
ok(up and up['integrity_checked'] and up['same_system'] and q(f"select checksum from system_backups where id='{up['id']}'") == dl['checksum'], f'G. downloaded file uploads back with matching checksum {err[:150]}')
bad = filetext.replace('ف ش ل', 'ف ش ك', 1) if 'ف ش ل' in filetext else filetext.replace('"plate_no": "', '"plate_no": "X', 1)
up2, err = rpc('import_backup', f"{lit(bad)}, 'edited.json'")
ok(up2 is None and 'BACKUP_CORRUPT' in err, 'G. a file edited by hand is rejected (checksum)')
up3, err = rpc('import_backup', f"{lit(json.dumps({'hello': 1}))}, 'x.json'")
ok(up3 is None and 'BACKUP_INVALID' in err, 'G. a file from another program is rejected')
legacy = json.dumps({'format': 'fleet-backup', 'version': 1, 'created_at': '2026-10-01T00:00:00Z', 'tables': {'companies': json.loads(q("select jsonb_agg(to_jsonb(c)) from companies c")), 'vehicles': []}})
up4, err = rpc('import_backup', f"{lit(legacy)}, 'old.json'")
ok(up4 and up4['integrity_checked'] is False, 'G. older backup files (from the previous version) are accepted')
r, err = rpc('restore_backup', f"'{up['id']}', 'merge'")
ok(r and r['ok'] and r['failed_count'] == 0 and r['conflicts_count'] == 0, f'G. restore from the uploaded file works {err[:150]}')

print(f'PASS {len(passed)}')
for x in passed: print('  ok  ', x)
print(f'FAIL {len(problems)}')
for x in problems: print('  FAIL', x)
