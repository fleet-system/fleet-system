create extension if not exists pgcrypto;
create type site_kind            as enum ('farm', 'nursery', 'other');
create type employee_status      as enum ('active', 'on_leave', 'terminated', 'other');
create type vehicle_op_status    as enum ('working', 'stopped', 'under_maintenance', 'accident_damaged');
create type vehicle_location     as enum ('inside_site', 'outside_site', 'in_workshop');
create type doc_type             as enum ('iqama', 'driving_license', 'registration', 'periodic_inspection');
create type payment_status       as enum ('unpaid', 'partially_paid', 'paid');
create type accident_status      as enum ('new', 'awaiting_estimate', 'awaiting_repair', 'repairing', 'completed');
create type handover_kind        as enum ('receive', 'deliver');
create type handover_state       as enum ('draft', 'approved', 'cancelled');
create type maint_item_kind      as enum ('part', 'labor', 'other');
create type odometer_source      as enum ('manual', 'oil_change', 'maintenance', 'accident', 'handover', 'import', 'correction');
create type app_permission       as enum (
  'view',
  'create',
  'edit',
  'invoices',
  'view_sensitive',
  'export',
  'import',
  'manage_users',
  'settings'
);
create table app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
create table profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  is_admin    boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table user_permissions (
  user_id     uuid not null references profiles(user_id) on delete cascade,
  permission  app_permission not null,
  granted_at  timestamptz not null default now(),
  granted_by  uuid,
  primary key (user_id, permission)
);
create table companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint companies_name_unique unique (name)
);
create table sites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null,
  kind        site_kind not null default 'farm',
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sites_name_unique unique (name)
);
create table site_history (
  id          bigint generated always as identity primary key,
  site_id     uuid not null references sites(id),
  field       text not null,
  old_value   text,
  new_value   text,
  changed_at  timestamptz not null default now(),
  changed_by  uuid
);
create sequence employee_code_seq;
create table employees (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default ('EMP-' || lpad(nextval('employee_code_seq')::text, 4, '0')),
  full_name   text not null,
  company_id  uuid references companies(id),
  site_id     uuid references sites(id),
  job_title   text,
  status      employee_status not null default 'active',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create table employee_private (
  employee_id        uuid primary key references employees(id),
  iqama_no           text,
  mobile             text,
  driving_license_no text,
  updated_at         timestamptz not null default now(),
  constraint iqama_digits  check (iqama_no  is null or iqama_no  ~ '^[0-9]{10}$'),
  constraint mobile_format check (mobile    is null or mobile    ~ '^\+?[0-9]{9,15}$')
);
create unique index employee_private_iqama_unique on employee_private(iqama_no) where iqama_no is not null;
create sequence vehicle_code_seq;
create table vehicles (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique default ('VEH-' || lpad(nextval('vehicle_code_seq')::text, 4, '0')),
  plate_no             text not null,
  make                 text,
  vehicle_type         text,
  model                text,
  manufacture_year     int check (manufacture_year between 1950 and 2100),
  color                text,
  vin                  text,
  engine_no            text,
  owner_company_id     uuid not null references companies(id),
  site_id              uuid references sites(id),
  current_driver_id    uuid references employees(id),
  odometer             int not null default 0 check (odometer >= 0),
  odometer_updated_at  timestamptz,
  location_status      vehicle_location not null default 'inside_site',
  op_status            vehicle_op_status not null default 'working',
  site_entry_date      date,
  oil_interval_km      int not null default 10000 check (oil_interval_km between 500 and 100000),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create unique index vehicles_plate_active_unique on vehicles(plate_no) where deleted_at is null;
create unique index vehicles_vin_unique on vehicles(vin) where vin is not null and deleted_at is null;
create table vehicle_field_history (
  id          bigint generated always as identity primary key,
  vehicle_id  uuid not null references vehicles(id),
  field       text not null,
  old_value   text,
  new_value   text,
  old_label   text,
  new_label   text,
  changed_at  timestamptz not null default now(),
  changed_by  uuid
);
create index on vehicle_field_history(vehicle_id, changed_at desc);
create table vehicle_assignments (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references vehicles(id),
  employee_id  uuid not null references employees(id),
  start_at     timestamptz not null default now(),
  end_at       timestamptz,
  handover_id  uuid,
  notes        text,
  constraint assignment_period check (end_at is null or end_at >= start_at)
);
create unique index one_open_assignment_per_vehicle on vehicle_assignments(vehicle_id) where end_at is null;
create index on vehicle_assignments(employee_id);
create table odometer_readings (
  id          bigint generated always as identity primary key,
  vehicle_id  uuid not null references vehicles(id),
  reading     int not null check (reading >= 0),
  read_at     timestamptz not null default now(),
  source      odometer_source not null default 'manual',
  reason      text,
  created_by  uuid
);
create index on odometer_readings(vehicle_id, read_at desc);
create table authorizations (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references vehicles(id),
  employee_id    uuid not null references employees(id),
  is_authorized  boolean not null default true,
  auth_no        text,
  issue_date     date,
  expiry_date    date,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint auth_dates check (issue_date is null or expiry_date is null or expiry_date >= issue_date)
);
create index on authorizations(vehicle_id, employee_id);
create table documents (
  id           uuid primary key default gen_random_uuid(),
  doc_type     doc_type not null,
  employee_id  uuid references employees(id),
  vehicle_id   uuid references vehicles(id),
  doc_no       text,
  issue_date   date,
  expiry_date  date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint doc_owner check (
    (doc_type in ('iqama','driving_license')              and employee_id is not null and vehicle_id is null) or
    (doc_type in ('registration','periodic_inspection')   and vehicle_id  is not null and employee_id is null)
  ),
  constraint doc_dates check (issue_date is null or expiry_date is null or expiry_date >= issue_date)
);
create index on documents(employee_id);
create index on documents(vehicle_id);
create index on documents(expiry_date);
create sequence oil_no_seq;
create table oil_changes (
  id                 uuid primary key default gen_random_uuid(),
  oil_no             text not null unique default ('OIL-' || lpad(nextval('oil_no_seq')::text, 6, '0')),
  vehicle_id         uuid not null references vehicles(id),
  site_id            uuid references sites(id),
  owner_company_id   uuid references companies(id),
  payer_company_id   uuid references companies(id),
  change_date        date not null,
  odometer           int not null check (odometer >= 0),
  interval_km        int not null check (interval_km between 500 and 100000),
  next_odometer      int generated always as (odometer + interval_km) stored,
  workshop           text,
  oil_type           text,
  filter_type        text,
  oil_cost           numeric(12,2) not null default 0 check (oil_cost >= 0),
  filter_cost        numeric(12,2) not null default 0 check (filter_cost >= 0),
  extra_cost         numeric(12,2) not null default 0 check (extra_cost >= 0),
  total              numeric(12,2) generated always as (oil_cost + filter_cost + extra_cost) stored,
  invoice_no         text,
  payment_status     payment_status not null default 'paid',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  deleted_at         timestamptz
);
create index on oil_changes(vehicle_id, change_date desc, odometer desc);
create sequence maint_no_seq;
create table maintenance (
  id                 uuid primary key default gen_random_uuid(),
  maint_no           text not null unique default ('MNT-' || lpad(nextval('maint_no_seq')::text, 6, '0')),
  vehicle_id         uuid not null references vehicles(id),
  site_id            uuid references sites(id),
  owner_company_id   uuid references companies(id),
  payer_company_id   uuid references companies(id),
  maint_date         date not null,
  odometer           int check (odometer >= 0),
  maint_type         text not null,
  fault_description  text,
  workshop           text,
  parts_cost         numeric(12,2) not null default 0,
  labor_cost         numeric(12,2) not null default 0,
  other_cost         numeric(12,2) not null default 0,
  subtotal           numeric(12,2) generated always as (parts_cost + labor_cost + other_cost) stored,
  vat_amount         numeric(12,2) not null default 0 check (vat_amount >= 0),
  total              numeric(12,2) generated always as (parts_cost + labor_cost + other_cost + vat_amount) stored,
  invoice_no         text,
  payment_status     payment_status not null default 'unpaid',
  status_before      vehicle_op_status,
  status_after       vehicle_op_status,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  deleted_at         timestamptz
);
create index on maintenance(vehicle_id, maint_date desc);
create table maintenance_items (
  id              uuid primary key default gen_random_uuid(),
  maintenance_id  uuid not null references maintenance(id),
  kind            maint_item_kind not null default 'part',
  description     text not null,
  quantity        numeric(10,2) not null default 1 check (quantity > 0),
  unit_price      numeric(12,2) not null default 0 check (unit_price >= 0),
  line_total      numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,
  sort_order      int not null default 0,
  deleted_at      timestamptz
);
create index on maintenance_items(maintenance_id);
create sequence accident_no_seq;
create table accidents (
  id                 uuid primary key default gen_random_uuid(),
  accident_no        text not null unique default ('ACC-' || lpad(nextval('accident_no_seq')::text, 6, '0')),
  vehicle_id         uuid not null references vehicles(id),
  driver_id          uuid references employees(id),
  site_id            uuid references sites(id),
  owner_company_id   uuid references companies(id),
  payer_company_id   uuid references companies(id),
  occurred_at        timestamptz not null,
  odometer           int check (odometer >= 0),
  description        text,
  damages            text,
  workshop           text,
  parts_cost         numeric(12,2) not null default 0 check (parts_cost >= 0),
  labor_cost         numeric(12,2) not null default 0 check (labor_cost >= 0),
  extra_cost         numeric(12,2) not null default 0 check (extra_cost >= 0),
  total              numeric(12,2) generated always as (parts_cost + labor_cost + extra_cost) stored,
  status             accident_status not null default 'new',
  repair_start_date  date,
  repair_end_date    date,
  back_to_work_date  date,
  payment_status     payment_status not null default 'unpaid',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  deleted_at         timestamptz,
  constraint accident_repair_dates check (repair_end_date is null or repair_start_date is null or repair_end_date >= repair_start_date)
);
create index on accidents(vehicle_id, occurred_at desc);
create sequence handover_no_seq;
create table handovers (
  id                   uuid primary key default gen_random_uuid(),
  form_no              text not null unique default ('HO-' || lpad(nextval('handover_no_seq')::text, 6, '0')),
  kind                 handover_kind not null,
  company_id           uuid references companies(id),
  site_id              uuid references sites(id),
  vehicle_id           uuid not null references vehicles(id),
  from_employee_id     uuid references employees(id),
  to_employee_id       uuid references employees(id),
  occurred_at          timestamptz not null default now(),
  odometer             int check (odometer >= 0),
  fuel_level           text check (fuel_level in ('empty','quarter','half','three_quarters','full')),
  body_condition       text,
  tires_condition      text,
  lights_condition     text,
  ac_condition         text,
  tools_equipment      text,
  prior_damages        text,
  notes                text,
  from_signature_path  text,
  to_signature_path    text,
  state                handover_state not null default 'draft',
  approved_at          timestamptz,
  approved_by          uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  deleted_at           timestamptz,
  constraint handover_people check (from_employee_id is distinct from to_employee_id or from_employee_id is null)
);
create index on handovers(vehicle_id, occurred_at desc);
alter table vehicle_assignments
  add constraint vehicle_assignments_handover_fk foreign key (handover_id) references handovers(id);
create sequence housing_no_seq;
create table housing_maintenance (
  id                uuid primary key default gen_random_uuid(),
  op_no             text not null unique default ('HSG-' || lpad(nextval('housing_no_seq')::text, 6, '0')),
  company_id        uuid references companies(id),
  site_id           uuid not null references sites(id),
  payer_company_id  uuid references companies(id),
  work_date         date not null,
  description       text not null,
  contractor        text,
  invoice_no        text,
  subtotal          numeric(12,2) not null default 0 check (subtotal >= 0),
  vat_amount        numeric(12,2) not null default 0 check (vat_amount >= 0),
  total             numeric(12,2) generated always as (subtotal + vat_amount) stored,
  payment_status    payment_status not null default 'unpaid',
  paid_date         date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  deleted_at        timestamptz
);
create index on housing_maintenance(site_id, work_date desc);
create sequence food_no_seq;
create table food_supplies (
  id                uuid primary key default gen_random_uuid(),
  op_no             text not null unique default ('FD-' || lpad(nextval('food_no_seq')::text, 6, '0')),
  company_id        uuid references companies(id),
  site_id           uuid not null references sites(id),
  payer_company_id  uuid references companies(id),
  supply_date       date not null,
  supplier          text not null,
  description       text not null,
  quantity          numeric(12,3) not null check (quantity > 0),
  unit              text not null,
  unit_price        numeric(12,2) not null check (unit_price >= 0),
  subtotal          numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,
  vat_amount        numeric(12,2) not null default 0 check (vat_amount >= 0),
  total             numeric(12,2) generated always as (round(quantity * unit_price, 2) + vat_amount) stored,
  invoice_no        text,
  payment_status    payment_status not null default 'unpaid',
  paid_date         date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  deleted_at        timestamptz
);
create index on food_supplies(site_id, supply_date desc);
create table attachments (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null check (entity_type in (
                  'vehicle','employee','document','authorization','oil_change','maintenance',
                  'accident','handover','housing_maintenance','food_supply')),
  entity_id     uuid not null,
  category      text not null check (category in (
                  'oil_invoice','maintenance_invoice','repair_photo','accident_photo','accident_invoice',
                  'handover_photo_before','handover_photo_after','handover_signed_form',
                  'vehicle_photo','document_image','authorization_image',
                  'housing_invoice','food_invoice','other')),
  file_name     text not null,
  storage_path  text not null unique,
  mime_type     text,
  size_bytes    bigint check (size_bytes >= 0),
  doc_date      date,
  sensitivity   text generated always as (
                  case
                    when category in ('oil_invoice','maintenance_invoice','accident_invoice','housing_invoice','food_invoice') then 'invoice'
                    when category = 'document_image' and entity_type in ('employee','document') then 'personal'
                    else 'normal'
                  end) stored,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   uuid,
  notes         text,
  deleted_at    timestamptz
);
create index on attachments(entity_type, entity_id);
create table audit_log (
  id           bigint generated always as identity primary key,
  table_name   text not null,
  record_id    text,
  action       text not null check (action in ('INSERT','UPDATE','DELETE','ARCHIVE','RESTORE','IMPORT','LOGIN')),
  changed_by   uuid,
  changed_at   timestamptz not null default now(),
  old_data     jsonb,
  new_data     jsonb,
  changes      jsonb
);
create index on audit_log(table_name, record_id);
create index on audit_log(changed_at desc);
create table import_batches (
  id            uuid primary key default gen_random_uuid(),
  target_table  text not null,
  file_name     text,
  status        text not null default 'preview' check (status in ('preview','committed','cancelled')),
  summary       jsonb,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  committed_at  timestamptz
);
create or replace function app_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;
create or replace function fmt_date(d date) returns text
language sql immutable as $$ select to_char(d, 'YYYY/MM/DD') $$;
create or replace function fmt_datetime(t timestamptz) returns text
language sql stable as $$ select to_char(t at time zone 'Asia/Riyadh', 'YYYY/MM/DD HH24:MI') $$;
create or replace function parse_app_date(s text) returns date
language plpgsql immutable as $$
declare d date; t text := btrim(s);
begin
  if t is null or t = '' then return null; end if;
  t := translate(t, U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669', '0123456789');
  if t !~ '^[0-9]{4}[/-][0-9]{2}[/-][0-9]{2}$' then
    raise exception 'INVALID_DATE_FORMAT: % (expected YYYY/MM/DD)', s using errcode = '22007';
  end if;
  begin
    d := replace(t, '/', '-')::date;
  exception when others then
    d := null;
  end;
  if d is null or to_char(d, 'YYYY-MM-DD') <> replace(t, '/', '-') then
    raise exception 'INVALID_DATE: % does not exist in the calendar', s using errcode = '22008';
  end if;
  return d;
end $$;
create or replace function current_uid() returns uuid
language sql stable as $$ select auth.uid() $$;
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and is_active from profiles where user_id = auth.uid()), false)
$$;
create or replace function has_perm(p app_permission) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles pr
    where pr.user_id = auth.uid() and pr.is_active
      and (pr.is_admin or exists (select 1 from user_permissions up
                                  where up.user_id = pr.user_id and up.permission = p))
  )
