-- =====================================================================
-- المرحلة الأولى — الملف 2: الدوال والمشغلات (Triggers) والحسابات والعروض
-- =====================================================================

-- ---------------------------------------------------------------------
-- دوال مساعدة: التاريخ والتوقيت والتنسيق
-- ---------------------------------------------------------------------

-- تاريخ اليوم بتوقيت السعودية (لا يتأثر بتوقيت الخادم)
create or replace function app_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- عرض التاريخ بصيغة YYYY/MM/DD
create or replace function fmt_date(d date) returns text
language sql immutable as $$ select to_char(d, 'YYYY/MM/DD') $$;

-- عرض التاريخ والوقت بصيغة YYYY/MM/DD HH:mm بتوقيت الرياض
create or replace function fmt_datetime(t timestamptz) returns text
language sql stable as $$ select to_char(t at time zone 'Asia/Riyadh', 'YYYY/MM/DD HH24:MI') $$;

-- قراءة تاريخ مُدخل بصيغة YYYY/MM/DD أو YYYY-MM-DD مع رفض التواريخ غير الصحيحة
create or replace function parse_app_date(s text) returns date
language plpgsql immutable as $$
declare d date; t text := btrim(s);
begin
  if t is null or t = '' then return null; end if;
  -- تحويل الأرقام العربية الهندية إلى غربية
  t := translate(t, '٠١٢٣٤٥٦٧٨٩', '0123456789');
  if t !~ '^[0-9]{4}[/-][0-9]{2}[/-][0-9]{2}$' then
    raise exception 'INVALID_DATE_FORMAT: % (expected YYYY/MM/DD)', s using errcode = '22007';
  end if;
  begin
    d := replace(t, '/', '-')::date;
  exception when others then
    d := null;
  end;
  -- نتحقق أيضاً أن التاريخ لم "يُصحَّح" تلقائياً إلى يوم آخر
  if d is null or to_char(d, 'YYYY-MM-DD') <> replace(t, '/', '-') then
    raise exception 'INVALID_DATE: % does not exist in the calendar', s using errcode = '22008';
  end if;
  return d;
end $$;

-- ---------------------------------------------------------------------
-- المستخدم الحالي والصلاحيات
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- الإعدادات
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- مشغلات عامة
-- ---------------------------------------------------------------------
create or replace function trg_set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- منع الحذف الفعلي: السجلات تُؤرشف عبر deleted_at للحفاظ على التاريخ
create or replace function trg_block_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'DELETE_NOT_ALLOWED: records in % cannot be deleted; archive instead', tg_table_name
    using errcode = '42501';
end $$;

-- سجل التدقيق العام
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
    if diff = '{}'::jsonb then return new; end if;   -- لا تغيير فعلي
    if diff ? 'deleted_at' then
      act := case when n ->> 'deleted_at' is null then 'RESTORE' else 'ARCHIVE' end;
    end if;
  end if;

  rid := coalesce(n, o) ->> (case when coalesce(n, o) ? 'id' then 'id'
                                   when coalesce(n, o) ? 'employee_id' then 'employee_id'
                                   when coalesce(n, o) ? 'user_id' then 'user_id'
                                   else 'key' end);

  -- لا نخزن القيم الحساسة نصاً كاملاً في سجل التدقيق
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

