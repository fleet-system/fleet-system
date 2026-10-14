-- =====================================================================
-- 0018: renewal plan for the vehicle and its delegate (5 ordered steps).
--  * delegates: one record per delegate (name, driving licence expiry), linked to any number of vehicles
--    through vehicles.delegate_id. Licence number and mobile are in delegate_private (view_sensitive only).
--  * renewal_plans / renewal_steps: one active plan per vehicle, 5 steps in this order:
--      1 delegate driving licence, 2 periodic inspection, 3 insurance, 4 fines and fees, 5 registration.
--    A step is complete only when a user confirms it (save_renewal_step with p_confirm = true),
--    and only after the steps before it are complete.
--  * Two-way sync: confirming a step writes the new date to the existing records (delegates.license_expiry,
--    documents for inspection / registration, vehicles.insurance_expiry); updating those records from the
--    vehicle card or the delegate file marks the matching step of an active plan as complete (source 'card').
--    The delegate name is copied to vehicles.authorized_name (the existing field).
--  * The delegate licence appears in v_document_status as 'delegate_license' (alerts, bell, documents page).
--  * delegate_duplicates(): possible duplicate delegates (same name / licence number / mobile), merge_delegates().
--  * New tables are added to the backup list.
-- Adds tables, one nullable column, functions and views. No existing data is changed or deleted.
-- ASCII only. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- delegates
-- ---------------------------------------------------------------------
create sequence if not exists delegate_code_seq;
create table if not exists delegates (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default ('DLG-' || lpad(nextval('delegate_code_seq')::text, 4, '0')),
  full_name       text not null,
  license_expiry  date,
  notes           text,
  merged_into     uuid references delegates(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  archive_reason  text,
  constraint delegates_name_check check (btrim(full_name) <> '')
);
create table if not exists delegate_private (
  delegate_id  uuid primary key references delegates(id),
  license_no   text,
  mobile       text,
  updated_at   timestamptz not null default now(),
  constraint delegate_private_license_digits check (license_no is null or license_no ~ '^[0-9]{5,15}$'),
  constraint delegate_private_mobile_format check (mobile is null or mobile ~ '^\+9665[0-9]{8}$')
);
alter table vehicles add column if not exists delegate_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_delegate_id_fkey') then
    alter table vehicles add constraint vehicles_delegate_id_fkey foreign key (delegate_id) references delegates(id);
  end if;
end $$;
create index if not exists vehicles_delegate_idx on vehicles(delegate_id);

-- ---------------------------------------------------------------------
-- renewal plans and steps
-- ---------------------------------------------------------------------
create sequence if not exists renewal_plan_no_seq;
create table if not exists renewal_plans (
  id              uuid primary key default gen_random_uuid(),
  plan_no         text not null unique default ('RNP-' || lpad(nextval('renewal_plan_no_seq')::text, 6, '0')),
  vehicle_id      uuid not null references vehicles(id),
  status          text not null default 'active',
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid,
  archive_reason  text,
  constraint renewal_plans_status_check check (status in ('active', 'completed'))
);
create unique index if not exists renewal_plans_one_active on renewal_plans(vehicle_id) where status = 'active' and deleted_at is null;

create table if not exists renewal_steps (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references renewal_plans(id),
  step_no       int not null,
  step_key      text not null,
  status        text not null default 'pending',
  result        text,
  fines_status  text,
  new_expiry    date,
  notes         text,
  source        text,
  entered_by    uuid,
  entered_at    timestamptz,
  confirmed_by  uuid,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint renewal_steps_no_check check (step_no between 1 and 5),
  constraint renewal_steps_key_check check (step_key in ('delegate_license', 'inspection', 'insurance', 'fines', 'registration')),
  constraint renewal_steps_status_check check (status in ('pending', 'entered', 'done')),
  constraint renewal_steps_result_check check (result is null or result in ('passed', 'failed')),
  constraint renewal_steps_fines_check check (fines_status is null or fines_status in ('none', 'paid')),
  constraint renewal_steps_source_check check (source is null or source in ('plan', 'card', 'delegate')),
  constraint renewal_steps_unique unique (plan_id, step_no)
);

-- the five steps, in order
create or replace function renewal_step_key(p_no int) returns text
language sql immutable as $$
  select (array['delegate_license', 'inspection', 'insurance', 'fines', 'registration'])[p_no]
$$;

-- ---------------------------------------------------------------------
-- triggers: updated_at, no hard delete, audit
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['delegates', 'delegate_private', 'renewal_plans', 'renewal_steps'] loop
    execute format('drop trigger if exists set_updated_at on %I', t);
    execute format('create trigger set_updated_at before update on %I for each row execute function trg_set_updated_at()', t);
    execute format('drop trigger if exists block_delete on %I', t);
    execute format('create trigger block_delete before delete on %I for each row execute function trg_block_delete()', t);
  end loop;
  foreach t in array array['delegates', 'renewal_plans', 'renewal_steps'] loop
    execute format('drop trigger if exists audit on %I', t);
    execute format('create trigger audit after insert or update or delete on %I for each row execute function trg_audit()', t);
  end loop;
end $$;

-- audit for the private delegate data without storing the numbers
create or replace function trg_audit_delegate_private() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(table_name, record_id, action, changed_by, old_data, new_data, changes)
  values ('delegate_private', coalesce(new.delegate_id, old.delegate_id)::text, tg_op, auth.uid(), null, null,
          '{"licence_or_mobile": "(sensitive value changed)"}'::jsonb);
  return coalesce(new, old);
end $$;
revoke execute on function trg_audit_delegate_private() from public, anon, authenticated;
drop trigger if exists audit on delegate_private;
create trigger audit after insert or update on delegate_private for each row execute function trg_audit_delegate_private();

-- ---------------------------------------------------------------------
-- name matching (Arabic letter forms, spaces, diacritics)
-- ---------------------------------------------------------------------
create or replace function norm_person_name(p text) returns text
language sql immutable set search_path = public as $$
  select btrim(regexp_replace(
           translate(regexp_replace(lower(coalesce(p, '')), U&'[\064B-\0652\0640]', '', 'g'),
                     U&'\0623\0625\0622\0671\0649\0629', U&'\0627\0627\0627\0627\064A\0647'),
           '\s+', ' ', 'g'))
$$;
create index if not exists delegates_norm_name_idx on delegates(norm_person_name(full_name)) where deleted_at is null;

-- ---------------------------------------------------------------------
-- sync: delegate name -> vehicles.authorized_name (existing field)
-- ---------------------------------------------------------------------
create or replace function trg_vehicle_delegate_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.delegate_id is not null and (tg_op = 'INSERT' or new.delegate_id is distinct from old.delegate_id) then
    select full_name into new.authorized_name from delegates where id = new.delegate_id;
  end if;
  return new;
end $$;
revoke execute on function trg_vehicle_delegate_name() from public, anon, authenticated;
drop trigger if exists delegate_name on vehicles;
create trigger delegate_name before insert or update of delegate_id on vehicles for each row execute function trg_vehicle_delegate_name();

-- ---------------------------------------------------------------------
-- sync: records updated elsewhere -> the matching step of an active plan is complete
-- ---------------------------------------------------------------------
create or replace function _renewal_mark_done(p_vehicle uuid, p_step int, p_expiry date, p_source text) returns void
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if p_vehicle is null or p_expiry is null or p_expiry < app_today() then return; end if;
  select id into pid from renewal_plans where vehicle_id = p_vehicle and status = 'active' and deleted_at is null;
  if pid is null then return; end if;
  update renewal_steps set status = 'done', new_expiry = p_expiry, source = p_source,
         result = case when p_step = 2 then coalesce(result, 'passed') else result end,
         confirmed_by = auth.uid(), confirmed_at = now()
   where plan_id = pid and step_no = p_step and status <> 'done';
  perform _renewal_check_complete(pid);
end $$;

create or replace function _renewal_check_complete(p_plan uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from renewal_steps where plan_id = p_plan and status <> 'done')
     and exists (select 1 from renewal_steps where plan_id = p_plan) then
    update renewal_plans set status = 'completed', completed_at = coalesce(completed_at, now())
     where id = p_plan and status = 'active';
  end if;
end $$;

create or replace function trg_renewal_sync_documents() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.vehicle_id is not null and new.deleted_at is null and new.doc_type in ('periodic_inspection', 'registration')
     and (tg_op = 'INSERT' or new.expiry_date is distinct from old.expiry_date) then
    perform _renewal_mark_done(new.vehicle_id, case when new.doc_type = 'periodic_inspection' then 2 else 5 end, new.expiry_date, 'card');
  end if;
  return new;
end $$;
drop trigger if exists renewal_sync on documents;
create trigger renewal_sync after insert or update on documents for each row execute function trg_renewal_sync_documents();

create or replace function trg_renewal_sync_insurance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null and new.insurance_expiry is distinct from old.insurance_expiry then
    perform _renewal_mark_done(new.id, 3, new.insurance_expiry, 'card');
  end if;
  return new;
end $$;
drop trigger if exists renewal_sync on vehicles;
create trigger renewal_sync after update of insurance_expiry on vehicles for each row execute function trg_renewal_sync_insurance();

create or replace function trg_renewal_sync_delegate() returns trigger
language plpgsql security definer set search_path = public as $$
declare vid uuid;
begin
  if new.full_name is distinct from old.full_name then
    update vehicles set authorized_name = new.full_name where delegate_id = new.id and authorized_name is distinct from new.full_name;
  end if;
  if new.license_expiry is distinct from old.license_expiry and new.deleted_at is null then
    for vid in select id from vehicles where delegate_id = new.id and deleted_at is null loop
      perform _renewal_mark_done(vid, 1, new.license_expiry, 'delegate');
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists renewal_sync on delegates;
create trigger renewal_sync after update on delegates for each row execute function trg_renewal_sync_delegate();

revoke execute on function _renewal_mark_done(uuid, int, date, text) from public, anon, authenticated;
revoke execute on function _renewal_check_complete(uuid) from public, anon, authenticated;
revoke execute on function trg_renewal_sync_documents() from public, anon, authenticated;
revoke execute on function trg_renewal_sync_insurance() from public, anon, authenticated;
revoke execute on function trg_renewal_sync_delegate() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- functions called by the site
-- ---------------------------------------------------------------------
-- find a delegate by name (same person written slightly differently counts as the same), or add one
create or replace function ensure_delegate(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); did uuid;
begin
  if n = '' then return null; end if;
  if not (has_perm('create') or has_perm('edit')) then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select id into did from delegates where deleted_at is null and norm_person_name(full_name) = norm_person_name(n)
   order by created_at limit 1;
  if did is null then
    insert into delegates(full_name) values (n) returning id into did;
  end if;
  return did;
end $$;

-- a new plan for one vehicle (only one active plan per vehicle)
create or replace function create_renewal_plan(p_vehicle uuid, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; i int;
begin
  if not has_perm('create') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if not exists (select 1 from vehicles where id = p_vehicle and deleted_at is null) then raise exception 'RENEWAL_VEHICLE_NOT_FOUND'; end if;
  if exists (select 1 from renewal_plans where vehicle_id = p_vehicle and status = 'active' and deleted_at is null) then
    raise exception 'RENEWAL_PLAN_EXISTS';
  end if;
  insert into renewal_plans(vehicle_id, notes, created_by) values (p_vehicle, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()) returning id into pid;
  for i in 1..5 loop
    insert into renewal_steps(plan_id, step_no, step_key) values (pid, i, renewal_step_key(i));
  end loop;
  return pid;
end $$;

-- save a step (p_confirm = false: saved, waiting for confirmation; true: complete)
-- p_data: {"new_expiry": "YYYY-MM-DD", "result": "passed|failed", "fines_status": "none|paid", "notes": "..."}
create or replace function save_renewal_step(p_plan uuid, p_step int, p_data jsonb, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pl renewal_plans; st renewal_steps; v vehicles; dl delegates;
  d_exp date; d_res text; d_fines text; d_notes text; cur_exp date;
begin
  if not (has_perm('edit') or has_perm('create')) then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_confirm and not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into pl from renewal_plans where id = p_plan and deleted_at is null;
  if pl.id is null then raise exception 'RENEWAL_PLAN_NOT_FOUND'; end if;
  if pl.status <> 'active' then raise exception 'RENEWAL_PLAN_CLOSED'; end if;
  select * into st from renewal_steps where plan_id = p_plan and step_no = p_step for update;
  if st.id is null then raise exception 'RENEWAL_STEP_NOT_FOUND'; end if;
  if st.status = 'done' then raise exception 'RENEWAL_STEP_DONE'; end if;
  if exists (select 1 from renewal_steps where plan_id = p_plan and step_no < p_step and status <> 'done') then
    raise exception 'RENEWAL_STEP_ORDER';
  end if;
  select * into v from vehicles where id = pl.vehicle_id;
  d_exp := nullif(p_data->>'new_expiry', '')::date;
  d_res := nullif(p_data->>'result', '');
  d_fines := nullif(p_data->>'fines_status', '');
  d_notes := nullif(btrim(coalesce(p_data->>'notes', '')), '');

  if p_step = 1 then
    if v.delegate_id is null then raise exception 'RENEWAL_NO_DELEGATE'; end if;
    select * into dl from delegates where id = v.delegate_id;
    cur_exp := dl.license_expiry;
  elsif p_step = 2 then
    select max(expiry_date) into cur_exp from documents where vehicle_id = v.id and doc_type = 'periodic_inspection' and deleted_at is null;
  elsif p_step = 3 then
    cur_exp := v.insurance_expiry;
  elsif p_step = 5 then
    select max(expiry_date) into cur_exp from documents where vehicle_id = v.id and doc_type = 'registration' and deleted_at is null;
  end if;

  update renewal_steps set
    new_expiry = coalesce(d_exp, new_expiry),
    result = coalesce(d_res, result),
    fines_status = coalesce(d_fines, fines_status),
    notes = coalesce(d_notes, notes),
    status = 'entered', entered_by = auth.uid(), entered_at = now()
  where id = st.id returning * into st;

  if p_confirm then
    if p_step = 2 and coalesce(st.result, '') <> 'passed' then raise exception 'RENEWAL_INSPECTION_NOT_PASSED'; end if;
    if p_step = 4 and st.fines_status is null then raise exception 'RENEWAL_FINES_REQUIRED'; end if;
    if p_step <> 4 then
      if st.new_expiry is null and cur_exp is not null and cur_exp >= app_today() then
        update renewal_steps set new_expiry = cur_exp where id = st.id returning * into st;
      end if;
      if st.new_expiry is null then raise exception 'RENEWAL_DATE_REQUIRED'; end if;
      if st.new_expiry < app_today() then raise exception 'RENEWAL_DATE_PAST'; end if;
    end if;
    update renewal_steps set status = 'done', source = 'plan', confirmed_by = auth.uid(), confirmed_at = now()
     where id = st.id returning * into st;
    -- write the new date to the existing records (the vehicle card and alerts read them)
    if p_step = 1 and st.new_expiry is distinct from cur_exp then
      update delegates set license_expiry = st.new_expiry where id = v.delegate_id;
    elsif p_step = 2 and st.new_expiry is distinct from cur_exp then
      insert into documents(doc_type, vehicle_id, expiry_date, notes) values ('periodic_inspection', v.id, st.new_expiry, 'renewal plan ' || pl.plan_no);
    elsif p_step = 3 and st.new_expiry is distinct from cur_exp then
      update vehicles set insurance_expiry = st.new_expiry, change_note = 'renewal plan ' || pl.plan_no where id = v.id;
    elsif p_step = 5 and st.new_expiry is distinct from cur_exp then
      insert into documents(doc_type, vehicle_id, expiry_date, notes) values ('registration', v.id, st.new_expiry, 'renewal plan ' || pl.plan_no);
    end if;
    perform _renewal_check_complete(p_plan);
  end if;
  return to_jsonb(st);
end $$;

-- delete = archive (kept with who / when / why)
create or replace function archive_renewal_plan(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  update renewal_plans set deleted_at = now(), deleted_by = auth.uid(), archive_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id and deleted_at is null;
  if not found then raise exception 'RENEWAL_PLAN_NOT_FOUND'; end if;
end $$;

-- possible duplicate delegates: same name (letter forms ignored), same licence number or same mobile.
-- Returns a list of {delegate_id, other_id, reason} only (never the numbers themselves).
create or replace function delegate_duplicates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not has_perm('view') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  with d as (select id, norm_person_name(full_name) as n from delegates where deleted_at is null),
       p as (select dp.delegate_id as id, regexp_replace(coalesce(dp.license_no, ''), '\D', '', 'g') as lic, coalesce(dp.mobile, '') as mob
               from delegate_private dp join delegates x on x.id = dp.delegate_id and x.deleted_at is null),
       pairs as (
         select a.id as delegate_id, b.id as other_id, 'name' as reason from d a join d b on a.n = b.n and a.id <> b.id and a.n <> ''
         union
         select a.id, b.id, 'license' from p a join p b on a.lic = b.lic and a.id <> b.id and a.lic <> ''
         union
         select a.id, b.id, 'mobile' from p a join p b on a.mob = b.mob and a.id <> b.id and a.mob <> '')
  select coalesce(jsonb_agg(to_jsonb(pairs)), '[]'::jsonb) into r from pairs;
  return r;
end $$;

-- merge a duplicate into the delegate that is kept: vehicles move, the duplicate is archived (not deleted)
create or replace function merge_delegates(p_keep uuid, p_dup uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare k delegates; d delegates;
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into k from delegates where id = p_keep and deleted_at is null;
  select * into d from delegates where id = p_dup and deleted_at is null;
  if k.id is null or d.id is null or k.id = d.id then raise exception 'DELEGATE_MERGE_INVALID'; end if;
  update vehicles set delegate_id = k.id where delegate_id = d.id;
  if k.license_expiry is null or (d.license_expiry is not null and d.license_expiry > k.license_expiry) then
    update delegates set license_expiry = d.license_expiry where id = k.id and d.license_expiry is not null;
  end if;
  if exists (select 1 from delegate_private where delegate_id = d.id) then
    insert into delegate_private(delegate_id) values (k.id) on conflict (delegate_id) do nothing;
    update delegate_private kp set
      license_no = coalesce(kp.license_no, dp.license_no), mobile = coalesce(kp.mobile, dp.mobile)
    from delegate_private dp where kp.delegate_id = k.id and dp.delegate_id = d.id;
  end if;
  update delegates set deleted_at = now(), merged_into = k.id, archive_reason = 'merged into ' || k.code where id = d.id;
  return k.id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['ensure_delegate(text)', 'create_renewal_plan(uuid, text)', 'save_renewal_step(uuid, int, jsonb, boolean)',
      'archive_renewal_plan(uuid, text)', 'delegate_duplicates()', 'merge_delegates(uuid, uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['renewal_step_key(int)', 'norm_person_name(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- security: read with "view"; delegates edited with create / edit; numbers with view_sensitive;
-- plans and steps change only through the functions above
-- ---------------------------------------------------------------------
alter table delegates enable row level security;
alter table delegate_private enable row level security;
alter table renewal_plans enable row level security;
alter table renewal_steps enable row level security;
drop policy if exists p_select on delegates;
drop policy if exists p_insert on delegates;
drop policy if exists p_update on delegates;
create policy p_select on delegates for select to authenticated using (has_perm('view'));
create policy p_insert on delegates for insert to authenticated with check (has_perm('create'));
create policy p_update on delegates for update to authenticated using (has_perm('edit')) with check (has_perm('edit'));
drop policy if exists p_select on delegate_private;
drop policy if exists p_insert on delegate_private;
drop policy if exists p_update on delegate_private;
create policy p_select on delegate_private for select to authenticated using (has_perm('view_sensitive'));
create policy p_insert on delegate_private for insert to authenticated with check ((has_perm('create') or has_perm('edit')) and has_perm('view_sensitive'));
create policy p_update on delegate_private for update to authenticated using (has_perm('edit') and has_perm('view_sensitive')) with check (has_perm('edit') and has_perm('view_sensitive'));
drop policy if exists p_select on renewal_plans;
create policy p_select on renewal_plans for select to authenticated using (has_perm('view'));
drop policy if exists p_select on renewal_steps;
create policy p_select on renewal_steps for select to authenticated using (has_perm('view'));

revoke all on delegates, delegate_private, renewal_plans, renewal_steps from anon;
revoke all on delegates, delegate_private, renewal_plans, renewal_steps from authenticated;
grant select, insert, update on delegates, delegate_private to authenticated;
grant select on renewal_plans, renewal_steps to authenticated;
revoke all on sequence delegate_code_seq, renewal_plan_no_seq from anon;
grant usage on sequence delegate_code_seq to authenticated;

-- ---------------------------------------------------------------------
-- plans with their vehicle and progress (lists, dashboard, search)
-- ---------------------------------------------------------------------
create or replace view v_renewal_plans with (security_invoker = true) as
select
  p.id, p.plan_no, p.vehicle_id, p.status, p.notes, p.created_at, p.completed_at, p.created_by,
  user_display_name(p.created_by) as created_by_name,
  v.code, v.plate_no, v.op_status, v.location_status, v.op_state, v.op_state_text, v.site_id,
  v.delegate_id, dl.full_name as delegate_name, dl.license_expiry as delegate_license_expiry,
  (select count(*) from renewal_steps s where s.plan_id = p.id and s.status = 'done')::int as done_count,
  (select min(s.step_no) from renewal_steps s where s.plan_id = p.id and s.status <> 'done') as next_step,
  (select s.status from renewal_steps s where s.plan_id = p.id and s.status <> 'done' order by s.step_no limit 1) as next_status
from renewal_plans p
join vehicles v on v.id = p.vehicle_id
left join delegates dl on dl.id = v.delegate_id
where p.deleted_at is null and v.deleted_at is null;
revoke all on v_renewal_plans from anon;
revoke insert, update, delete, truncate, references, trigger on v_renewal_plans from authenticated;
grant select on v_renewal_plans to authenticated;

-- steps with the names of who entered / confirmed them
create or replace view v_renewal_steps with (security_invoker = true) as
select s.*, user_display_name(s.entered_by) as entered_by_name, user_display_name(s.confirmed_by) as confirmed_by_name
from renewal_steps s;
revoke all on v_renewal_steps from anon;
revoke insert, update, delete, truncate, references, trigger on v_renewal_steps from authenticated;
grant select on v_renewal_steps to authenticated;

-- delegates with the number of vehicles linked to them
create or replace view v_delegates with (security_invoker = true) as
select dl.id, dl.code, dl.full_name, dl.license_expiry, dl.notes, dl.created_at, dl.updated_at,
  (select count(*) from vehicles v where v.delegate_id = dl.id and v.deleted_at is null)::int as vehicle_count,
  case when dl.license_expiry is null then 'no_date'
       when dl.license_expiry < app_today() then 'expired'
       when dl.license_expiry - app_today() <= (doc_alert_days())[1] then 'expiring'
       else 'valid' end as license_status,
  dl.license_expiry - app_today() as license_days_left
from delegates dl
where dl.deleted_at is null;
revoke all on v_delegates from anon;
revoke insert, update, delete, truncate, references, trigger on v_delegates from authenticated;
grant select on v_delegates to authenticated;

-- ---------------------------------------------------------------------
-- alerts: the delegate driving licence of each vehicle (same alert periods as driving licences)
-- ---------------------------------------------------------------------
create or replace view v_document_status with (security_invoker = true) as
with req as (
  -- documents every vehicle needs
  select 'vehicle'::text as owner_type, v.id as owner_id, t.dt::text as doc_type,
         v.code || U&' \2014 ' || v.plate_no as subject_label, v.site_id, s.company_id, v.owner_company_id
  from vehicles v
  left join sites s on s.id = v.site_id
  cross join (values ('registration'), ('periodic_inspection')) t(dt)
  where v.deleted_at is null
  union all
  -- iqama for every active employee; licence for current drivers or anyone with a recorded licence
  select 'employee', e.id, t.dt, e.full_name || ' (' || e.code || ')', e.site_id, e.company_id, null
  from employees e
  cross join (values ('iqama'), ('driving_license')) t(dt)
  where e.deleted_at is null and e.status <> 'terminated'
    and (t.dt = 'iqama'
         or exists (select 1 from vehicles v where v.current_driver_id = e.id and v.deleted_at is null)
         or exists (select 1 from documents d where d.employee_id = e.id and d.doc_type = 'driving_license' and d.deleted_at is null))
),
docs as (
  select r.*, d.id as record_id, d.doc_no, d.issue_date, d.expiry_date, null::boolean as is_authorized
  from req r
  left join lateral (
    select * from documents d
    where d.doc_type::text = r.doc_type and d.deleted_at is null
      and ((r.owner_type = 'vehicle' and d.vehicle_id = r.owner_id) or (r.owner_type = 'employee' and d.employee_id = r.owner_id))
    order by d.expiry_date desc nulls last, d.created_at desc limit 1
  ) d on true
  union all
  -- authorization of the current driver
  select 'vehicle', v.id, 'authorization', v.code || U&' \2014 ' || v.plate_no, v.site_id, s.company_id, v.owner_company_id,
         va.authorization_id, va.auth_no, va.issue_date, va.expiry_date, va.is_authorized
  from vehicles v
  join v_vehicle_authorization va on va.vehicle_id = v.id
  left join sites s on s.id = v.site_id
  where v.deleted_at is null and v.current_driver_id is not null
  union all
  -- vehicle insurance (when a date was entered)
  select 'vehicle', v.id, 'insurance', v.code || U&' \2014 ' || v.plate_no, v.site_id, s.company_id, v.owner_company_id,
         v.id, null::text, null::date, v.insurance_expiry, null::boolean
  from vehicles v
  left join sites s on s.id = v.site_id
  where v.deleted_at is null and v.insurance_expiry is not null
  union all
  -- vehicle authorization from the vehicle card (only when the card says authorized; not authorized is not an alert)
  select 'vehicle', v.id, 'vehicle_authorization', v.code || U&' \2014 ' || v.plate_no, v.site_id, s.company_id, v.owner_company_id,
         v.id, null::text, null::date, v.card_auth_expiry, true
  from vehicles v
  left join sites s on s.id = v.site_id
  where v.deleted_at is null and v.card_auth_status = 'authorized'
  union all
  -- driving licence of the vehicle delegate (renewal plan): one row per vehicle that has a delegate
  select 'vehicle', v.id, 'delegate_license', v.code || U&' \2014 ' || v.plate_no, v.site_id, s.company_id, v.owner_company_id,
         dl.id, null::text, null::date, dl.license_expiry, null::boolean
  from vehicles v
  join delegates dl on dl.id = v.delegate_id and dl.deleted_at is null
  left join sites s on s.id = v.site_id
  where v.deleted_at is null
)
select
  owner_type, owner_id, doc_type, subject_label, site_id, company_id, owner_company_id,
  record_id, doc_no, issue_date, expiry_date,
  expiry_date - app_today() as days_left,
  case
    when record_id is null                          then 'missing'
    when is_authorized = false                      then 'not_authorized'
    when expiry_date is null                        then 'no_date'
    when expiry_date < app_today()                  then 'expired'
    when expiry_date - app_today() <= (case when doc_type = 'insurance' then 30 when doc_type = 'vehicle_authorization' then vehicle_auth_alert_days() else (doc_alert_days())[1] end) then 'expiring'
    else 'valid'
  end as status,
  -- alert level: the smallest period that includes the days left (insurance: 30 / 15 / 7 / 1)
  (select min(x) from unnest(case when doc_type = 'insurance' then array[30, 15, 7, 1]
                                    when doc_type = 'vehicle_authorization' then array[vehicle_auth_alert_days(), 7, 1] else doc_alert_days() end) x
    where expiry_date is not null and expiry_date >= app_today() and expiry_date - app_today() <= x) as alert_level
from docs;



revoke all on v_document_status from anon;
revoke insert, update, delete, truncate, references, trigger on v_document_status from authenticated;
grant select on v_document_status to authenticated;

-- ---------------------------------------------------------------------
-- backups include the new tables (delegates before vehicles, plans after)
-- ---------------------------------------------------------------------
create or replace function backup_table_list() returns text[] language sql immutable as $$
  select array['companies', 'sites', 'site_history', 'app_settings', 'profiles', 'user_permissions', 'employees', 'employee_private',
               'delegates', 'delegate_private',
               'vehicles', 'vehicle_private', 'odometer_readings', 'vehicle_field_history', 'authorizations', 'documents',
               'oil_changes', 'maintenance', 'maintenance_items', 'maintenance_requests', 'accidents', 'handovers',
               'vehicle_assignments', 'housing_maintenance', 'food_supplies', 'attachments', 'import_batches',
               'renewal_plans', 'renewal_steps', 'audit_log']
$$;
revoke execute on function backup_table_list() from public, anon;

select 'RENEWAL_PLANS_OK' as result;