$$;
create or replace function setting_int(k text, dflt int) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from app_settings where key = k), dflt)
$$;
create or replace function doc_alert_days() returns int[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(x::int order by x::int desc) from app_settings, jsonb_array_elements_text(value) x
      where key = 'doc_alert_days'),
    array[90,60,30,7])
$$;
create or replace function trg_set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create or replace function trg_block_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'DELETE_NOT_ALLOWED: records in % cannot be deleted; archive instead', tg_table_name
    using errcode = '42501';
end $$;
create or replace function trg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; diff jsonb := '{}'::jsonb; k text; act text := tg_op; rid text;
begin
  if tg_op in ('UPDATE','DELETE') then o := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at') and (o -> k) is distinct from (n -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', n -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
    if diff ? 'deleted_at' then
      act := case when n ->> 'deleted_at' is null then 'RESTORE' else 'ARCHIVE' end;
    end if;
  end if;
  rid := coalesce(n, o) ->> (case when coalesce(n, o) ? 'id' then 'id'
                                   when coalesce(n, o) ? 'employee_id' then 'employee_id'
                                   when coalesce(n, o) ? 'user_id' then 'user_id'
                                   else 'key' end);
  if tg_table_name = 'employee_private' then
    o := o - 'iqama_no' - 'mobile' - 'driving_license_no';
    n := n - 'iqama_no' - 'mobile' - 'driving_license_no';
    diff := (select coalesce(jsonb_object_agg(key, '"(sensitive value changed)"'::jsonb), '{}'::jsonb)
             from jsonb_each(diff) where key in ('iqama_no','mobile','driving_license_no'))
            || (diff - 'iqama_no' - 'mobile' - 'driving_license_no');
  end if;
  insert into audit_log(table_name, record_id, action, changed_by, old_data, new_data, changes)
  values (tg_table_name, rid,
          case when coalesce(current_setting('app.import_batch', true), '') <> '' and act in ('INSERT','UPDATE')
               then 'IMPORT' else act end,
          auth.uid(), o, n, nullif(diff, '{}'::jsonb));
  return coalesce(new, old);
