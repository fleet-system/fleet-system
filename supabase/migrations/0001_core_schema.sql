-- =====================================================================
-- نظام إدارة الأسطول والمواقع الزراعية
-- المرحلة الأولى — الملف 1: الجداول والعلاقات الأساسية
-- قاعدة البيانات: PostgreSQL (Supabase)
-- ملاحظات عامة:
--   * التواريخ تُخزَّن كنوع date (معياري YYYY-MM-DD) ويُرفض التاريخ غير الصحيح تلقائياً (مثل 2026-02-31).
--   * الأوقات تُخزَّن timestamptz وتُعرض بتوقيت Asia/Riyadh.
--   * المبالغ numeric(12,2) بالريال السعودي.
--   * لا يُحذف أي سجل تشغيلي حذفاً فعلياً؛ يُؤرشف عبر deleted_at.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- الأنواع (Enums)
-- ---------------------------------------------------------------------
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
  'view',            -- عرض البيانات
  'create',          -- إضافة السجلات
  'edit',            -- تعديل السجلات
  'invoices',        -- إدارة الفواتير والاطلاع على صورها
  'view_sensitive',  -- الاطلاع على أرقام الإقامات والجوالات وصور الوثائق الشخصية
  'export',          -- تصدير Excel
  'import',          -- استيراد Excel
  'manage_users',    -- إدارة المستخدمين
  'settings'         -- تعديل الإعدادات والشركات والمواقع
);

-- ---------------------------------------------------------------------
-- الإعدادات
-- ---------------------------------------------------------------------
create table app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ---------------------------------------------------------------------
-- المستخدمون والصلاحيات (مرتبطة بـ auth.users في Supabase)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- الشركات والمواقع
-- ---------------------------------------------------------------------
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
  company_id  uuid not null references companies(id),   -- الشركة التي يتبع لها الموقع
  name        text not null,
  kind        site_kind not null default 'farm',
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sites_name_unique unique (name)
);

-- سجل تغيّر تبعية الموقع للشركة أو اسمه (للحفاظ على التاريخ)
create table site_history (
  id          bigint generated always as identity primary key,
  site_id     uuid not null references sites(id),
  field       text not null,
  old_value   text,
  new_value   text,
  changed_at  timestamptz not null default now(),
  changed_by  uuid
);

-- ---------------------------------------------------------------------
-- الموظفون
-- ---------------------------------------------------------------------
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

-- البيانات الحساسة في جدول منفصل حتى لا يراها إلا المخوّل (view_sensitive)
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

-- ---------------------------------------------------------------------
-- السيارات
-- ---------------------------------------------------------------------
create sequence vehicle_code_seq;

