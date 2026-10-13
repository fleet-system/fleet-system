-- Fleet system update v1.3 + v1.4: run once in Supabase SQL Editor (safe to run again). ASCII only.
-- =====================================================================
-- 0010: new vehicle card (add / edit). ASCII only. Adds columns and one protected table only;
-- no existing vehicle, document, expense or history row is changed or removed. Safe to run more than once.
--  * wheels_count, operating state (inside / outside / other + free text), insurance expiry,
--    manual cost fields (oil, maintenance, maintenance total) on vehicles
--  * ID numbers of the current user and of the owner in vehicle_private: readable only with view_sensitive
-- =====================================================================
alter table vehicles add column if not exists wheels_count     int;
alter table vehicles add column if not exists op_state         text;
alter table vehicles add column if not exists op_state_text    text;
alter table vehicles add column if not exists insurance_expiry date;
alter table vehicles add column if not exists cost_oil         numeric(12,2);
alter table vehicles add column if not exists cost_maint       numeric(12,2);
alter table vehicles add column if not exists cost_maint_total numeric(12,2);

alter table vehicles drop constraint if exists vehicles_wheels_count_range;
alter table vehicles add constraint vehicles_wheels_count_range check (wheels_count is null or wheels_count between 1 and 40);
alter table vehicles drop constraint if exists vehicles_op_state_values;
alter table vehicles add constraint vehicles_op_state_values check (op_state is null or op_state in ('inside', 'outside', 'other'));
alter table vehicles drop constraint if exists vehicles_op_state_other_text;
alter table vehicles add constraint vehicles_op_state_other_text check (op_state is distinct from 'other' or nullif(btrim(op_state_text), '') is not null);
alter table vehicles drop constraint if exists vehicles_costs_positive;
alter table vehicles add constraint vehicles_costs_positive check (coalesce(cost_oil, 0) >= 0 and coalesce(cost_maint, 0) >= 0 and coalesce(cost_maint_total, 0) >= 0);

-- ID numbers (user / owner): separate table, same protection as employee_private
create table if not exists vehicle_private (
  vehicle_id         uuid primary key references vehicles(id),
  current_user_id_no text,
  owner_id_no        text,
  updated_at         timestamptz not null default now(),
  constraint vp_user_id_digits  check (current_user_id_no is null or current_user_id_no ~ '^[0-9]{1,20}$'),
  constraint vp_owner_id_digits check (owner_id_no is null or owner_id_no ~ '^[0-9]{1,20}$')
);
alter table vehicle_private enable row level security;
drop policy if exists p_select on vehicle_private;
drop policy if exists p_insert on vehicle_private;
drop policy if exists p_update on vehicle_private;
create policy p_select on vehicle_private for select to authenticated using (has_perm('view_sensitive'));
create policy p_insert on vehicle_private for insert to authenticated with check (has_perm('create') and has_perm('view_sensitive'));
create policy p_update on vehicle_private for update to authenticated
  using (has_perm('edit') and has_perm('view_sensitive')) with check (has_perm('edit') and has_perm('view_sensitive'));
revoke all on vehicle_private from anon, public;
revoke delete, truncate, references, trigger on vehicle_private from authenticated;
grant select, insert, update on vehicle_private to authenticated;

drop trigger if exists set_updated_at on vehicle_private;
create trigger set_updated_at before update on vehicle_private for each row execute function trg_set_updated_at();
drop trigger if exists block_delete on vehicle_private;
create trigger block_delete before delete on vehicle_private for each row execute function trg_block_delete();

-- audit without storing the numbers themselves
create or replace function trg_audit_vehicle_private() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(table_name, record_id, action, changed_by, old_data, new_data, changes)
  values ('vehicle_private', coalesce(new.vehicle_id, old.vehicle_id)::text, tg_op, auth.uid(), null, null,
          '{"id_numbers": "(sensitive value changed)"}'::jsonb);
  return coalesce(new, old);