end $$;
create or replace function trg_site_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.name is distinct from old.name then
    insert into site_history(site_id, field, old_value, new_value, changed_by)
    values (new.id, 'name', old.name, new.name, auth.uid());
  end if;
  if new.company_id is distinct from old.company_id then
    insert into site_history(site_id, field, old_value, new_value, changed_by)
    values (new.id, 'company_id', old.company_id::text, new.company_id::text, auth.uid());
  end if;
  return new;
end $$;
create or replace function trg_vehicle_before() returns trigger
language plpgsql as $$
begin
  if new.odometer < 0 then
    raise exception 'ODOMETER_NEGATIVE: negative odometer reading not allowed' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.odometer > 0 and new.odometer_updated_at is null then new.odometer_updated_at := now(); end if;
    return new;
  end if;
  if new.odometer is distinct from old.odometer then
    if new.odometer < old.odometer
       and coalesce(current_setting('app.odometer_correction', true), '') <> 'on' then
      raise exception 'ODOMETER_DECREASE: new reading % is lower than last recorded reading %; confirmation required',
        new.odometer, old.odometer
        using errcode = 'P0001', hint = 'use correct_odometer() after user confirmation';
    end if;
    new.odometer_updated_at := now();
  end if;
  return new;
end $$;
create or replace function vehicle_ref_label(field text, val text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if val is null then return null; end if;
  return case field
    when 'owner_company_id'  then (select name from companies where id = val::uuid)
    when 'site_id'           then (select name from sites where id = val::uuid)
    when 'current_driver_id' then (select full_name || ' (' || code || ')' from employees where id = val::uuid)
    else val end;
end $$;
create or replace function trg_vehicle_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f text; ov text; nv text;
  ho uuid := nullif(current_setting('app.handover_id', true), '')::uuid;
  src odometer_source := coalesce(nullif(current_setting('app.odometer_source', true), ''), 'manual')::odometer_source;
begin
  if tg_op = 'INSERT' then
    if new.current_driver_id is not null then
      insert into vehicle_assignments(vehicle_id, employee_id, handover_id) values (new.id, new.current_driver_id, ho);
    end if;
    if new.odometer > 0 then
      insert into odometer_readings(vehicle_id, reading, source, created_by) values (new.id, new.odometer, 'manual', auth.uid());
    end if;
    return new;
  end if;
  foreach f in array array['current_driver_id','site_id','owner_company_id','op_status','location_status','plate_no'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into ov, nv using old, new;
    if ov is distinct from nv then
      insert into vehicle_field_history(vehicle_id, field, old_value, new_value, old_label, new_label, changed_by)
      values (new.id, f, ov, nv, vehicle_ref_label(f, ov), vehicle_ref_label(f, nv), auth.uid());
    end if;
  end loop;
  if new.current_driver_id is distinct from old.current_driver_id then
    update vehicle_assignments set end_at = now()
     where vehicle_id = new.id and end_at is null;
    if new.current_driver_id is not null then
      insert into vehicle_assignments(vehicle_id, employee_id, handover_id)
      values (new.id, new.current_driver_id, ho);
    end if;
  end if;
  if new.odometer is distinct from old.odometer then
    insert into odometer_readings(vehicle_id, reading, source, reason, created_by)
    values (new.id, new.odometer, src, nullif(current_setting('app.odometer_reason', true), ''), auth.uid());
  end if;
  return new;
end $$;
create or replace function bump_odometer(p_vehicle uuid, p_reading int, p_source odometer_source) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_reading is null then return; end if;
  perform set_config('app.odometer_source', p_source::text, true);
  update vehicles set odometer = p_reading where id = p_vehicle and odometer < p_reading;
  perform set_config('app.odometer_source', '', true);
end $$;
create or replace function correct_odometer(p_vehicle uuid, p_reading int, p_reason text) returns void
language plpgsql as $$
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_reading < 0 then raise exception 'ODOMETER_NEGATIVE: negative odometer reading not allowed' using errcode = '23514'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED: a correction reason is required'; end if;
  perform set_config('app.odometer_correction', 'on', true);
  perform set_config('app.odometer_source', 'correction', true);
  perform set_config('app.odometer_reason', p_reason, true);
  update vehicles set odometer = p_reading where id = p_vehicle;
  if not found then raise exception 'VEHICLE_NOT_FOUND'; end if;
  perform set_config('app.odometer_correction', '', true);
  perform set_config('app.odometer_source', '', true);
  perform set_config('app.odometer_reason', '', true);
end $$;
create or replace function trg_vehicle_op_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare v vehicles%rowtype;
begin
  select * into v from vehicles where id = new.vehicle_id;
  if not found then raise exception 'VEHICLE_NOT_FOUND'; end if;
  if tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id then
    new.site_id          := coalesce(new.site_id, v.site_id);
    new.owner_company_id := coalesce(new.owner_company_id, v.owner_company_id);
  end if;
  if tg_table_name = 'oil_changes' then
    if new.interval_km is null then new.interval_km := v.oil_interval_km; end if;
  end if;
  return new;
end $$;
create or replace function trg_vehicle_op_bump() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is null then
    perform bump_odometer(new.vehicle_id, new.odometer,
      case tg_table_name when 'oil_changes' then 'oil_change' when 'maintenance' then 'maintenance'
                         when 'accidents' then 'accident' else 'manual' end::odometer_source);
  end if;
  return new;
end $$;
create or replace function trg_fill_company_from_site() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    select company_id into new.company_id from sites where id = new.site_id;
  end if;
  return new;
end $$;
create or replace function recalc_maintenance(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update maintenance m set
    parts_cost = coalesce((select sum(line_total) from maintenance_items i where i.maintenance_id = m.id and i.deleted_at is null and i.kind = 'part'), 0),
    labor_cost = coalesce((select sum(line_total) from maintenance_items i where i.maintenance_id = m.id and i.deleted_at is null and i.kind = 'labor'), 0),
    other_cost = coalesce((select sum(line_total) from maintenance_items i where i.maintenance_id = m.id and i.deleted_at is null and i.kind = 'other'), 0)
  where m.id = p_id
$$;
create or replace function trg_maintenance_items_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform recalc_maintenance(new.maintenance_id);
  if tg_op = 'UPDATE' and old.maintenance_id <> new.maintenance_id then
    perform recalc_maintenance(old.maintenance_id);
  end if;
  return new;
end $$;
create or replace function trg_handover_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v vehicles%rowtype;
begin
  if tg_op = 'UPDATE' and old.state <> 'draft' then
    if not (is_admin() and new.deleted_at is distinct from old.deleted_at
            and (to_jsonb(new) - 'deleted_at' - 'updated_at') = (to_jsonb(old) - 'deleted_at' - 'updated_at')) then
      raise exception 'HANDOVER_LOCKED: form % is approved and cannot be edited; create a new form', old.form_no
        using errcode = 'P0001';
    end if;
    return new;
  end if;
  select * into v from vehicles where id = new.vehicle_id;
  new.site_id := coalesce(new.site_id, v.site_id);
  new.company_id := coalesce(new.company_id, (select company_id from sites where id = new.site_id));
  if tg_op = 'INSERT' and new.from_employee_id is null then
    new.from_employee_id := v.current_driver_id;
  end if;
  if new.state = 'approved' and (tg_op = 'INSERT' or old.state = 'draft') then
    new.approved_at := now();
    new.approved_by := auth.uid();
  end if;
  return new;
end $$;
create or replace function trg_handover_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.state = 'approved' and (tg_op = 'INSERT' or old.state = 'draft') then
    perform set_config('app.handover_id', new.id::text, true);
    update vehicles set current_driver_id = new.to_employee_id
     where id = new.vehicle_id and current_driver_id is distinct from new.to_employee_id;
    perform set_config('app.handover_id', '', true);
    perform bump_odometer(new.vehicle_id, new.odometer, 'handover');
  end if;
  return new;
end $$;
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email, full_name, is_admin)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
          not exists (select 1 from profiles where is_admin));
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['companies','sites','employees','employee_private','vehicles','authorizations','documents',
                           'oil_changes','maintenance','accidents','handovers','housing_maintenance','food_supplies','profiles'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function trg_set_updated_at()', t);
  end loop;
  foreach t in array array['companies','sites','employees','employee_private','vehicles','vehicle_assignments','vehicle_field_history',
                           'odometer_readings','authorizations','documents','oil_changes','maintenance','maintenance_items',
                           'accidents','handovers','housing_maintenance','food_supplies','attachments','audit_log','site_history'] loop
    execute format('create trigger block_delete before delete on %I for each row execute function trg_block_delete()', t);
  end loop;
  foreach t in array array['companies','sites','employees','employee_private','vehicles','authorizations','documents',
                           'oil_changes','maintenance','maintenance_items','accidents','handovers','housing_maintenance',
                           'food_supplies','attachments','profiles','user_permissions','app_settings'] loop
    execute format('create trigger audit after insert or update or delete on %I for each row execute function trg_audit()', t);
  end loop;
  foreach t in array array['oil_changes','maintenance','accidents'] loop
    execute format('create trigger op_snapshot before insert or update on %I for each row execute function trg_vehicle_op_snapshot()', t);
    execute format('create trigger op_bump after insert or update of odometer on %I for each row execute function trg_vehicle_op_bump()', t);
  end loop;
  foreach t in array array['housing_maintenance','food_supplies'] loop
    execute format('create trigger fill_company before insert or update of site_id on %I for each row execute function trg_fill_company_from_site()', t);
  end loop;
end $$;
create trigger site_history after update on sites for each row execute function trg_site_history();
create trigger vehicle_before before insert or update on vehicles for each row execute function trg_vehicle_before();
create trigger vehicle_after  after  insert or update on vehicles for each row execute function trg_vehicle_after();
create trigger items_recalc after insert or update on maintenance_items for each row execute function trg_maintenance_items_recalc();
create trigger handover_before before insert or update on handovers for each row execute function trg_handover_before();
create trigger handover_after  after  insert or update on handovers for each row execute function trg_handover_after();
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
create or replace view v_vehicle_authorization with (security_invoker = true) as
select
  v.id as vehicle_id,
  v.current_driver_id as employee_id,
  a.id as authorization_id,
  a.auth_no, a.issue_date, a.expiry_date, a.is_authorized,
  case when a.expiry_date is not null then a.expiry_date - app_today() end as days_left,
  case
    when v.current_driver_id is null then 'no_driver'
    when a.id is null               then 'missing'
    when not a.is_authorized        then 'not_authorized'
    when a.expiry_date is null      then 'no_date'
    when a.expiry_date < app_today() then 'expired'
    else 'valid'
  end as status
from vehicles v
left join lateral (
  select * from authorizations x
  where x.vehicle_id = v.id and x.employee_id = v.current_driver_id and x.deleted_at is null
  order by x.expiry_date desc nulls last, x.created_at desc
  limit 1
) a on true
where v.deleted_at is null;
create or replace view v_document_status with (security_invoker = true) as
with req as (
  select 'vehicle'::text as owner_type, v.id as owner_id, t.dt::text as doc_type,
         v.code || U&' \2014 ' || v.plate_no as subject_label, v.site_id, s.company_id, v.owner_company_id
  from vehicles v
  left join sites s on s.id = v.site_id
  cross join (values ('registration'), ('periodic_inspection')) t(dt)
  where v.deleted_at is null
  union all
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
  select 'vehicle', v.id, 'authorization', v.code || U&' \2014 ' || v.plate_no, v.site_id, s.company_id, v.owner_company_id,
         va.authorization_id, va.auth_no, va.issue_date, va.expiry_date, va.is_authorized
  from vehicles v
  join v_vehicle_authorization va on va.vehicle_id = v.id
  left join sites s on s.id = v.site_id
  where v.deleted_at is null and v.current_driver_id is not null
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
    when expiry_date - app_today() <= (doc_alert_days())[1] then 'expiring'
    else 'valid'
  end as status,
  (select min(x) from unnest(doc_alert_days()) x
    where expiry_date is not null and expiry_date >= app_today() and expiry_date - app_today() <= x) as alert_level
from docs;
create or replace view v_vehicle_oil_status with (security_invoker = true) as
select
  v.id as vehicle_id,
  o.id as last_oil_change_id,
  o.change_date as last_change_date,
  o.odometer as last_change_odometer,
  coalesce(o.interval_km, v.oil_interval_km) as interval_km,
  o.next_odometer,
  v.odometer as current_odometer,
  o.next_odometer - v.odometer as remaining_km,
  case
    when o.id is null then 'no_record'
    when o.next_odometer - v.odometer > setting_int('oil_warning_km', 1000) then 'not_due'
    when o.next_odometer - v.odometer > 0 then 'soon'
    when o.next_odometer - v.odometer > -setting_int('oil_overdue_tolerance_km', 500) then 'due'
    else 'overdue'
  end as status
from vehicles v
left join lateral (
  select * from oil_changes x where x.vehicle_id = v.id and x.deleted_at is null
  order by x.odometer desc, x.change_date desc limit 1
) o on true
where v.deleted_at is null;
create or replace view v_vehicles_overview with (security_invoker = true) as
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
create or replace view v_expenses with (security_invoker = true) as
select 'oil_change'::text as category, o.id as record_id, o.oil_no as ref_no, o.change_date as expense_date,
       o.vehicle_id, o.site_id, s.company_id as site_company_id, o.owner_company_id, o.payer_company_id,
       o.total as subtotal, 0::numeric(12,2) as vat_amount, o.total, o.payment_status
from oil_changes o left join sites s on s.id = o.site_id where o.deleted_at is null
union all
select 'maintenance', m.id, m.maint_no, m.maint_date, m.vehicle_id, m.site_id, s.company_id, m.owner_company_id, m.payer_company_id,
       m.subtotal, m.vat_amount, m.total, m.payment_status
from maintenance m left join sites s on s.id = m.site_id where m.deleted_at is null
union all
select 'accident', a.id, a.accident_no, (a.occurred_at at time zone 'Asia/Riyadh')::date, a.vehicle_id, a.site_id, s.company_id,
       a.owner_company_id, a.payer_company_id, a.total, 0, a.total, a.payment_status
from accidents a left join sites s on s.id = a.site_id where a.deleted_at is null
union all
select 'housing_maintenance', h.id, h.op_no, h.work_date, null, h.site_id, h.company_id, null, h.payer_company_id,
       h.subtotal, h.vat_amount, h.total, h.payment_status
from housing_maintenance h where h.deleted_at is null
union all
select 'food_supply', f.id, f.op_no, f.supply_date, null, f.site_id, f.company_id, null, f.payer_company_id,
       f.subtotal, f.vat_amount, f.total, f.payment_status
from food_supplies f where f.deleted_at is null;
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
where a.deleted_at is null and a.status <> 'completed';
create or replace function dashboard_stats(
  p_company uuid default null, p_site uuid default null,
  p_year int default null, p_month int default null
) returns jsonb
language plpgsql stable as $$
declare
  y int := coalesce(p_year,  extract(year  from app_today())::int);
  m int := coalesce(p_month, extract(month from app_today())::int);
  d_from date := make_date(y, m, 1);
  d_to   date := (make_date(y, m, 1) + interval '1 month')::date;
  r jsonb;
begin
  with vv as (
    select v.* from v_vehicles_overview v
    where (p_site is null or v.site_id = p_site)
      and (p_company is null or v.site_company_id = p_company)
  ), ex as (
    select * from v_expenses e
    where e.expense_date >= d_from and e.expense_date < d_to
      and (p_site is null or e.site_id = p_site)
      and (p_company is null or e.site_company_id = p_company)
  ), ds as (
    select * from v_document_status d
    where (p_site is null or d.site_id = p_site)
      and (p_company is null or d.company_id = p_company)
  )
  select jsonb_build_object(
    'period',                 fmt_date(d_from) || ' - ' || fmt_date(d_to - 1),
    'vehicles_total',         (select count(*) from vv),
    'vehicles_working',       (select count(*) from vv where op_status = 'working'),
    'vehicles_stopped',       (select count(*) from vv where op_status = 'stopped'),
    'vehicles_maintenance',   (select count(*) from vv where op_status = 'under_maintenance'),
    'vehicles_accident',      (select count(*) from vv where op_status = 'accident_damaged'),
    'vehicles_inside',        (select count(*) from vv where location_status = 'inside_site'),
    'vehicles_outside',       (select count(*) from vv where location_status = 'outside_site'),
    'vehicles_in_workshop',   (select count(*) from vv where location_status = 'in_workshop'),
    'employees_total',        (select count(*) from employees e where e.deleted_at is null and e.status = 'active'
                                 and (p_site is null or e.site_id = p_site) and (p_company is null or e.company_id = p_company)),
    'docs_expired',           (select count(*) from ds where status = 'expired'),
    'docs_expiring_30',       (select count(*) from ds where status in ('expiring','valid') and days_left between 0 and 30),
    'oil_due_soon',           (select count(*) from vv where oil_status in ('soon','due','overdue')),
    'accidents_open',         (select count(*) from accidents a where a.deleted_at is null and a.status <> 'completed'
                                 and a.vehicle_id in (select id from vv)),
    'cost_maintenance_month', (select coalesce(sum(total), 0) from ex where category = 'maintenance'),
    'cost_oil_month',         (select coalesce(sum(total), 0) from ex where category = 'oil_change'),
    'cost_accidents_month',   (select coalesce(sum(total), 0) from ex where category = 'accident'),
    'cost_housing_month',     (select coalesce(sum(total), 0) from ex where category = 'housing_maintenance'),
    'cost_food_month',        (select coalesce(sum(total), 0) from ex where category = 'food_supply'),
    'cost_housing_food_month',(select coalesce(sum(total), 0) from ex where category in ('housing_maintenance','food_supply'))
  ) into r;
  return r;
end $$;
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
grant delete on user_permissions to authenticated;
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
do $$
declare t text;
begin
  foreach t in array array['employees','vehicles','authorizations','documents','oil_changes','maintenance',
                           'maintenance_items','accidents','handovers','housing_maintenance','food_supplies'] loop
    execute format('create policy p_select on %I for select to authenticated using (has_perm(''view''))', t);
    execute format('create policy p_insert on %I for insert to authenticated with check (has_perm(''create''))', t);
    execute format('create policy p_update on %I for update to authenticated using (has_perm(''edit'')) with check (has_perm(''edit''))', t);
  end loop;
  foreach t in array array['vehicle_field_history','vehicle_assignments','odometer_readings','site_history'] loop
    execute format('create policy p_select on %I for select to authenticated using (has_perm(''view''))', t);
  end loop;
end $$;
create policy p_select on employee_private for select to authenticated
  using (has_perm('view_sensitive'));
create policy p_insert on employee_private for insert to authenticated
  with check (has_perm('create') and has_perm('view_sensitive'));
create policy p_update on employee_private for update to authenticated
  using (has_perm('edit') and has_perm('view_sensitive'))
  with check (has_perm('edit') and has_perm('view_sensitive'));
create or replace function can_see_attachment(sens text) returns boolean
language sql stable as $$
  select has_perm('view') and case sens
    when 'invoice'  then has_perm('invoices')
    when 'personal' then has_perm('view_sensitive')
    else true end
$$;
create policy p_select on attachments for select to authenticated
  using (can_see_attachment(sensitivity));
create policy p_insert on attachments for insert to authenticated
  with check ((has_perm('create') or has_perm('invoices')) and can_see_attachment(sensitivity));
create policy p_update on attachments for update to authenticated
  using (has_perm('edit') and can_see_attachment(sensitivity))
  with check (has_perm('edit') and can_see_attachment(sensitivity));
create policy p_select on companies    for select to authenticated using (has_perm('view'));
create policy p_insert on companies    for insert to authenticated with check (has_perm('settings'));
create policy p_update on companies    for update to authenticated using (has_perm('settings')) with check (has_perm('settings'));
create policy p_select on sites        for select to authenticated using (has_perm('view'));
create policy p_insert on sites        for insert to authenticated with check (has_perm('settings'));
create policy p_update on sites        for update to authenticated using (has_perm('settings')) with check (has_perm('settings'));
create policy p_select on app_settings for select to authenticated using (has_perm('view'));
create policy p_insert on app_settings for insert to authenticated with check (has_perm('settings'));
create policy p_update on app_settings for update to authenticated using (has_perm('settings')) with check (has_perm('settings'));
create policy p_select on profiles for select to authenticated
  using (user_id = auth.uid() or has_perm('manage_users'));
create policy p_update on profiles for update to authenticated
  using (has_perm('manage_users')) with check (has_perm('manage_users'));
create policy p_select on user_permissions for select to authenticated
  using (user_id = auth.uid() or has_perm('manage_users'));
create policy p_insert on user_permissions for insert to authenticated
  with check (has_perm('manage_users'));
create policy p_delete on user_permissions for delete to authenticated
  using (has_perm('manage_users'));
create or replace function trg_protect_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.is_admin is distinct from old.is_admin) and not is_admin() then
    raise exception 'ADMIN_ONLY: only an admin can change admin status' using errcode = '42501';
  end if;
  if old.is_admin and old.is_active and (not new.is_admin or not new.is_active)
     and not exists (select 1 from profiles where is_admin and is_active and user_id <> old.user_id) then
    raise exception 'LAST_ADMIN: the last active admin cannot be disabled or demoted';
  end if;
  return new;
end $$;
create trigger protect_admin before update on profiles for each row execute function trg_protect_admin();
create or replace function trg_protect_grant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.permission, old.permission) = 'manage_users' and not is_admin() then
    raise exception 'ADMIN_ONLY: only an admin can grant manage_users' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then new.granted_by := auth.uid(); return new; end if;
  return old;
end $$;
create trigger protect_grant before insert or delete on user_permissions for each row execute function trg_protect_grant();
create policy p_select on audit_log for select to authenticated
  using (is_admin() or has_perm('manage_users'));
revoke insert, update on audit_log from authenticated;
create policy p_select on import_batches for select to authenticated using (has_perm('import'));
create policy p_insert on import_batches for insert to authenticated with check (has_perm('import'));
create policy p_update on import_batches for update to authenticated using (has_perm('import')) with check (has_perm('import'));
grant select on v_vehicle_authorization, v_document_status, v_vehicle_oil_status,
                v_vehicles_overview, v_expenses, v_followups to authenticated;
grant execute on function app_today(), fmt_date(date), fmt_datetime(timestamptz), parse_app_date(text),
                         has_perm(app_permission), is_admin(), correct_odometer(uuid, int, text),
                         dashboard_stats(uuid, uuid, int, int), can_see_attachment(text),
                         setting_int(text, int), doc_alert_days(), current_uid()
  to authenticated;
revoke execute on function bump_odometer(uuid, int, odometer_source), recalc_maintenance(uuid) from public, authenticated;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 20971520,
        array['image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf'])
