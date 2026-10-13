-- Run once in Supabase SQL Editor. Contains 0007 + 0008 + 0009 (all safe to run again).
-- =====================================================================
-- 0007: Maintenance requests (replaces the "periodic maintenance" screen in the app;
-- the existing maintenance table and all its records stay untouched).
-- ASCII only so it can be pasted safely from a phone. Safe to run once on an existing project.
-- =====================================================================

-- New permission: approve or reject maintenance requests (used only inside function bodies below).
alter type app_permission add value if not exists 'approve_maintenance';

create sequence if not exists maint_request_no_seq;

-- Permission check by name (text), so this script can use the permission added above in the same run.
create or replace function has_perm_text(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles pr
    where pr.user_id = auth.uid() and pr.is_active
      and (pr.is_admin or exists (select 1 from user_permissions up
                                  where up.user_id = pr.user_id and up.permission::text = p))
  )
$$;
revoke execute on function has_perm_text(text) from public, anon;
grant execute on function has_perm_text(text) to authenticated;

create table if not exists maintenance_requests (
  id                  uuid primary key default gen_random_uuid(),
  request_no          text not null unique default ('MR-' || lpad(nextval('maint_request_no_seq')::text, 6, '0')),
  request_date        date not null default app_today(),
  site_id             uuid references sites(id),            -- project / site linked to the vehicle
  company_id          uuid references companies(id),
  project_text        text,                                 -- free text next to the project
  vehicle_id          uuid references vehicles(id),         -- link to the vehicle file
  equipment_text      text,                                 -- equipment not registered as a vehicle
  plate_no            text,                                 -- copied from the vehicle file or typed
  model               text,                                 -- copied from the vehicle file or typed
  driver_id           uuid references employees(id),
  driver_name         text,
  meter_reading       int check (meter_reading >= 0),
  meter_unit          text not null default 'km' check (meter_unit in ('km', 'hours')),
  fault               text not null check (btrim(fault) <> ''),
  fault_cause         text,
  technician_opinion  text,
  site_notes          text,
  last_change_date    date,
  status              text not null default 'new'
                      check (status in ('new', 'pending_supervisor', 'approved', 'in_progress', 'completed', 'rejected')),
  supervisor_name     text,
  approver_name       text,
  approval_notes      text,
  decided_at          timestamptz,
  decided_by          uuid,
  started_at          timestamptz,
  completed_at        timestamptz,
  maintenance_id      uuid references maintenance(id),      -- optional link to the cost / invoice record
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  deleted_at          timestamptz,
  constraint mr_subject check (vehicle_id is not null or coalesce(btrim(equipment_text), '') <> '' or coalesce(btrim(plate_no), '') <> '')
);
create index if not exists maintenance_requests_vehicle_idx on maintenance_requests(vehicle_id, request_date desc);
create index if not exists maintenance_requests_status_idx on maintenance_requests(status) where deleted_at is null;

-- Fill from the vehicle file, enforce the status flow, lock approved requests.
create or replace function trg_mr_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v vehicles%rowtype;
  locked_keys text[];
  o jsonb; n jsonb; k text;