end $$;
revoke execute on function trg_audit_vehicle_private() from public, anon;
drop trigger if exists audit on vehicle_private;
create trigger audit after insert or update on vehicle_private for each row execute function trg_audit_vehicle_private();

-- Rebuild the vehicles overview so it includes the new vehicle columns (v.* is expanded when the view is created).
drop view if exists v_vehicles_overview;
create view v_vehicles_overview with (security_invoker = true) as
select
  v.*,
  oc.name  as owner_company_name,
  s.name   as site_name,
  s.company_id as site_company_id,
  sc.name  as site_company_name,
  e.full_name as driver_name,
  e.code      as driver_code,
  va.status   as authorization_status,
  va.expiry_date as authorization_expiry,
  oil.next_odometer as oil_next_odometer,
  oil.remaining_km  as oil_remaining_km,
  oil.status        as oil_status,
  nd.doc_type    as nearest_doc_type,
  nd.expiry_date as nearest_doc_expiry,
  nd.days_left   as nearest_doc_days_left
from vehicles v
join companies oc on oc.id = v.owner_company_id
left join sites s on s.id = v.site_id
left join companies sc on sc.id = s.company_id
left join employees e on e.id = v.current_driver_id
left join v_vehicle_authorization va on va.vehicle_id = v.id
left join v_vehicle_oil_status oil on oil.vehicle_id = v.id
left join lateral (
  select ds.doc_type, ds.expiry_date, ds.days_left from v_document_status ds
  where ds.owner_type = 'vehicle' and ds.owner_id = v.id and ds.expiry_date is not null
  order by ds.expiry_date limit 1
) nd on true
where v.deleted_at is null;
revoke all on v_vehicles_overview from anon;
revoke insert, update, delete, truncate, references, trigger on v_vehicles_overview from authenticated;
grant select on v_vehicles_overview to authenticated;

select 'VEHICLE_CARD_OK' as result;

-- =====================================================================
-- 0011: data protection before site updates.
--  * full backups kept inside the database (table system_backups), each verified with an md5 checksum
--  * download / upload of a backup file, integrity check before anything is restored
--  * restore in one transaction: "merge" (add missing records, keep current ones) or "full" (replace)
--  * automatic backup of the current state before every restore (undo), and an operation log
--  * field_migrations: old column -> new column mapping used when an old backup is restored into a newer version
--  * restore_leftovers: values from a backup that have no matching field anymore are kept here for review
-- Admin only. ASCII only. Adds tables/functions only; existing data is not changed. Safe to run more than once.
-- =====================================================================

create sequence if not exists backup_no_seq;

create table if not exists system_backups (
  id                uuid primary key default gen_random_uuid(),
  backup_no         text not null unique default ('BK-' || lpad(nextval('backup_no_seq')::text, 6, '0')),
  kind              text not null check (kind in ('manual', 'pre_update', 'pre_restore', 'uploaded')),
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  source_created_at timestamptz,
  app_version       text,
  schema_version    int not null default 0,
  counts            jsonb not null default '{}'::jsonb,
  checksum          text not null,
  size_bytes        bigint not null default 0,
  verified          boolean not null default false,
  payload           jsonb not null
);

create table if not exists system_backup_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  by_user    uuid,
  action     text not null,
  backup_id  uuid,
  backup_no  text,
  ok         boolean not null,
  details    jsonb
);

create table if not exists field_migrations (
  table_name text not null,
  old_column text not null,
  new_column text not null,
  note       text,
  primary key (table_name, old_column)
);

create table if not exists restore_leftovers (
  id           bigint generated always as identity primary key,
  restored_at  timestamptz not null default now(),
  backup_label text,
  table_name   text not null,
  record_id    text,
  data         jsonb not null,
  reviewed     boolean not null default false
);