on conflict (id) do nothing;
create policy attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments'
         and exists (select 1 from public.attachments a where a.storage_path = storage.objects.name));
create policy attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (public.has_perm('create') or public.has_perm('invoices')));
insert into companies (id, name) values
  ('11111111-1111-1111-1111-111111111111', U&'\0634\0631\0643\0629 \0631\0648\0649 \0627\0644\0631\0645\0627\0644 \0627\0644\0632\0631\0627\0639\064A\0629'),
  ('22222222-2222-2222-2222-222222222222', U&'\0634\0631\0643\0629 \0639\0628\062F \0627\0644\0631\062D\0645\0646 \0627\0644\0641\0647\0627\062F');
insert into sites (company_id, name, kind) values
  ('11111111-1111-1111-1111-111111111111', U&'\0645\0632\0631\0639\0629 \0627\0644\063A\0645\0644\0627\0633', 'farm'),
  ('11111111-1111-1111-1111-111111111111', U&'\0645\0632\0631\0639\0629 \0627\0644\0628\0631\0643\0629',  'farm'),
  ('11111111-1111-1111-1111-111111111111', U&'\0645\0632\0631\0639\0629 \0627\0631\0645',     'farm'),
  ('22222222-2222-2222-2222-222222222222', U&'\0645\0634\062A\0644 \0627\0644\063A\0645\0644\0627\0633',  'nursery');