begin
  if new.vehicle_id is not null and (tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id) then
    select * into v from vehicles where id = new.vehicle_id;
    if not found then raise exception 'VEHICLE_NOT_FOUND'; end if;
    new.plate_no      := coalesce(nullif(btrim(new.plate_no), ''), v.plate_no);
    new.model         := coalesce(nullif(btrim(new.model), ''), nullif(btrim(concat_ws(' ', v.make, v.model, v.manufacture_year::text)), ''));
    new.site_id       := coalesce(new.site_id, v.site_id);
    new.driver_id     := coalesce(new.driver_id, v.current_driver_id);
    if new.meter_reading is null and new.meter_unit = 'km' and v.odometer > 0 then new.meter_reading := v.odometer; end if;
  end if;
  if new.driver_id is not null and coalesce(btrim(new.driver_name), '') = '' then
    select full_name into new.driver_name from employees where id = new.driver_id;
  end if;
  if new.site_id is not null and (new.company_id is null or (tg_op = 'UPDATE' and new.site_id is distinct from old.site_id)) then
    select company_id into new.company_id from sites where id = new.site_id;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('new', 'pending_supervisor') then
      raise exception 'MR_BAD_STATUS: a new request starts as new or pending_supervisor';
    end if;
    new.decided_at := null; new.decided_by := null; new.started_at := null; new.completed_at := null;
    return new;
  end if;

  -- status flow
  if new.status is distinct from old.status then
    if not (
      (old.status = 'new'                and new.status in ('pending_supervisor', 'approved', 'rejected')) or
      (old.status = 'pending_supervisor' and new.status in ('new', 'approved', 'rejected')) or
      (old.status = 'approved'           and new.status in ('in_progress', 'completed')) or
      (old.status = 'in_progress'        and new.status = 'completed')
    ) then
      raise exception 'MR_BAD_TRANSITION: % -> %', old.status, new.status;
    end if;
    if new.status in ('approved', 'rejected') then
      if not has_perm_text('approve_maintenance') then
        raise exception 'MR_APPROVE_DENIED: approving maintenance requests needs the approve_maintenance permission' using errcode = '42501';
      end if;
      if coalesce(btrim(new.approver_name), '') = '' then
        raise exception 'MR_APPROVER_REQUIRED: approver name is required';
      end if;
      if new.status = 'rejected' and coalesce(btrim(new.approval_notes), '') = '' then
        raise exception 'MR_REASON_REQUIRED: a rejection reason is required';
      end if;
      new.decided_at := now(); new.decided_by := auth.uid();
    end if;
    if new.status = 'in_progress' then new.started_at := coalesce(new.started_at, now()); end if;
    if new.status = 'completed' then
      new.started_at := coalesce(new.started_at, now()); new.completed_at := now();
    end if;
  end if;

  -- after approval the request content is locked (like a signed paper form)
  if old.status in ('approved', 'in_progress', 'completed', 'rejected') then
    locked_keys := array['request_date','site_id','company_id','project_text','vehicle_id','equipment_text','plate_no','model',
                         'driver_id','driver_name','meter_reading','meter_unit','fault','fault_cause','site_notes',
                         'supervisor_name','approver_name','approval_notes','request_no'];
    if old.status in ('completed', 'rejected') then
      locked_keys := locked_keys || array['technician_opinion','last_change_date'];
    end if;
    o := to_jsonb(old); n := to_jsonb(new);
    foreach k in array locked_keys loop
      if (o -> k) is distinct from (n -> k) then
        raise exception 'MR_LOCKED: request % is % and its % cannot be changed; create a new request', old.request_no, old.status, k;
      end if;
    end loop;
  end if;
  if new.decided_at is distinct from old.decided_at and new.status = old.status then
    new.decided_at := old.decided_at; new.decided_by := old.decided_by;
  end if;
  return new;
end $$;

-- A km reading on a request raises the vehicle odometer (never lowers it).
create or replace function trg_mr_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null and new.vehicle_id is not null and new.meter_unit = 'km' and new.meter_reading is not null then
    perform bump_odometer(new.vehicle_id, new.meter_reading, 'maintenance');
  end if;
  return new;
end $$;

drop trigger if exists mr_before on maintenance_requests;
drop trigger if exists mr_after on maintenance_requests;
drop trigger if exists set_updated_at on maintenance_requests;
drop trigger if exists block_delete on maintenance_requests;
drop trigger if exists audit on maintenance_requests;
create trigger mr_before before insert or update on maintenance_requests for each row execute function trg_mr_before();
create trigger mr_after after insert or update of meter_reading, vehicle_id on maintenance_requests for each row execute function trg_mr_after();
create trigger set_updated_at before update on maintenance_requests for each row execute function trg_set_updated_at();
create trigger block_delete before delete on maintenance_requests for each row execute function trg_block_delete();
create trigger audit after insert or update or delete on maintenance_requests for each row execute function trg_audit();

-- Security: same rules as the other operational tables.
alter table maintenance_requests enable row level security;
drop policy if exists p_select on maintenance_requests;
drop policy if exists p_insert on maintenance_requests;
drop policy if exists p_update on maintenance_requests;
create policy p_select on maintenance_requests for select to authenticated using (has_perm('view'));
create policy p_insert on maintenance_requests for insert to authenticated with check (has_perm('create'));
create policy p_update on maintenance_requests for update to authenticated using (has_perm('edit') or has_perm_text('approve_maintenance')) with check (has_perm('edit') or has_perm_text('approve_maintenance'));
revoke all on maintenance_requests from anon;
revoke delete, truncate, references, trigger on maintenance_requests from authenticated;
grant select, insert, update on maintenance_requests to authenticated;
revoke all on sequence maint_request_no_seq from anon;
grant usage on sequence maint_request_no_seq to authenticated;
revoke execute on function trg_mr_before(), trg_mr_after() from public, anon;

-- Attachments: fault photos, invoices and technical reports on a request.
alter table attachments drop constraint if exists attachments_entity_type_check;
alter table attachments add constraint attachments_entity_type_check check (entity_type in (
  'vehicle','employee','document','authorization','oil_change','maintenance',
  'accident','handover','housing_maintenance','food_supply','maintenance_request'));
alter table attachments drop constraint if exists attachments_category_check;
alter table attachments add constraint attachments_category_check check (category in (
  'oil_invoice','maintenance_invoice','repair_photo','accident_photo','accident_invoice',
  'handover_photo_before','handover_photo_after','handover_signed_form',
  'vehicle_photo','document_image','authorization_image',
  'housing_invoice','food_invoice','other','fault_photo','technical_report'));

