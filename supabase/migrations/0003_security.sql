-- =====================================================================
-- المرحلة الأولى — الملف 3: الصلاحيات وسياسات أمان الصفوف (RLS)
-- القاعدة: لا يرى أو يعدّل أحد شيئاً إلا بصلاحية صريحة. المسؤول (Admin) يملك كل الصلاحيات.
-- =====================================================================

-- الزائر غير المسجل لا يصل إلى أي شيء
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
grant delete on user_permissions to authenticated;   -- سحب صلاحية فقط؛ باقي الجداول لا تُحذف

-- تفعيل RLS على جميع الجداول
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- الجداول التشغيلية: عرض = view، إضافة = create، تعديل/أرشفة = edit
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['employees','vehicles','authorizations','documents','oil_changes','maintenance',
                           'maintenance_items','accidents','handovers','housing_maintenance','food_supplies'] loop
    execute format('create policy p_select on %I for select to authenticated using (has_perm(''view''))', t);
    execute format('create policy p_insert on %I for insert to authenticated with check (has_perm(''create''))', t);
    execute format('create policy p_update on %I for update to authenticated using (has_perm(''edit'')) with check (has_perm(''edit''))', t);
  end loop;

  -- السجلات التاريخية: قراءة فقط (تُكتب عبر المشغلات)
  foreach t in array array['vehicle_field_history','vehicle_assignments','odometer_readings','site_history'] loop
    execute format('create policy p_select on %I for select to authenticated using (has_perm(''view''))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- البيانات الحساسة للموظف (الإقامة، الجوال، الرخصة)
-- ---------------------------------------------------------------------
create policy p_select on employee_private for select to authenticated
  using (has_perm('view_sensitive'));
create policy p_insert on employee_private for insert to authenticated
  with check (has_perm('create') and has_perm('view_sensitive'));
create policy p_update on employee_private for update to authenticated
  using (has_perm('edit') and has_perm('view_sensitive'))
  with check (has_perm('edit') and has_perm('view_sensitive'));

-- ---------------------------------------------------------------------
-- المرفقات: الفواتير تتطلب invoices، وصور الوثائق الشخصية تتطلب view_sensitive
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- الشركات والمواقع والإعدادات: التعديل لمن يملك settings
-- ---------------------------------------------------------------------
create policy p_select on companies    for select to authenticated using (has_perm('view'));
create policy p_insert on companies    for insert to authenticated with check (has_perm('settings'));
create policy p_update on companies    for update to authenticated using (has_perm('settings')) with check (has_perm('settings'));
create policy p_select on sites        for select to authenticated using (has_perm('view'));
create policy p_insert on sites        for insert to authenticated with check (has_perm('settings'));
create policy p_update on sites        for update to authenticated using (has_perm('settings')) with check (has_perm('settings'));
create policy p_select on app_settings for select to authenticated using (has_perm('view'));
create policy p_insert on app_settings for insert to authenticated with check (has_perm('settings'));
create policy p_update on app_settings for update to authenticated using (has_perm('settings')) with check (has_perm('settings'));

-- ---------------------------------------------------------------------
-- المستخدمون والصلاحيات
-- ---------------------------------------------------------------------
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

-- لا يمنح صفة المسؤول أو يسحبها إلا مسؤول، ولا يمكن تعطيل آخر مسؤول نشط
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

-- صلاحية manage_users لا تكفي لمنح manage_users لغيره؛ هذا للمسؤول فقط
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

-- ---------------------------------------------------------------------
-- سجل التدقيق: قراءة فقط للمسؤول ومدير المستخدمين، ولا يُعدّل أبداً
-- ---------------------------------------------------------------------
create policy p_select on audit_log for select to authenticated
  using (is_admin() or has_perm('manage_users'));
revoke insert, update on audit_log from authenticated;

-- ---------------------------------------------------------------------
-- دفعات الاستيراد
-- ---------------------------------------------------------------------
create policy p_select on import_batches for select to authenticated using (has_perm('import'));
create policy p_insert on import_batches for insert to authenticated with check (has_perm('import'));
create policy p_update on import_batches for update to authenticated using (has_perm('import')) with check (has_perm('import'));

-- العروض
grant select on v_vehicle_authorization, v_document_status, v_vehicle_oil_status,
                v_vehicles_overview, v_expenses, v_followups to authenticated;

-- الدوال المتاحة للتطبيق
grant execute on function app_today(), fmt_date(date), fmt_datetime(timestamptz), parse_app_date(text),
                         has_perm(app_permission), is_admin(), correct_odometer(uuid, int, text),
                         dashboard_stats(uuid, uuid, int, int), can_see_attachment(text),
                         setting_int(text, int), doc_alert_days(), current_uid()
  to authenticated;
-- الدوال الداخلية لا تُستدعى مباشرة من التطبيق
revoke execute on function bump_odometer(uuid, int, odometer_source), recalc_maintenance(uuid) from public, authenticated;