-- ---------------------------------------------------------------------
-- المواقع: الاحتفاظ بتاريخ تغيير الاسم أو الشركة التابع لها
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- السيارات: حماية العداد + السجل التاريخي + فترات المسؤولية
-- ---------------------------------------------------------------------
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

  -- السجل التاريخي للحقول المهمة
  foreach f in array array['current_driver_id','site_id','owner_company_id','op_status','location_status','plate_no'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into ov, nv using old, new;
    if ov is distinct from nv then
      insert into vehicle_field_history(vehicle_id, field, old_value, new_value, old_label, new_label, changed_by)
      values (new.id, f, ov, nv, vehicle_ref_label(f, ov), vehicle_ref_label(f, nv), auth.uid());
    end if;
  end loop;

  -- فترات المسؤولية: إغلاق السابقة وفتح الجديدة دون حذف أي شيء
  if new.current_driver_id is distinct from old.current_driver_id then
    update vehicle_assignments set end_at = now()
     where vehicle_id = new.id and end_at is null;
    if new.current_driver_id is not null then
      insert into vehicle_assignments(vehicle_id, employee_id, handover_id)
      values (new.id, new.current_driver_id, ho);
    end if;
  end if;

  -- توثيق قراءة العداد
  if new.odometer is distinct from old.odometer then
    insert into odometer_readings(vehicle_id, reading, source, reason, created_by)
    values (new.id, new.odometer, src, nullif(current_setting('app.odometer_reason', true), ''), auth.uid());
  end if;
  return new;
end $$;

-- تحديث العداد من عملية (زيت/صيانة/حادث/تسليم): يرفع القراءة فقط إن كانت أعلى
create or replace function bump_odometer(p_vehicle uuid, p_reading int, p_source odometer_source) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_reading is null then return; end if;
  perform set_config('app.odometer_source', p_source::text, true);
  update vehicles set odometer = p_reading where id = p_vehicle and odometer < p_reading;
  perform set_config('app.odometer_source', '', true);
end $$;

-- تصحيح العداد بقراءة أقل — بعد تأكيد صريح من المستخدم وسبب مكتوب
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

-- ---------------------------------------------------------------------
-- لقطة الموقع والشركة المالكة وقت العملية (حتى تبقى تقارير المواقع صحيحة بعد نقل السيارة)
-- ---------------------------------------------------------------------
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

-- السكن والطعام: الشركة تُملأ من الموقع إن لم تُحدد
create or replace function trg_fill_company_from_site() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.company_id is null then
    select company_id into new.company_id from sites where id = new.site_id;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- الصيانة: إعادة احتساب الإجماليات من البنود
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- نماذج التسليم: تعبئة تلقائية + الاعتماد يحدّث المسؤول الحالي + قفل النموذج المعتمد
-- ---------------------------------------------------------------------
create or replace function trg_handover_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v vehicles%rowtype;
begin
  if tg_op = 'UPDATE' and old.state <> 'draft' then
    -- النموذج المعتمد/الملغى لا يُعدّل (يُسمح بالأرشفة فقط للمسؤول)
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

-- ---------------------------------------------------------------------
-- الملف الشخصي يُنشأ تلقائياً عند إنشاء مستخدم في Supabase Auth
-- أول مستخدم يُنشأ في النظام يصبح المسؤول (Admin) تلقائياً.
-- ---------------------------------------------------------------------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(user_id, email, full_name, is_admin)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
          not exists (select 1 from profiles where is_admin));
  return new;
end $$;

-- =====================================================================
-- ربط المشغلات
-- =====================================================================
do $$
declare t text;
begin
  -- updated_at
  foreach t in array array['companies','sites','employees','employee_private','vehicles','authorizations','documents',
                           'oil_changes','maintenance','accidents','handovers','housing_maintenance','food_supplies','profiles'] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function trg_set_updated_at()', t);
  end loop;

  -- منع الحذف الفعلي
  foreach t in array array['companies','sites','employees','employee_private','vehicles','vehicle_assignments','vehicle_field_history',
                           'odometer_readings','authorizations','documents','oil_changes','maintenance','maintenance_items',
                           'accidents','handovers','housing_maintenance','food_supplies','attachments','audit_log','site_history'] loop
    execute format('create trigger block_delete before delete on %I for each row execute function trg_block_delete()', t);
  end loop;

  -- سجل التدقيق
  foreach t in array array['companies','sites','employees','employee_private','vehicles','authorizations','documents',
                           'oil_changes','maintenance','maintenance_items','accidents','handovers','housing_maintenance',
                           'food_supplies','attachments','profiles','user_permissions','app_settings'] loop
    execute format('create trigger audit after insert or update or delete on %I for each row execute function trg_audit()', t);
  end loop;

  -- لقطة الموقع/الشركة وتحديث العداد
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

-- =====================================================================
-- العروض (Views) — تحترم صلاحيات المستخدم (security_invoker)
-- =====================================================================