insert into app_settings (key, value, description) values
  ('doc_alert_days',           '[90, 60, 30, 7]', U&'\0641\062A\0631\0627\062A \0627\0644\062A\0646\0628\064A\0647 \0642\0628\0644 \0627\0646\062A\0647\0627\0621 \0627\0644\0648\062B\0627\0626\0642 \0628\0627\0644\0623\064A\0627\0645'),
  ('oil_default_interval_km',  '10000',           U&'\0641\062A\0631\0629 \062A\063A\064A\064A\0631 \0627\0644\0632\064A\062A \0627\0644\0627\0641\062A\0631\0627\0636\064A\0629 \0628\0627\0644\0643\064A\0644\0648\0645\062A\0631'),
  ('oil_warning_km',           '1000',            U&'\0627\0644\062A\0646\0628\064A\0647 \0639\0646\062F \0628\0642\0627\0621 \0647\0630\0647 \0627\0644\0645\0633\0627\0641\0629 \0623\0648 \0623\0642\0644 \0644\062A\063A\064A\064A\0631 \0627\0644\0632\064A\062A'),
  ('oil_overdue_tolerance_km', '500',             U&'\0628\0639\062F \062A\062C\0627\0648\0632 \0627\0644\0645\0648\0639\062F \0628\0647\0630\0647 \0627\0644\0645\0633\0627\0641\0629 \062A\0635\0628\062D \0627\0644\062D\0627\0644\0629 "\062A\062C\0627\0648\0632 \0645\0648\0639\062F \0627\0644\062A\063A\064A\064A\0631"'),
  ('default_vat_rate',         '0.15',            U&'\0646\0633\0628\0629 \0636\0631\064A\0628\0629 \0627\0644\0642\064A\0645\0629 \0627\0644\0645\0636\0627\0641\0629 \0627\0644\0627\0641\062A\0631\0627\0636\064A\0629'),
  ('currency',                 '"SAR"',           U&'\0627\0644\0639\0645\0644\0629'),
  ('timezone',                 '"Asia/Riyadh"',   U&'\0627\0644\062A\0648\0642\064A\062A \0627\0644\0645\062D\0644\064A'),
  ('date_format',              '"YYYY/MM/DD"',    U&'\0635\064A\063A\0629 \0639\0631\0636 \0627\0644\062A\0627\0631\064A\062E');