-- admin can read; all writes go through the functions below
do $$
declare t text;
begin
  foreach t in array array['system_backups', 'system_backup_log', 'field_migrations', 'restore_leftovers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists p_select on public.%I', t);
    execute format('create policy p_select on public.%I for select to authenticated using (is_admin())', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

insert into app_settings(key, value, description)
values ('system_id', to_jsonb(gen_random_uuid()::text), 'system identifier (backups)')
on conflict (key) do nothing;

create or replace function app_schema_version() returns int language sql immutable as $$ select 11 $$;

-- every table of the system, parents before children
create or replace function backup_table_list() returns text[] language sql immutable as $$
  select array['companies', 'sites', 'site_history', 'app_settings', 'profiles', 'user_permissions', 'employees', 'employee_private',
               'vehicles', 'vehicle_private', 'odometer_readings', 'vehicle_field_history', 'authorizations', 'documents',
               'oil_changes', 'maintenance', 'maintenance_items', 'maintenance_requests', 'accidents', 'handovers',
               'vehicle_assignments', 'housing_maintenance', 'food_supplies', 'attachments', 'import_batches', 'audit_log']
$$;
-- accounts and permissions are saved in the backup but never overwritten by a restore (safety)
create or replace function restore_table_list() returns text[] language sql immutable as $$
  select array(select t from unnest(backup_table_list()) t where t not in ('profiles', 'user_permissions'))
$$;

create or replace function _backup_log(p_action text, p_id uuid, p_no text, p_ok boolean, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into system_backup_log(by_user, action, backup_id, backup_no, ok, details) values (auth.uid(), p_action, p_id, p_no, p_ok, p_details)
$$;

-- consistent snapshot of every table (one transaction). No passwords: auth.users is not included.
create or replace function _backup_snapshot() returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text; rows jsonb; tbls jsonb := '{}'; cnt jsonb := '{}';
begin
  foreach t in array backup_table_list() loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into rows;
    tbls := tbls || jsonb_build_object(t, rows);
    cnt := cnt || jsonb_build_object(t, jsonb_array_length(rows));
  end loop;
  return jsonb_build_object('format', 'fleet-backup', 'version', 2, 'schema_version', app_schema_version(),
    'system_id', (select value #>> '{}' from app_settings where key = 'system_id'),
    'created_at', now(), 'counts', cnt, 'tables', tbls);
end $$;

create or replace function _create_backup(p_kind text, p_note text, p_app_version text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl jsonb; t text; n bigint; rec system_backups%rowtype;
begin
  pl := _backup_snapshot() || jsonb_build_object('app_version', p_app_version, 'kind', p_kind);
  -- verification 1: every table in the copy has exactly the rows that exist now
  foreach t in array backup_table_list() loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('select count(*) from public.%I', t) into n;
    if n <> jsonb_array_length(pl->'tables'->t) then raise exception 'BACKUP_VERIFY_FAILED: %', t; end if;
  end loop;
  insert into system_backups(kind, note, created_by, source_created_at, app_version, schema_version, counts, checksum, size_bytes, verified, payload)
  values (p_kind, p_note, auth.uid(), now(), p_app_version, app_schema_version(), pl->'counts', md5(pl::text), octet_length(pl::text), false, pl)
  returning * into rec;
  -- verification 2: the stored copy reads back identical
  if (select md5(payload::text) from system_backups where id = rec.id) <> rec.checksum then raise exception 'BACKUP_VERIFY_FAILED: checksum'; end if;
  update system_backups set verified = true where id = rec.id;
  if p_kind <> 'pre_restore' then
    insert into app_settings(key, value, description)
    values ('last_backup', jsonb_build_object('at', rec.created_at, 'counts', rec.counts, 'backup_no', rec.backup_no), 'last backup')
    on conflict (key) do update set value = excluded.value;
  end if;
  perform _backup_log('create', rec.id, rec.backup_no, true, jsonb_build_object('kind', p_kind, 'size', rec.size_bytes));
  return jsonb_build_object('id', rec.id, 'backup_no', rec.backup_no, 'created_at', rec.created_at, 'kind', p_kind,
    'counts', rec.counts, 'checksum', rec.checksum, 'size_bytes', rec.size_bytes, 'verified', true);
end $$;

create or replace function create_backup(p_kind text default 'manual', p_note text default null, p_app_version text default null) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
begin
  if not is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_kind not in ('manual', 'pre_update') then raise exception 'BACKUP_KIND_INVALID'; end if;
  return _create_backup(p_kind, p_note, p_app_version);
end $$;

-- the exact stored text of a backup (numbers keep their digits), for download
create or replace function backup_download(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare r system_backups%rowtype;
begin
  if not is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into r from system_backups where id = p_id;
  if not found then raise exception 'BACKUP_NOT_FOUND'; end if;
  if md5(r.payload::text) <> r.checksum then raise exception 'BACKUP_CORRUPT'; end if;
  perform _backup_log('download', r.id, r.backup_no, true, null);
  return jsonb_build_object('backup_no', r.backup_no, 'checksum', r.checksum, 'created_at', coalesce(r.source_created_at, r.created_at), 'text', r.payload::text);
end $$;

-- a backup file chosen on the device: {"integrity": {"md5": ...}, "backup": {...}} or an older plain backup
create or replace function import_backup(p_text text, p_file_name text default null) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare doc jsonb; body jsonb; integ jsonb; cnt jsonb; rec system_backups%rowtype; sid text;
begin
  if not is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  begin doc := p_text::jsonb; exception when others then raise exception 'BACKUP_INVALID: not a JSON file'; end;
  if doc ? 'backup' then body := doc->'backup'; integ := doc->'integrity'; else body := doc; integ := null; end if;
  if jsonb_typeof(body) <> 'object' or body->>'format' is distinct from 'fleet-backup' or jsonb_typeof(body->'tables') is distinct from 'object' then
    raise exception 'BACKUP_INVALID: not a backup of this system';
  end if;
  if integ is not null and integ->>'md5' is distinct from md5(body::text) then raise exception 'BACKUP_CORRUPT: checksum does not match'; end if;
  if exists (select 1 from jsonb_each(body->'tables') e where jsonb_typeof(e.value) <> 'array') then raise exception 'BACKUP_INVALID: table is not a list'; end if;
  if exists (select 1 from jsonb_each(body->'tables') e, jsonb_array_elements(e.value) x where jsonb_typeof(x) <> 'object') then raise exception 'BACKUP_INVALID: bad record'; end if;
  if body ? 'counts' and exists (select 1 from jsonb_each(body->'counts') c
       where jsonb_array_length(coalesce(body->'tables'->c.key, '[]'::jsonb)) <> (c.value #>> '{}')::int) then
    raise exception 'BACKUP_CORRUPT: record counts do not match';
  end if;
  if not exists (select 1 from jsonb_object_keys(body->'tables') k where k in ('vehicles', 'companies')) then raise exception 'BACKUP_INVALID: no vehicles or companies'; end if;
  select jsonb_object_agg(e.key, jsonb_array_length(e.value)) into cnt from jsonb_each(body->'tables') e;
  sid := (select value #>> '{}' from app_settings where key = 'system_id');
  insert into system_backups(kind, note, created_by, source_created_at, app_version, schema_version, counts, checksum, size_bytes, verified, payload)
  values ('uploaded', p_file_name, auth.uid(), nullif(body->>'created_at', '')::timestamptz, body->>'app_version',
          coalesce((body->>'schema_version')::int, 0), cnt, md5(body::text), octet_length(body::text), true, body)
  returning * into rec;
  perform _backup_log('upload', rec.id, rec.backup_no, true, jsonb_build_object('file', p_file_name, 'integrity_checked', integ is not null));
  return jsonb_build_object('id', rec.id, 'backup_no', rec.backup_no, 'counts', cnt, 'integrity_checked', integ is not null,
    'same_system', (body->>'system_id') is null or body->>'system_id' = sid);
end $$;

create or replace function _rec_label(p_table text, r jsonb) returns text language sql immutable as $$
  select coalesce(nullif(concat_ws(' - ',
           coalesce(r->>'code', r->>'oil_no', r->>'maint_no', r->>'accident_no', r->>'form_no', r->>'op_no', r->>'request_no'),
           coalesce(r->>'plate_no', r->>'full_name', r->>'name', r->>'key', r->>'file_name', r->>'doc_type')), ''), r->>'id')
$$;

-- the restore itself (one transaction, called by restore_backup / check_backup)
create or replace function _restore_core(p_payload jsonb, p_mode text, p_label text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tabs text[] := restore_table_list();
  t text; i int; rows jsonb; m record; cols text[]; allcols text[]; idcols text[]; present text[]; pk text;
  n_total int; n_exist int; n_ins int; n_left int; n_removed int; slow boolean;
  collist text; sel text; ovr text; r jsonb; one int; extra jsonb; mx bigint; cur bigint; seqname text;
  rep jsonb := '{}'; conflicts jsonb := '[]'; failed jsonb := '[]';
  tot_ins int := 0; tot_keep int := 0; tot_left int := 0; tot_removed int := 0; tot_backup int := 0;
begin
  if p_mode not in ('merge', 'full') then raise exception 'RESTORE_MODE_INVALID'; end if;
  foreach t in array tabs loop
    if to_regclass('public.' || t) is not null then execute format('alter table public.%I disable trigger user', t); end if;
  end loop;
  if p_mode = 'full' then
    for i in reverse array_length(tabs, 1)..1 loop
      t := tabs[i];
      if to_regclass('public.' || t) is null or t = 'audit_log' then continue; end if;   -- the audit log is never deleted
      select a.attname into pk from pg_index x join pg_attribute a on a.attrelid = x.indrelid and a.attnum = any(x.indkey)
        where x.indrelid = ('public.' || t)::regclass and x.indisprimary limit 1;
      rows := coalesce(p_payload->'tables'->t, '[]'::jsonb);
      execute format('select count(*) from public.%I y where y.%I::text not in (select x->>%L from jsonb_array_elements($1) x where x ? %L)', t, pk, pk, pk)
        using rows into n_removed;
      if t = 'app_settings' then
        select count(*) into n_removed from app_settings y where y.key not in ('system_id', 'last_backup')
          and y.key not in (select x->>'key' from jsonb_array_elements(rows) x);
        delete from app_settings where key not in ('system_id', 'last_backup');
      else execute format('delete from public.%I', t); end if;
      rep := rep || jsonb_build_object(t, jsonb_build_object('removed_not_in_backup', n_removed));
      tot_removed := tot_removed + n_removed;
    end loop;
  end if;

  foreach t in array tabs loop
    if to_regclass('public.' || t) is null then continue; end if;
    rows := p_payload->'tables'->t;
    if rows is null or jsonb_typeof(rows) <> 'array' then
      rep := jsonb_set(rep, array[t], coalesce(rep->t, '{}') || '{"missing_in_backup": true}'); continue;
    end if;
    -- old field names -> new field names
    for m in select old_column, new_column from field_migrations where table_name = t loop
      select coalesce(jsonb_agg(case when x ? m.old_column and not x ? m.new_column
                                     then (x - m.old_column) || jsonb_build_object(m.new_column, x->m.old_column) else x end), '[]')
        into rows from jsonb_array_elements(rows) x;
    end loop;
    select array_agg(a.attname::text order by a.attnum), array_agg(a.attname::text) filter (where a.attidentity <> '')
      into cols, idcols
      from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
    select array_agg(a.attname::text) into allcols from pg_attribute a where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped;
    select a.attname into pk from pg_index x join pg_attribute a on a.attrelid = x.indrelid and a.attnum = any(x.indkey)
      where x.indrelid = ('public.' || t)::regclass and x.indisprimary limit 1;
    select coalesce(array_agg(distinct k), '{}') into present from jsonb_array_elements(rows) x, jsonb_object_keys(x) k where k = any(cols);
    n_total := jsonb_array_length(rows);
    tot_backup := tot_backup + n_total;
    if n_total = 0 or not (pk = any(present)) then
      rep := jsonb_set(rep, array[t], coalesce(rep->t, '{}') || jsonb_build_object('in_backup', n_total, 'restored', 0, 'kept_existing', 0));
      continue;
    end if;
    -- information without a matching field anymore: kept for review, never dropped
    insert into restore_leftovers(backup_label, table_name, record_id, data)
      select p_label, t, x->>pk, e.extra from jsonb_array_elements(rows) x
      cross join lateral (select jsonb_object_agg(j.key, j.value) as extra from jsonb_each(x) j where j.key <> all(allcols) and j.value <> 'null'::jsonb) e
      where e.extra is not null;
    get diagnostics n_left = row_count;
    execute format('select count(*) from jsonb_array_elements($1) x where exists (select 1 from public.%I y where y.%I::text = x->>%L)', t, pk, pk)
      using rows into n_exist;
    collist := (select string_agg(format('%I', c), ', ') from unnest(present) c);
    sel := (select string_agg(format('s.%I', c), ', ') from unnest(present) c);
    ovr := case when present && coalesce(idcols, '{}') then 'overriding system value' else '' end;
    slow := false;
    begin
      execute format('with s0 as (select * from jsonb_populate_recordset(null::public.%1$I, $1)), '
                     'ins as (insert into public.%1$I (%2$s) %3$s select %4$s from s0 s where not exists (select 1 from public.%1$I y where y.%5$I = s.%5$I) on conflict do nothing returning 1) '
                     'select count(*) from ins', t, collist, ovr, sel, pk) using rows into n_ins;
    exception when others then
      slow := true; n_ins := 0;
      -- row by row: tells exactly which record failed and why (the others are restored)
      for r in select x from jsonb_array_elements(rows) x loop
        execute format('select count(*) from public.%I y where y.%I::text = $1', t, pk) using r->>pk into one;
        continue when one > 0;
        begin
          execute format('insert into public.%1$I (%2$s) %3$s select %4$s from jsonb_populate_record(null::public.%1$I, $1) s', t, collist, ovr, sel) using r;
          n_ins := n_ins + 1;
        exception when unique_violation then
          conflicts := conflicts || jsonb_build_object('table', t, 'id', r->>pk, 'label', _rec_label(t, r), 'reason', 'unique', 'detail', sqlerrm);
        when others then
          failed := failed || jsonb_build_object('table', t, 'id', r->>pk, 'label', _rec_label(t, r), 'reason', sqlstate, 'detail', sqlerrm);
        end;
      end loop;
    end;
    if not slow and n_total - n_exist - n_ins > 0 then
      -- not inserted and not present: another record already uses the same unique value (plate, VIN, number...)
      execute format('select coalesce(jsonb_agg(jsonb_build_object(''table'', %L, ''id'', x->>%L, ''label'', _rec_label(%L, x), ''reason'', ''unique'')), ''[]'') '
                     'from jsonb_array_elements($1) x where not exists (select 1 from public.%I y where y.%I::text = x->>%L)', t, pk, t, t, pk, pk)
        using rows into extra;
      conflicts := conflicts || extra;
    end if;
    rep := jsonb_set(rep, array[t], coalesce(rep->t, '{}') || jsonb_build_object('in_backup', n_total, 'restored', n_ins, 'kept_existing', n_exist, 'leftovers', n_left));
    tot_ins := tot_ins + n_ins; tot_keep := tot_keep + n_exist; tot_left := tot_left + n_left;
  end loop;

  -- numbering continues after the highest restored number (never goes back)
  for seqname, t, pk in select * from (values ('employee_code_seq', 'employees', 'code'), ('vehicle_code_seq', 'vehicles', 'code'), ('oil_no_seq', 'oil_changes', 'oil_no'),
      ('maint_no_seq', 'maintenance', 'maint_no'), ('accident_no_seq', 'accidents', 'accident_no'), ('handover_no_seq', 'handovers', 'form_no'),
      ('housing_no_seq', 'housing_maintenance', 'op_no'), ('food_no_seq', 'food_supplies', 'op_no'), ('maint_request_no_seq', 'maintenance_requests', 'request_no')) v(a, b, c) loop
    if to_regclass('public.' || seqname) is null or to_regclass('public.' || t) is null then continue; end if;
    execute format('select coalesce(max(nullif(regexp_replace(%I, ''\D'', '''', ''g''), '''')::bigint), 0) from public.%I', pk, t) into mx;
    execute format('select last_value from public.%I', seqname) into cur;
    if mx > cur then perform setval('public.' || seqname, mx); end if;
  end loop;
  foreach t in array array['site_history', 'odometer_readings', 'vehicle_field_history', 'audit_log'] loop
    seqname := pg_get_serial_sequence('public.' || t, 'id');
    if seqname is null then continue; end if;
    execute format('select coalesce(max(id), 0) from public.%I', t) into mx;
    execute format('select last_value from %s', seqname) into cur;
    if mx > cur then perform setval(seqname, mx); end if;
  end loop;

  foreach t in array tabs loop
    if to_regclass('public.' || t) is not null then execute format('alter table public.%I enable trigger user', t); end if;
  end loop;
  return jsonb_build_object('mode', p_mode, 'tables', rep, 'in_backup', tot_backup, 'restored', tot_ins, 'kept_existing', tot_keep,
    'removed_not_in_backup', tot_removed, 'leftovers', tot_left,
    'conflicts_count', jsonb_array_length(conflicts), 'conflicts', (select coalesce(jsonb_agg(x), '[]') from (select x from jsonb_array_elements(conflicts) x limit 300) s),
    'failed_count', jsonb_array_length(failed), 'failed', (select coalesce(jsonb_agg(x), '[]') from (select x from jsonb_array_elements(failed) x limit 300) s),
    'accounts', 'unchanged');
end $$;

-- "check the backup": integrity + structure + a full trial run of both modes that is rolled back (nothing changes)
create or replace function check_backup(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare r system_backups%rowtype; problems jsonb := '[]'; merge_rep jsonb; full_rep jsonb; sid text;
begin
  if not is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into r from system_backups where id = p_id;
  if not found then raise exception 'BACKUP_NOT_FOUND'; end if;
  if md5(r.payload::text) <> r.checksum then
    perform _backup_log('check', r.id, r.backup_no, false, jsonb_build_object('error', 'checksum'));
    return jsonb_build_object('ok', false, 'backup_no', r.backup_no, 'problems', jsonb_build_array('checksum'));
  end if;
  if r.payload->>'format' is distinct from 'fleet-backup' or jsonb_typeof(r.payload->'tables') is distinct from 'object' then problems := problems || '["format"]'; end if;
  if r.schema_version > app_schema_version() then problems := problems || '["newer_schema"]'; end if;
  sid := (select value #>> '{}' from app_settings where key = 'system_id');
  begin
    merge_rep := _restore_core(r.payload, 'merge', r.backup_no || ' (check)');
    raise exception 'DRY_RUN_DONE';
  exception when others then
    if sqlerrm <> 'DRY_RUN_DONE' then merge_rep := jsonb_build_object('error', sqlerrm); problems := problems || '["merge_error"]'; end if;
  end;
  begin
    full_rep := _restore_core(r.payload, 'full', r.backup_no || ' (check)');
    raise exception 'DRY_RUN_DONE';
  exception when others then
    if sqlerrm <> 'DRY_RUN_DONE' then full_rep := jsonb_build_object('error', sqlerrm); problems := problems || '["full_error"]'; end if;
  end;
  perform _backup_log('check', r.id, r.backup_no, jsonb_array_length(problems) = 0, jsonb_build_object('problems', problems));
  return jsonb_build_object('ok', jsonb_array_length(problems) = 0, 'problems', problems, 'id', r.id, 'backup_no', r.backup_no, 'kind', r.kind,
    'created_at', coalesce(r.source_created_at, r.created_at), 'schema_version', r.schema_version, 'current_schema_version', app_schema_version(),
    'same_system', (r.payload->>'system_id') is null or r.payload->>'system_id' = sid, 'counts', r.counts, 'size_bytes', r.size_bytes,
    'merge', merge_rep, 'full', full_rep);
end $$;

-- the restore: integrity check, automatic backup of the current state, then everything in one transaction.
-- if anything unexpected fails, every change is undone and the current data stays as it was.
create or replace function restore_backup(p_id uuid, p_mode text, p_confirm text default null) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare r system_backups%rowtype; pre jsonb; rep jsonb;
begin
  if not is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_mode not in ('merge', 'full') then raise exception 'RESTORE_MODE_INVALID'; end if;
  if p_mode = 'full' and p_confirm is distinct from 'REPLACE' then raise exception 'RESTORE_CONFIRMATION_REQUIRED'; end if;
  select * into r from system_backups where id = p_id;
  if not found then raise exception 'BACKUP_NOT_FOUND'; end if;
  if md5(r.payload::text) <> r.checksum or r.payload->>'format' is distinct from 'fleet-backup' then
    perform _backup_log('restore_' || p_mode, r.id, r.backup_no, false, jsonb_build_object('error', 'BACKUP_CORRUPT'));
    return jsonb_build_object('ok', false, 'error', 'BACKUP_CORRUPT', 'backup_no', r.backup_no);
  end if;
  pre := _create_backup('pre_restore', 'auto before restoring ' || r.backup_no, null);
  begin
    rep := _restore_core(r.payload, p_mode, r.backup_no);
  exception when others then
    perform _backup_log('restore_' || p_mode, r.id, r.backup_no, false, jsonb_build_object('error', sqlerrm, 'pre_restore', pre->>'backup_no'));
    return jsonb_build_object('ok', false, 'error', sqlerrm, 'backup_no', r.backup_no, 'pre_restore', pre);
  end;
  perform _backup_log('restore_' || p_mode, r.id, r.backup_no, true, jsonb_build_object('restored', rep->'restored', 'kept', rep->'kept_existing',
    'conflicts', rep->'conflicts_count', 'failed', rep->'failed_count', 'pre_restore', pre->>'backup_no'));
  return rep || jsonb_build_object('ok', true, 'backup_no', r.backup_no, 'pre_restore', pre);
end $$;

-- leftovers reviewed
create or replace function mark_leftovers_reviewed(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  update restore_leftovers set reviewed = true where id = any(p_ids);
  get diagnostics n = row_count; return n;
end $$;

-- permissions: the public functions are for signed-in users (they check admin themselves); internals are not callable
do $$
declare f text;
begin
  foreach f in array array['app_schema_version()', 'backup_table_list()', 'restore_table_list()', '_backup_log(text, uuid, text, boolean, jsonb)',
      '_backup_snapshot()', '_create_backup(text, text, text)', '_rec_label(text, jsonb)', '_restore_core(jsonb, text, text)',
      'create_backup(text, text, text)', 'backup_download(uuid)', 'import_backup(text, text)', 'check_backup(uuid)',
      'restore_backup(uuid, text, text)', 'mark_leftovers_reviewed(bigint[])'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
  end loop;
  foreach f in array array['_backup_log(text, uuid, text, boolean, jsonb)', '_backup_snapshot()', '_create_backup(text, text, text)', '_restore_core(jsonb, text, text)'] loop
    execute format('revoke execute on function public.%s from authenticated', f);
  end loop;
  foreach f in array array['create_backup(text, text, text)', 'backup_download(uuid)', 'import_backup(text, text)', 'check_backup(uuid)',
      'restore_backup(uuid, text, text)', 'mark_leftovers_reviewed(bigint[])', 'app_schema_version()'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

select 'DATA_PROTECTION_OK' as result;