create table vehicles (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique default ('VEH-' || lpad(nextval('vehicle_code_seq')::text, 4, '0')),
  plate_no             text not null,
  make                 text,                         -- الماركة
  vehicle_type         text,                         -- نوع السيارة (بيك أب، ونيت، باص...)
  model                text,                         -- الموديل
  manufacture_year     int check (manufacture_year between 1950 and 2100),
  color                text,
  vin                  text,                         -- رقم الهيكل
  engine_no            text,
  owner_company_id     uuid not null references companies(id),  -- الشركة المالكة (مستقلة عن الموقع)
  site_id              uuid references sites(id),               -- الموقع الذي تعمل فيه حالياً
  current_driver_id    uuid references employees(id),           -- السائق المسؤول حالياً
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

-- سجل تاريخي لكل تغيّر في السائق/الموقع/الشركة المالكة/الحالة/اللوحة
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

-- فترات مسؤولية الموظفين عن السيارات
create table vehicle_assignments (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references vehicles(id),
  employee_id  uuid not null references employees(id),
  start_at     timestamptz not null default now(),
  end_at       timestamptz,
  handover_id  uuid,   -- يُربط بنموذج التسليم (FK أدناه)
  notes        text,
  constraint assignment_period check (end_at is null or end_at >= start_at)
);
create unique index one_open_assignment_per_vehicle on vehicle_assignments(vehicle_id) where end_at is null;
create index on vehicle_assignments(employee_id);

-- قراءات العداد الموثقة
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

-- ---------------------------------------------------------------------
-- التفويضات
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- الوثائق (الإقامة، الرخصة، الاستمارة، الفحص الدوري)
-- التفويض له جدوله الخاص ويظهر ضمن عرض الوثائق الموحّد.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- تغيير الزيت
-- ---------------------------------------------------------------------
create sequence oil_no_seq;

create table oil_changes (
  id                 uuid primary key default gen_random_uuid(),
  oil_no             text not null unique default ('OIL-' || lpad(nextval('oil_no_seq')::text, 6, '0')),
  vehicle_id         uuid not null references vehicles(id),
  site_id            uuid references sites(id),        -- لقطة: موقع السيارة وقت العملية
  owner_company_id   uuid references companies(id),    -- لقطة: الشركة المالكة وقت العملية
  payer_company_id   uuid references companies(id),    -- الجهة التي دفعت الفاتورة
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

-- ---------------------------------------------------------------------
-- الصيانة الدورية والإصلاحات (رأس + بنود)
-- ---------------------------------------------------------------------
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
  maint_type         text not null,                 -- دورية، إصلاح، كهرباء، إطارات...
  fault_description  text,
  workshop           text,
  parts_cost         numeric(12,2) not null default 0,   -- يُحسب تلقائياً من البنود
  labor_cost         numeric(12,2) not null default 0,   -- يُحسب تلقائياً من البنود
  other_cost         numeric(12,2) not null default 0,   -- يُحسب تلقائياً من البنود
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

-- ---------------------------------------------------------------------
-- الحوادث
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- نماذج الاستلام والتسليم
-- ---------------------------------------------------------------------
create sequence handover_no_seq;

create table handovers (
  id                   uuid primary key default gen_random_uuid(),
  form_no              text not null unique default ('HO-' || lpad(nextval('handover_no_seq')::text, 6, '0')),
  kind                 handover_kind not null,
  company_id           uuid references companies(id),
  site_id              uuid references sites(id),
  vehicle_id           uuid not null references vehicles(id),
  from_employee_id     uuid references employees(id),   -- المسلِّم
  to_employee_id       uuid references employees(id),   -- المستلِم
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
  from_signature_path  text,   -- مسار صورة التوقيع في التخزين
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

-- ---------------------------------------------------------------------
-- صيانة سكن العمال
-- ---------------------------------------------------------------------
create sequence housing_no_seq;

create table housing_maintenance (
  id                uuid primary key default gen_random_uuid(),
  op_no             text not null unique default ('HSG-' || lpad(nextval('housing_no_seq')::text, 6, '0')),
  company_id        uuid references companies(id),   -- يُملأ تلقائياً من الموقع إن تُرك فارغاً
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

-- ---------------------------------------------------------------------
-- توريد الطعام
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- المرفقات (الصور والفواتير) — الملف نفسه في Supabase Storage
-- ---------------------------------------------------------------------
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
  -- حساسية الملف تُشتق من نوعه: الفواتير تتطلب صلاحية invoices، وصور الوثائق الشخصية تتطلب view_sensitive
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

-- ---------------------------------------------------------------------
-- سجل التدقيق
-- ---------------------------------------------------------------------
create table audit_log (
  id           bigint generated always as identity primary key,
  table_name   text not null,
  record_id    text,
  action       text not null check (action in ('INSERT','UPDATE','DELETE','ARCHIVE','RESTORE','IMPORT','LOGIN')),
  changed_by   uuid,
  changed_at   timestamptz not null default now(),
  old_data     jsonb,
  new_data     jsonb,
  changes      jsonb   -- الحقول التي تغيّرت فقط: {"field": {"old":..,"new":..}}
);
create index on audit_log(table_name, record_id);
create index on audit_log(changed_at desc);

-- ---------------------------------------------------------------------
-- دفعات استيراد Excel (للمعاينة قبل الاعتماد)
-- ---------------------------------------------------------------------
create table import_batches (
  id            uuid primary key default gen_random_uuid(),
  target_table  text not null,
  file_name     text,
  status        text not null default 'preview' check (status in ('preview','committed','cancelled')),
  summary       jsonb,       -- {new: n, updated: n, rejected: n, errors: [...]}
  created_at    timestamptz not null default now(),
  created_by    uuid,
  committed_at  timestamptz
);