-- Phase 8 hardening (safe to run more than once).
-- Functions created after the general revoke in 0003 kept the default EXECUTE grant for anon/public.
-- They are harmless (trigger functions cannot be called directly; can_see_attachment returns false
-- for anon), but nothing in public should be callable by a signed-out visitor.
revoke execute on function public.can_see_attachment(text), public.trg_protect_admin(), public.trg_protect_grant() from public, anon;
grant execute on function public.can_see_attachment(text) to authenticated;
-- Re-assert: signed-out visitors have no access to any table, view, sequence or function in public.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
-- Future objects created by migrations will not be granted to anon automatically.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
-- Supabase grants ALL (incl. DELETE and TRUNCATE) on new tables to authenticated by default.
-- Records are never deleted in this system (archive only), so remove those rights at the privilege level too
-- (RLS already blocks row deletes; TRUNCATE is not covered by RLS, so it is revoked explicitly).
revoke delete, truncate, references, trigger on all tables in schema public from authenticated;
grant delete on public.user_permissions to authenticated;
revoke insert, update on public.audit_log from authenticated;
revoke insert, update, delete, truncate, references, trigger on
  public.v_vehicle_authorization, public.v_document_status, public.v_vehicle_oil_status,
  public.v_vehicles_overview, public.v_expenses, public.v_followups from authenticated;