-- حالة التفويض للسائق الحالي لكل سيارة (لا يُفترض أن السائق مفوّض تلقائياً)
create or replace view v_vehicle_authorization with (security_invoker = true) as
select
  v.id as vehicle_id,
  v.current_driver_id as employee_id,
  a.id as authorization_id,
  a.auth_no, a.issue_date, a.expiry_date, a.is_authorized,
  case when a.expiry_date is not null then a.expiry_date - app_today() end as days_left,
  case
    when v.current_driver_id is null then 'no_driver'
    when a.id is null               then 'missing'          -- غير متوفر
    when not a.is_authorized        then 'not_authorized'   -- غير مفوض
    when a.expiry_date is null      then 'no_date'          -- لا يوجد تاريخ مسجل
    when a.expiry_date < app_today() then 'expired'         -- منتهٍ
    else 'valid'                                            -- ساري
  end as status
from vehicles v
left join lateral (
  select * from authorizations x
  where x.vehicle_id = v.id and x.employee_id = v.current_driver_id and x.deleted_at is null
  order by x.expiry_date desc nulls last, x.created_at desc
  limit 1
) a on true
where v.deleted_at is null;

-- عرض موحّد لحالة كل الوثائق الحالية (آخر وثيقة لكل نوع) + الوثائق الناقصة
create or replace view v_document_status with (security_invoker = true) as
with req as (
  -- وثائق السيارة المطلوبة
  select 'vehicle'::text as owner_type, v.id as owner_id, t.dt::text as doc_type,
         v.code || ' — ' || v.plate_no as subject_label, v.site_id, s.company_id, v.owner_company_id
  from vehicles v
  left join sites s on s.id = v.site_id
  cross join (values ('registration'), ('periodic_inspection')) t(dt)
  where v.deleted_at is null
  union all
  -- الإقامة لكل موظف على رأس العمل، والرخصة لكل سائق حالي أو من سُجلت له رخصة
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
  -- التفويض للسائق الحالي
  select 'vehicle', v.id, 'authorization', v.code || ' — ' || v.plate_no, v.site_id, s.company_id, v.owner_company_id,
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
  -- مستوى التنبيه: أصغر فترة (90/60/30/7) تشمل الأيام المتبقية
  (select min(x) from unnest(doc_alert_days()) x
    where expiry_date is not null and expiry_date >= app_today() and expiry_date - app_today() <= x) as alert_level
from docs;

-- حالة تغيير الزيت لكل سيارة
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
    when o.next_odometer - v.odometer > setting_int('oil_warning_km', 1000) then 'not_due'   -- لم يحن
    when o.next_odometer - v.odometer > 0 then 'soon'                                        -- اقترب
    when o.next_odometer - v.odometer > -setting_int('oil_overdue_tolerance_km', 500) then 'due' -- حان
    else 'overdue'                                                                           -- تجاوز
  end as status
from vehicles v
left join lateral (
  select * from oil_changes x where x.vehicle_id = v.id and x.deleted_at is null
  order by x.odometer desc, x.change_date desc limit 1
) o on true
where v.deleted_at is null;

-- نظرة شاملة على السيارات (جدول صفحة السيارات)
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

-- كل المصروفات في عرض واحد (أساس التقارير الشهرية والسنوية)
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

-- المهام التي تحتاج إلى متابعة (لوحة التحكم ومركز التنبيهات)
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
select 'vehicle', o.vehicle_id, v.code || ' — ' || v.plate_no, 'oil_change', o.status, v.site_id, s.company_id,
       null, null, o.remaining_km,
       case when o.status in ('due','overdue') then 1 else 2 end
from v_vehicle_oil_status o
join vehicles v on v.id = o.vehicle_id
left join sites s on s.id = v.site_id
where o.status in ('soon','due','overdue')
union all
select 'vehicle', a.vehicle_id, v.code || ' — ' || v.plate_no, 'accident', a.status::text, a.site_id, s.company_id,
       (a.occurred_at at time zone 'Asia/Riyadh')::date, app_today() - (a.occurred_at at time zone 'Asia/Riyadh')::date, null, 2
from accidents a
join vehicles v on v.id = a.vehicle_id
left join sites s on s.id = a.site_id
where a.deleted_at is null and a.status <> 'completed';

-- =====================================================================
-- إحصاءات لوحة التحكم (مبنية على السجلات الفعلية مع فلاتر)
-- =====================================================================
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