-- Follow-ups / bell: requests not yet approved or not yet finished.
create or replace view v_followups with (security_invoker = true) as
select
  d.owner_type as subject_type, d.owner_id as subject_id, d.subject_label,
  d.doc_type as alert_type, d.status, d.site_id, d.company_id,
  d.expiry_date as due_date, d.days_left, null::int as km_left,
  case when d.status in ('expired','not_authorized','missing') then 1
       when d.status = 'expiring' and d.days_left <= 7 then 1
       when d.status = 'expiring' then 2 else 3 end as severity
from v_document_status d
where d.status in ('expired','expiring','no_date','missing','not_authorized')
union all
select 'vehicle', o.vehicle_id, v.code || U&' \2014 ' || v.plate_no, 'oil_change', o.status, v.site_id, s.company_id,
       null, null, o.remaining_km,
       case when o.status in ('due','overdue') then 1 else 2 end
from v_vehicle_oil_status o
join vehicles v on v.id = o.vehicle_id
left join sites s on s.id = v.site_id
where o.status in ('soon','due','overdue')
union all
select 'vehicle', a.vehicle_id, v.code || U&' \2014 ' || v.plate_no, 'accident', a.status::text, a.site_id, s.company_id,
       (a.occurred_at at time zone 'Asia/Riyadh')::date, app_today() - (a.occurred_at at time zone 'Asia/Riyadh')::date, null, 2
from accidents a
join vehicles v on v.id = a.vehicle_id
left join sites s on s.id = a.site_id
where a.deleted_at is null and a.status <> 'completed'
union all
select 'maintenance_request', r.id, r.request_no || U&' \2014 ' || coalesce(nullif(r.plate_no, ''), r.equipment_text, ''),
       'maintenance_request', r.status, r.site_id, r.company_id,
       r.request_date, app_today() - r.request_date, null,
       case when r.status in ('new','pending_supervisor') then 1 else 2 end
from maintenance_requests r
where r.deleted_at is null and r.status in ('new','pending_supervisor','approved','in_progress');
grant select on v_followups to authenticated;

select 'MAINTENANCE_REQUESTS_OK' as result;

-- =====================================================================
-- 0008: free-text company / site / people fields, registration data, oil payer text.
-- ASCII only. Adds columns only; no existing data is changed or removed. Safe to run more than once.
-- =====================================================================

alter table vehicles add column if not exists registration_type   text;  -- e.g. private, private transport
alter table vehicles add column if not exists registration_serial text;  -- serial number printed on the registration card
alter table vehicles add column if not exists current_user_name   text;  -- person using the vehicle now (free text)
alter table vehicles add column if not exists authorized_name     text;  -- person authorized to drive it (free text)
alter table vehicles add column if not exists location_text       text;  -- where the vehicle is now (free text)
alter table oil_changes add column if not exists payer_text       text;  -- who paid the invoice when it is not a registered company

-- Find a company by name, or register it (typed freely in a form). Needs create or edit permission.
create or replace function ensure_company(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); cid uuid;
begin
  if n = '' then return null; end if;
  if not (has_perm('create') or has_perm('edit')) then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select id into cid from companies where lower(btrim(name)) = lower(n) limit 1;
  if cid is null then
    insert into companies(name) values (n) returning id into cid;
  end if;
  return cid;
end $$;

-- Find a site / project by name, or register it under the given company.
create or replace function ensure_site(p_name text, p_company uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); sid uuid;
begin
  if n = '' then return null; end if;
  if not (has_perm('create') or has_perm('edit')) then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select id into sid from sites where lower(btrim(name)) = lower(n) limit 1;
  if sid is null then
    if p_company is null then raise exception 'SITE_COMPANY_REQUIRED: choose the company of the new site'; end if;
    insert into sites(name, company_id, kind) values (n, p_company, 'other') returning id into sid;
  end if;
  return sid;
end $$;
revoke execute on function ensure_company(text), ensure_site(text, uuid) from public, anon;
grant execute on function ensure_company(text), ensure_site(text, uuid) to authenticated;

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

select 'FREE_TEXT_FIELDS_OK' as result;

-- =====================================================================
-- 0009: mobile number of the vehicle's current user (optional). ASCII only. Safe to run more than once.
-- Stored in international form +9665XXXXXXXX (the app converts 05..., 5..., 00966..., +966...).
-- =====================================================================
alter table vehicles add column if not exists current_user_mobile text;
alter table vehicles drop constraint if exists vehicles_user_mobile_format;
alter table vehicles add constraint vehicles_user_mobile_format
  check (current_user_mobile is null or current_user_mobile ~ '^\+9665[0-9]{8}$');

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

select 'USER_MOBILE_OK' as result;