alter default privileges in schema public revoke delete, truncate, references, trigger on tables from authenticated;
select 'HARDENING_OK' as result;

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

-- =====================================================================
-- 0012: vehicle insurance in the documents and alerts.
-- The insurance expiry date (vehicles.insurance_expiry, added in 0010) now appears in v_document_status,
-- so it shows in the documents page, the bell, the dashboard tasks, the reports and the nearest-document column.
-- Insurance status: valid / expiring (30 days or less) / expired; alert levels 30, 15, 7 and 1 day(s).
-- Only the view is replaced (same columns); no table or data is changed. ASCII only. Safe to run more than once.
-- =====================================================================
alter table vehicles add column if not exists insurance_expiry date;

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
    when expiry_date - app_today() <= (case when doc_type = 'insurance' then 30 else (doc_alert_days())[1] end) then 'expiring'
    else 'valid'
  end as status,
  -- alert level: the smallest period that includes the days left (insurance: 30 / 15 / 7 / 1)
  (select min(x) from unnest(case when doc_type = 'insurance' then array[30, 15, 7, 1] else doc_alert_days() end) x
    where expiry_date is not null and expiry_date >= app_today() and expiry_date - app_today() <= x) as alert_level
from docs;

revoke all on v_document_status from anon;
revoke insert, update, delete, truncate, references, trigger on v_document_status from authenticated;
grant select on v_document_status to authenticated;

select 'INSURANCE_ALERTS_OK' as result;

-- =====================================================================
-- 0013: vehicle data management.
--  * extra fields defined in the settings (values in vehicles.custom_fields; definitions in app_settings)
--  * "delete card to the log": the vehicle is archived (never deleted) with who / when / why; its alerts stop
--  * archived vehicles log + restore of the same card (same ID, all records)
--  * full change history per vehicle (from the audit log) with an optional reason per edit
-- Adds columns / views / functions only; no data is changed or removed. ASCII only. Safe to run more than once.
-- =====================================================================
alter table vehicles add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table vehicles add column if not exists deleted_by    uuid;
alter table vehicles add column if not exists delete_reason text;
alter table vehicles add column if not exists restored_at   timestamptz;
alter table vehicles add column if not exists restored_by   uuid;
alter table vehicles add column if not exists change_note   text;   -- optional reason written with an edit (kept in the history)

-- name of a user for history lists (profiles are otherwise only visible to admins)
create or replace function user_display_name(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p is null then null else coalesce((select coalesce(nullif(full_name, ''), email) from profiles where user_id = p), 'user') end
$$;
revoke execute on function user_display_name(uuid) from public, anon;
grant execute on function user_display_name(uuid) to authenticated;

-- vehicles overview again (v.* now includes the new columns)
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

-- every vehicle, active or archived (archived log, opening an archived card)
drop view if exists v_vehicles_archive;
create view v_vehicles_archive with (security_invoker = true) as
select
  v.*,
  user_display_name(v.deleted_by) as deleted_by_name,
  user_display_name(v.restored_by) as restored_by_name,
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
;

revoke all on v_vehicles_archive from anon;
revoke insert, update, delete, truncate, references, trigger on v_vehicles_archive from authenticated;
grant select on v_vehicles_archive to authenticated;

-- alerts stop for archived vehicles (documents, insurance and oil already skip them; now accidents and requests too)
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
where a.deleted_at is null and v.deleted_at is null and a.status <> 'completed'
union all
select 'maintenance_request', r.id, r.request_no || U&' \2014 ' || coalesce(nullif(r.plate_no, ''), r.equipment_text, ''),
       'maintenance_request', r.status, r.site_id, r.company_id,
       r.request_date, app_today() - r.request_date, null,
       case when r.status in ('new','pending_supervisor') then 1 else 2 end
from maintenance_requests r
where r.deleted_at is null and r.status in ('new','pending_supervisor','approved','in_progress')
  and (r.vehicle_id is null or exists (select 1 from vehicles vv where vv.id = r.vehicle_id and vv.deleted_at is null));
grant select on v_followups to authenticated;

-- move a card to the archived log (nothing is deleted)
create or replace function archive_vehicle(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r vehicles%rowtype;
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into r from vehicles where id = p_id for update;
  if not found then raise exception 'VEHICLE_NOT_FOUND'; end if;
  if r.deleted_at is not null then raise exception 'VEHICLE_ALREADY_ARCHIVED'; end if;
  update vehicles set deleted_at = now(), deleted_by = auth.uid(), delete_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         change_note = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'card moved to the archived log')
   where id = p_id returning * into r;
  return jsonb_build_object('id', r.id, 'code', r.code, 'deleted_at', r.deleted_at);
end $$;

-- bring the same card back (same ID, all its records)
create or replace function restore_vehicle(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r vehicles%rowtype;
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into r from vehicles where id = p_id for update;
  if not found then raise exception 'VEHICLE_NOT_FOUND'; end if;
  if r.deleted_at is null then raise exception 'VEHICLE_NOT_ARCHIVED'; end if;
  if exists (select 1 from vehicles v where v.id <> p_id and v.deleted_at is null and v.plate_no = r.plate_no) then
    raise exception 'RESTORE_PLATE_CONFLICT: another active vehicle uses plate %', r.plate_no;
  end if;
  if r.vin is not null and exists (select 1 from vehicles v where v.id <> p_id and v.deleted_at is null and v.vin = r.vin) then
    raise exception 'RESTORE_VIN_CONFLICT: another active vehicle uses VIN %', r.vin;
  end if;
  update vehicles set deleted_at = null, restored_at = now(), restored_by = auth.uid(),
         change_note = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'card restored from the archived log')
   where id = p_id returning * into r;
  return jsonb_build_object('id', r.id, 'code', r.code, 'restored_at', r.restored_at);
end $$;

-- the complete change history of one vehicle (card, protected IDs, its documents), newest first.
-- sensitive values are never returned (vehicle_private is logged without numbers).
create or replace function vehicle_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not has_perm('view') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'table', a.table_name, 'action', a.action, 'at', a.changed_at,
             'by', user_display_name(a.changed_by), 'changes', a.changes, 'old', a.old_data, 'new', a.new_data) order by a.changed_at desc, a.id desc)
    from audit_log a
    where (a.table_name in ('vehicles', 'vehicle_private') and a.record_id = p_id::text)
       or (a.table_name = 'documents' and (a.old_data->>'vehicle_id' = p_id::text or a.new_data->>'vehicle_id' = p_id::text))
  ), '[]'::jsonb);
end $$;

revoke execute on function archive_vehicle(uuid, text), restore_vehicle(uuid, text), vehicle_history(uuid) from public, anon;
grant execute on function archive_vehicle(uuid, text), restore_vehicle(uuid, text), vehicle_history(uuid) to authenticated;

insert into app_settings(key, value, description)
values ('vehicle_fields_config', '{"labels": {}, "options": {}, "custom": []}'::jsonb, 'vehicle card: field names, lists and extra fields')
on conflict (key) do nothing;

select 'VEHICLE_MANAGEMENT_OK' as result;

-- 0014 keep-alive: a daily automatic visit (GitHub Actions) so the free Supabase project is never paused for inactivity.
-- keepalive() reads no table and returns only the word 'ok'. It is the ONLY public function a signed-out visitor may call.
create or replace function public.keepalive() returns text
language sql stable set search_path = public as $$ select 'ok'::text $$;

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

select 'KEEPALIVE_OK' as result;

-- =====================================================================
-- 0015: Deleting a maintenance request moves it to an archived log (nothing is ever removed).
-- The request keeps its number, content, attachments, linked invoice and full audit history,
-- disappears from lists, alerts and reports, and can be restored as it was.
-- ASCII only. Safe to run more than once. Adds columns and functions only; no data is changed.
-- =====================================================================

alter table maintenance_requests add column if not exists deleted_by    uuid;
alter table maintenance_requests add column if not exists delete_reason text;
alter table maintenance_requests add column if not exists restored_at   timestamptz;
alter table maintenance_requests add column if not exists restored_by   uuid;
alter table maintenance_requests add column if not exists restore_note  text;

-- move a request to the archived log
create or replace function archive_request(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r maintenance_requests%rowtype;
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into r from maintenance_requests where id = p_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.deleted_at is not null then raise exception 'REQUEST_ALREADY_ARCHIVED'; end if;
  update maintenance_requests
     set deleted_at = now(), deleted_by = auth.uid(), delete_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id returning * into r;
  return jsonb_build_object('id', r.id, 'request_no', r.request_no, 'deleted_at', r.deleted_at);
end $$;

-- bring the same request back (same number, status and records)
create or replace function restore_request(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r maintenance_requests%rowtype;
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into r from maintenance_requests where id = p_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.deleted_at is null then raise exception 'REQUEST_NOT_ARCHIVED'; end if;
  update maintenance_requests
     set deleted_at = null, restored_at = now(), restored_by = auth.uid(), restore_note = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id returning * into r;
  return jsonb_build_object('id', r.id, 'request_no', r.request_no, 'restored_at', r.restored_at);
end $$;

revoke execute on function archive_request(uuid, text), restore_request(uuid, text) from public, anon;
grant execute on function archive_request(uuid, text), restore_request(uuid, text) to authenticated;

-- the archived log (with the names of who deleted / restored)
drop view if exists v_requests_archive;
create view v_requests_archive with (security_invoker = true) as
select r.*,
  user_display_name(r.deleted_by)  as deleted_by_name,
  user_display_name(r.restored_by) as restored_by_name,
  s.name as site_name,
  c.name as company_name,
  v.code as vehicle_code
from maintenance_requests r
left join sites s on s.id = r.site_id
left join companies c on c.id = r.company_id
left join vehicles v on v.id = r.vehicle_id;

revoke all on v_requests_archive from anon;
revoke insert, update, delete, truncate, references, trigger on v_requests_archive from authenticated;
grant select on v_requests_archive to authenticated;

select 'REQUEST_ARCHIVE_OK' as result;

-- =====================================================================
-- 0016: authorization on the vehicle card (section 3, under the current user).
-- vehicles.card_auth_status ('authorized' / 'not_authorized') and vehicles.card_auth_expiry (date).
-- Authorized cards appear in v_document_status as 'vehicle_authorization', so they show in the documents
-- page, the bell, the dashboard tasks and the vehicle file: expired / expiring (setting vehicle_auth_alert_days,
-- default 30) / no date. A card marked not authorized is never an alert.
-- Adds two nullable columns, one setting and one function; replaces one view with the same columns.
-- No existing data is changed. ASCII only. Safe to run more than once.
-- =====================================================================
alter table vehicles add column if not exists card_auth_status text;
alter table vehicles add column if not exists card_auth_expiry date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_card_auth_status_check') then
    alter table vehicles add constraint vehicles_card_auth_status_check check (card_auth_status in ('authorized', 'not_authorized'));
  end if;
end $$;

insert into app_settings(key, value, description)
values ('vehicle_auth_alert_days', '30'::jsonb, 'days before the vehicle authorization expiry to alert')
on conflict (key) do nothing;

create or replace function vehicle_auth_alert_days() returns int
language sql stable security definer set search_path = public as $$
  select greatest(1, least(365, setting_int('vehicle_auth_alert_days', 30)))
$$;
revoke execute on function vehicle_auth_alert_days() from public, anon;
grant execute on function vehicle_auth_alert_days() to authenticated;

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


select 'VEHICLE_AUTH_OK' as result;


-- =====================================================================
-- 0017: vehicle owners are kept apart from the main companies.
-- companies.is_vehicle_owner = true marks a name typed in the vehicle card field "owner" (a registered owner
-- such as a leasing company). These rows stay in the companies table (vehicles keep pointing to them),
-- but the page "companies and sites" lists only the main companies (is_vehicle_owner = false).
-- ensure_owner(name): finds a company/owner by name, or registers it as a vehicle owner.
-- Adds one column (default false) and one function. No existing data is changed. ASCII only. Safe to run again.
-- =====================================================================
alter table companies add column if not exists is_vehicle_owner boolean not null default false;

create or replace function ensure_owner(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); cid uuid;
begin
  if n = '' then return null; end if;
  if not (has_perm('create') or has_perm('edit')) then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select id into cid from companies where lower(btrim(name)) = lower(n) limit 1;
  if cid is null then
    insert into companies(name, is_vehicle_owner) values (n, true) returning id into cid;
  end if;
  return cid;
end $$;
revoke execute on function ensure_owner(text) from public, anon;
grant execute on function ensure_owner(text) to authenticated;

select 'VEHICLE_OWNERS_OK' as result;
