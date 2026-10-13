-- =====================================================================
-- اختبارات المرحلة الأولى — بيانات وهمية بالكامل (لا بيانات شخصية حقيقية)
-- كل اختبار يطبع PASS، وأي فشل يوقف التشغيل فوراً.
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema tst;
grant usage on schema tst to authenticated;

create function tst.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;

-- يتوقع أن يفشل الأمر برسالة تحتوي النمط المحدد
create function tst.fails(cmd text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute cmd;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then raise notice 'PASS: % (رُفض: %)', msg, left(sqlerrm, 90); return; end if;
    raise exception 'FAIL: % — خطأ غير متوقع: %', msg, sqlerrm;
  end;
  raise exception 'FAIL: % — نُفّذ الأمر ولم يُرفض', msg;
end $$;
grant execute on all functions in schema tst to authenticated;

-- ---------------------------------------------------------------------
\echo '== 1) البيانات الأساسية'
select tst.ok((select count(*) from companies) = 2, 'شركتان مسجلتان');
select tst.ok((select count(*) from sites) = 4, '4 مواقع مسجلة');
select tst.ok((select count(*) from sites s join companies c on c.id = s.company_id
               where c.name = 'شركة روى الرمال الزراعية') = 3, '3 مزارع تابعة لشركة روى الرمال');
select tst.ok((select c.name from sites s join companies c on c.id = s.company_id where s.name = 'مشتل الغملاس')
              = 'شركة عبد الرحمن الفهاد', 'مشتل الغملاس تابع لشركة عبد الرحمن الفهاد');

-- ---------------------------------------------------------------------
\echo '== 2) المستخدمون: أول مستخدم يصبح مسؤولاً'
insert into auth.users(id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-000000000001', 'admin@test.local',  '{"full_name":"مسؤول تجريبي"}'),
 ('a0000000-0000-0000-0000-000000000002', 'viewer@test.local', '{"full_name":"مستخدم عرض"}'),
 ('a0000000-0000-0000-0000-000000000003', 'clerk@test.local',  '{"full_name":"مدخل بيانات"}'),
 ('a0000000-0000-0000-0000-000000000004', 'acct@test.local',   '{"full_name":"محاسب"}');
select tst.ok((select is_admin from profiles where email = 'admin@test.local'), 'المستخدم الأول مسؤول');
select tst.ok((select count(*) from profiles where is_admin) = 1, 'باقي المستخدمين ليسوا مسؤولين');

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
insert into user_permissions(user_id, permission) values
 ('a0000000-0000-0000-0000-000000000002', 'view'),
 ('a0000000-0000-0000-0000-000000000003', 'view'), ('a0000000-0000-0000-0000-000000000003', 'create'),
 ('a0000000-0000-0000-0000-000000000003', 'edit'),
 ('a0000000-0000-0000-0000-000000000004', 'view'), ('a0000000-0000-0000-0000-000000000004', 'invoices');

-- ---------------------------------------------------------------------
\echo '== 3) التواريخ: الصيغة والتحقق'
select tst.ok(fmt_date('2026-10-12') = '2026/10/12', 'عرض التاريخ YYYY/MM/DD');
select tst.ok(fmt_date('2026-01-05') = '2026/01/05', 'الشهر واليوم برقمين');
select tst.ok(fmt_datetime('2026-10-12 11:30:00+00') = '2026/10/12 14:30', 'الوقت بتوقيت الرياض HH:mm');
select tst.ok(fmt_datetime('2026-10-12 22:30:00+00') = '2026/10/13 01:30', 'التاريخ يتبع توقيت الرياض لا UTC');
select tst.ok(parse_app_date('2026/09/30') = '2026-09-30', 'قراءة تاريخ مُدخل بالشرطة المائلة');
select tst.ok(parse_app_date('٢٠٢٦/١٢/٣١') = '2026-12-31', 'قراءة تاريخ بأرقام عربية وتحويلها');
select tst.fails($$select parse_app_date('2026/02/31')$$, 'INVALID_DATE', 'رفض 2026/02/31');
select tst.fails($$select parse_app_date('12/10/2026')$$, 'INVALID_DATE_FORMAT', 'رفض صيغة غير YYYY/MM/DD');
select tst.fails($$select '2026-02-31'::date$$, 'out of range', 'قاعدة البيانات نفسها ترفض 2026-02-31');

-- ---------------------------------------------------------------------
\echo '== 4) إدخال بيانات وهمية كمستخدم مدخل بيانات (RLS مفعّل)'
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';

insert into employees(id, full_name, company_id, site_id, job_title) values
 ('e0000000-0000-0000-0000-000000000001', 'موظف تجريبي أ',
   '11111111-1111-1111-1111-111111111111', (select id from sites where name = 'مزرعة الغملاس'), 'سائق'),
 ('e0000000-0000-0000-0000-000000000002', 'موظف تجريبي ب',
   '11111111-1111-1111-1111-111111111111', (select id from sites where name = 'مزرعة البركة'), 'سائق');
select tst.ok((select code from employees where id = 'e0000000-0000-0000-0000-000000000001') = 'EMP-0001', 'رقم داخلي تلقائي للموظف EMP-0001');

-- السيارة مملوكة لشركة الفهاد لكنها تعمل في مزرعة تابعة لروى الرمال (فصل الملكية عن الموقع)
insert into vehicles(id, plate_no, make, vehicle_type, model, manufacture_year, owner_company_id, site_id, current_driver_id)
values ('b0000000-0000-0000-0000-000000000001', 'ا ب ج 1234', 'تويوتا', 'بيك أب', 'هايلكس', 2022,
        '22222222-2222-2222-2222-222222222222', (select id from sites where name = 'مزرعة الغملاس'),
        'e0000000-0000-0000-0000-000000000001');
select tst.ok((select code from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = 'VEH-0001', 'رقم داخلي تلقائي للسيارة VEH-0001');
select tst.ok((select owner_company_name <> site_company_name from v_vehicles_overview
               where id = 'b0000000-0000-0000-0000-000000000001'), 'الشركة المالكة مستقلة عن شركة الموقع');
select tst.ok((select oil_interval_km from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = 10000, 'فترة الزيت الافتراضية 10,000 كم');
select tst.ok((select count(*) from vehicle_assignments where vehicle_id = 'b0000000-0000-0000-0000-000000000001' and end_at is null) = 1,
              'فُتحت فترة مسؤولية للسائق الأول');
select tst.fails($$insert into vehicles(plate_no, owner_company_id) values ('ا ب ج 1234', '11111111-1111-1111-1111-111111111111')$$,
                 'duplicate', 'رفض تكرار رقم اللوحة');

-- ---------------------------------------------------------------------
\echo '== 5) تغيير الزيت والعداد'
insert into oil_changes(vehicle_id, change_date, odometer, oil_cost, filter_cost, extra_cost, workshop, oil_type)
values ('b0000000-0000-0000-0000-000000000001', '2026-10-01', 50000, 120.50, 35, 15, 'ورشة تجريبية', '5W-30');
select tst.ok((select odometer from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = 50000, 'العداد ارتفع تلقائياً إلى قراءة تغيير الزيت');
select tst.ok((select next_odometer from v_vehicle_oil_status where vehicle_id = 'b0000000-0000-0000-0000-000000000001') = 60000,
              'القراءة القادمة = 50,000 + 10,000 = 60,000');
select tst.ok((select total from oil_changes limit 1) = 170.50, 'إجمالي الزيت = 120.50 + 35 + 15 = 170.50');
select tst.ok((select site_id from oil_changes limit 1) = (select id from sites where name = 'مزرعة الغملاس'), 'حُفظت لقطة الموقع وقت العملية');

update vehicles set odometer = 55000 where id = 'b0000000-0000-0000-0000-000000000001';
select tst.ok((select status = 'not_due' and remaining_km = 5000 from v_vehicle_oil_status), 'متبقٍ 5,000 كم ⇒ لم يحن موعد التغيير');
update vehicles set odometer = 59200 where id = 'b0000000-0000-0000-0000-000000000001';
select tst.ok((select status = 'soon' and remaining_km = 800 from v_vehicle_oil_status), 'متبقٍ 800 كم ⇒ اقترب موعد التغيير');
update vehicles set odometer = 60000 where id = 'b0000000-0000-0000-0000-000000000001';
select tst.ok((select status = 'due' and remaining_km = 0 from v_vehicle_oil_status), 'متبقٍ 0 كم ⇒ حان موعد التغيير');
update vehicles set odometer = 60700 where id = 'b0000000-0000-0000-0000-000000000001';
select tst.ok((select status = 'overdue' and remaining_km = -700 from v_vehicle_oil_status), 'تجاوز بـ 700 كم ⇒ تجاوز موعد التغيير');

select tst.fails($$update vehicles set odometer = 40000 where id = 'b0000000-0000-0000-0000-000000000001'$$,
                 'ODOMETER_DECREASE', 'رفض قراءة أقل من آخر قراءة دون تأكيد');
select tst.fails($$update vehicles set odometer = -5 where id = 'b0000000-0000-0000-0000-000000000001'$$,
                 'ODOMETER_NEGATIVE', 'رفض القراءة السالبة');
select tst.fails($$select correct_odometer('b0000000-0000-0000-0000-000000000001', 60500, '')$$,
                 'REASON_REQUIRED', 'التصحيح يتطلب سبباً مكتوباً');
select correct_odometer('b0000000-0000-0000-0000-000000000001', 60500, 'خطأ إدخال سابق');
select tst.ok((select odometer from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = 60500, 'التصحيح المؤكد قُبل');
select tst.ok((select source = 'correction' and reason = 'خطأ إدخال سابق' from odometer_readings
               where vehicle_id = 'b0000000-0000-0000-0000-000000000001' order by id desc limit 1), 'التصحيح موثق مع سببه في سجل العداد');
select tst.ok((select count(*) from odometer_readings where vehicle_id = 'b0000000-0000-0000-0000-000000000001') >= 6, 'كل قراءات العداد محفوظة');

insert into oil_changes(vehicle_id, change_date, odometer, oil_cost) values ('b0000000-0000-0000-0000-000000000001', '2026-10-10', 60500, 130);
select tst.ok((select count(*) from oil_changes) = 2, 'تغيير زيت جديد = سجل جديد والسابق محفوظ');
select tst.ok((select next_odometer = 70500 and status = 'not_due' from v_vehicle_oil_status), 'الموعد القادم يُحسب من آخر تغيير (70,500)');

-- ---------------------------------------------------------------------
\echo '== 6) الصيانة بعدة بنود'
insert into maintenance(id, vehicle_id, maint_date, odometer, maint_type, workshop, vat_amount)
values ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '2026-10-05', 58000, 'إصلاح فرامل', 'ورشة تجريبية', 0);
insert into maintenance_items(maintenance_id, kind, description, quantity, unit_price) values
 ('c0000000-0000-0000-0000-000000000001', 'part',  'فحمات أمامية', 2, 150),
 ('c0000000-0000-0000-0000-000000000001', 'part',  'زيت فرامل',    1, 45.25),
 ('c0000000-0000-0000-0000-000000000001', 'labor', 'أجور تركيب',   1, 100);
update maintenance set vat_amount = round(subtotal * 0.15, 2) where id = 'c0000000-0000-0000-0000-000000000001';
select tst.ok((select parts_cost = 345.25 and labor_cost = 100 and subtotal = 445.25 and vat_amount = 66.79 and total = 512.04
               from maintenance), 'قطع 345.25 + عمل 100 = 445.25 + ضريبة 66.79 = 512.04');
select tst.ok((select odometer from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = 60500,
              'صيانة بقراءة قديمة لا تُنقص العداد الحالي');

-- ---------------------------------------------------------------------
\echo '== 7) الوثائق والتفويض'
insert into documents(doc_type, vehicle_id, doc_no, expiry_date) values
 ('registration',        'b0000000-0000-0000-0000-000000000001', 'R-1', app_today() + 20),
 ('periodic_inspection', 'b0000000-0000-0000-0000-000000000001', 'P-1', app_today() - 3);
insert into documents(doc_type, employee_id, doc_no, expiry_date) values
 ('iqama', 'e0000000-0000-0000-0000-000000000001', null, null),
 ('driving_license', 'e0000000-0000-0000-0000-000000000001', 'L-1', app_today() + 200);
insert into authorizations(vehicle_id, employee_id, auth_no, expiry_date)
values ('b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'T-1', app_today() + 100);

select tst.ok((select status = 'expiring' and days_left = 20 and alert_level = 30 from v_document_status where doc_type = 'registration'),
              'الاستمارة: متبقٍ 20 يوماً ⇒ اقتربت من الانتهاء (تنبيه 30)');
select tst.ok((select status = 'expired' and days_left = -3 from v_document_status where doc_type = 'periodic_inspection'), 'الفحص: منتهٍ منذ 3 أيام');
select tst.ok((select status = 'no_date' from v_document_status where doc_type = 'iqama' and owner_id = 'e0000000-0000-0000-0000-000000000001'),
              'إقامة بلا تاريخ ⇒ "لا يوجد تاريخ مسجل" وليست سارية');
select tst.ok((select status = 'missing' from v_document_status where doc_type = 'iqama' and owner_id = 'e0000000-0000-0000-0000-000000000002'),
              'إقامة غير مسجلة إطلاقاً ⇒ ناقصة');
select tst.ok((select status = 'valid' from v_document_status where doc_type = 'driving_license'), 'رخصة بعد 200 يوم ⇒ سارية');
select tst.ok((select authorization_status = 'valid' from v_vehicles_overview), 'السائق الحالي مفوّض والتفويض ساري');

-- ---------------------------------------------------------------------
\echo '== 8) نموذج التسليم ينقل المسؤولية ويحفظ التاريخ'
insert into handovers(id, kind, vehicle_id, to_employee_id, odometer, fuel_level, body_condition)
values ('d0000000-0000-0000-0000-000000000001', 'deliver', 'b0000000-0000-0000-0000-000000000001',
        'e0000000-0000-0000-0000-000000000002', 61000, 'half', 'خدش بسيط في الباب الخلفي');
select tst.ok((select current_driver_id from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = 'e0000000-0000-0000-0000-000000000001',
              'المسودة لا تغيّر السائق الحالي');
select tst.ok((select from_employee_id = 'e0000000-0000-0000-0000-000000000001' and form_no = 'HO-000001' from handovers),
              'المسلّم يُعبأ تلقائياً من السائق الحالي ورقم النموذج فريد');

update handovers set state = 'approved' where id = 'd0000000-0000-0000-0000-000000000001';
select tst.ok((select current_driver_id from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = 'e0000000-0000-0000-0000-000000000002',
              'بعد الاعتماد: المسؤول الحالي = المستلم');
select tst.ok((select end_at is not null from vehicle_assignments where employee_id = 'e0000000-0000-0000-0000-000000000001'),
              'أُغلقت فترة مسؤولية السائق السابق ولم تُحذف');
select tst.ok((select handover_id = 'd0000000-0000-0000-0000-000000000001' from vehicle_assignments
               where employee_id = 'e0000000-0000-0000-0000-000000000002' and end_at is null), 'الفترة الجديدة مربوطة بنموذج التسليم');
select tst.ok((select old_label like 'موظف تجريبي أ%' and new_label like 'موظف تجريبي ب%' from vehicle_field_history
               where field = 'current_driver_id'), 'السجل التاريخي يحفظ اسم السائق السابق والجديد');
select tst.ok((select odometer from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = 61000, 'العداد تحدّث من نموذج التسليم');
select tst.fails($$update handovers set notes = 'تعديل' where id = 'd0000000-0000-0000-0000-000000000001'$$,
                 'HANDOVER_LOCKED', 'النموذج المعتمد مقفل');
select tst.ok((select authorization_status = 'missing' from v_vehicles_overview),
              'السائق الجديد بلا تفويض ⇒ "غير متوفر" (لا افتراض تلقائي)');
select tst.ok(exists (select 1 from v_followups where alert_type = 'authorization' and status = 'missing'), 'تنبيه متابعة لغياب التفويض');

-- ---------------------------------------------------------------------
\echo '== 9) الحوادث'
insert into accidents(vehicle_id, driver_id, occurred_at, description, parts_cost, labor_cost, extra_cost, status)
values ('b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', '2026-10-11 09:15+03',
        'اصطدام خفيف بسياج', 800, 350, 50, 'awaiting_repair');
select tst.ok((select total from accidents) = 1200, 'إجمالي الحادث = 800 + 350 + 50 = 1,200');
select tst.ok(exists (select 1 from v_followups where alert_type = 'accident'), 'الحادث المفتوح يظهر في المتابعة');

-- ---------------------------------------------------------------------
\echo '== 10) السكن والطعام'
insert into housing_maintenance(site_id, work_date, description, contractor, subtotal, vat_amount)
values ((select id from sites where name = 'مشتل الغملاس'), '2026-10-03', 'إصلاح مكيف السكن', 'مقاول تجريبي', 400, 60);
insert into food_supplies(site_id, supply_date, supplier, description, quantity, unit, unit_price, vat_amount)
values ((select id from sites where name = 'مشتل الغملاس'), '2026-10-04', 'مورد تجريبي', 'أرز', 10, 'كيس', 12.5, 18.75);
select tst.ok((select company_id from housing_maintenance) = '22222222-2222-2222-2222-222222222222', 'شركة السكن تُعبأ تلقائياً من الموقع');
select tst.ok((select total from housing_maintenance) = 460, 'صيانة السكن 400 + 60 = 460');
select tst.ok((select subtotal = 125 and total = 143.75 from food_supplies), 'الطعام 10 × 12.5 = 125 + 18.75 = 143.75');

-- ---------------------------------------------------------------------
\echo '== 11) نقل السيارة لا يغيّر تاريخ المصروفات'
update vehicles set site_id = (select id from sites where name = 'مزرعة ارم') where id = 'b0000000-0000-0000-0000-000000000001';
select tst.ok((select count(*) from v_expenses e join sites s on s.id = e.site_id
               where s.name = 'مزرعة الغملاس' and e.category in ('oil_change','maintenance','accident')) = 4,
              'مصروفات السيارة السابقة باقية على مزرعة الغملاس بعد نقلها');
select tst.ok(exists (select 1 from vehicle_field_history where field = 'site_id' and new_label = 'مزرعة ارم'), 'نقل الموقع موثق تاريخياً');

-- ---------------------------------------------------------------------
\echo '== 12) لوحة التحكم'
select tst.ok((select (s->>'cost_oil_month')::numeric = 300.50 and (s->>'cost_maintenance_month')::numeric = 512.04
                  and (s->>'cost_housing_food_month')::numeric = 603.75 and (s->>'vehicles_total')::int = 1
                  and (s->>'accidents_open')::int = 1 and (s->>'docs_expired')::int = 1
               from dashboard_stats(null, null, 2026, 10) s), 'إحصاءات أكتوبر 2026 مطابقة للسجلات الفعلية');
select tst.ok((select (s->>'cost_oil_month')::numeric = 0 from dashboard_stats(null, null, 2026, 9) s), 'سبتمبر بلا مصروفات زيت');
select tst.ok((select (s->>'cost_housing_food_month')::numeric = 0
               from dashboard_stats('11111111-1111-1111-1111-111111111111', null, 2026, 10) s), 'فلتر الشركة يستبعد مصروفات المشتل');

-- ---------------------------------------------------------------------
\echo '== 13) لا حذف فعلي — أرشفة مع تدقيق'
select tst.fails($$delete from oil_changes$$, 'permission denied', 'المستخدم لا يملك صلاحية الحذف أصلاً');
reset role;
select tst.fails($$delete from accidents$$, 'DELETE_NOT_ALLOWED', 'حتى مالك القاعدة لا يستطيع حذف حادث');
set role authenticated;
update oil_changes set deleted_at = now() where oil_no = 'OIL-000001';
reset role;
select tst.ok((select count(*) from audit_log where table_name = 'oil_changes' and action = 'ARCHIVE') = 1, 'الأرشفة مسجلة في سجل التدقيق');
select tst.ok((select changed_by from audit_log where table_name = 'oil_changes' and action = 'ARCHIVE')
              = 'a0000000-0000-0000-0000-000000000003', 'سجل التدقيق يحفظ هوية المستخدم');
select tst.ok((select changes ? 'odometer' from audit_log where table_name = 'vehicles' and action = 'UPDATE' order by id limit 1),
              'سجل التدقيق يحفظ الحقول المتغيرة فقط');

-- ---------------------------------------------------------------------
\echo '== 14) الصلاحيات والبيانات الحساسة'
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';  -- المسؤول
insert into employee_private(employee_id, iqama_no, mobile) values ('e0000000-0000-0000-0000-000000000001', '2000000001', '0500000001');
select tst.fails($$insert into employee_private(employee_id, iqama_no) values ('e0000000-0000-0000-0000-000000000002', '12345')$$,
                 'iqama_digits', 'رقم الإقامة يجب أن يكون 10 أرقام');
insert into attachments(entity_type, entity_id, category, file_name, storage_path) values
 ('maintenance', 'c0000000-0000-0000-0000-000000000001', 'maintenance_invoice', 'inv.pdf', 'maintenance/c1/inv.pdf'),
 ('vehicle', 'b0000000-0000-0000-0000-000000000001', 'vehicle_photo', 'car.jpg', 'vehicle/b1/car.jpg'),
 ('employee', 'e0000000-0000-0000-0000-000000000001', 'document_image', 'iqama.jpg', 'employee/e1/iqama.jpg');
reset role;
insert into storage.objects(bucket_id, name) values
 ('attachments', 'maintenance/c1/inv.pdf'), ('attachments', 'vehicle/b1/car.jpg'), ('attachments', 'employee/e1/iqama.jpg');

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';  -- مستخدم عرض فقط
select tst.ok((select count(*) from vehicles) = 1, 'مستخدم العرض يرى السيارات');
select tst.ok((select count(*) from employee_private) = 0, 'مستخدم العرض لا يرى الإقامات والجوالات');
select tst.ok((select count(*) from attachments) = 1, 'مستخدم العرض يرى صورة السيارة فقط (لا فواتير ولا وثائق شخصية)');
select tst.ok((select count(*) from storage.objects) = 1, 'ولا يستطيع تنزيل ملف الفاتورة من التخزين');
select tst.ok((select count(*) from audit_log) = 0, 'مستخدم العرض لا يرى سجل التدقيق');
select tst.fails($$insert into vehicles(plate_no, owner_company_id) values ('ز ز ز 9', '11111111-1111-1111-1111-111111111111')$$,
                 'row-level security', 'مستخدم العرض لا يستطيع الإضافة');
with u as (update vehicles set notes = 'x' returning 1)
select tst.ok((select count(*) from u) = 0, 'مستخدم العرض لا يستطيع التعديل');

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';  -- محاسب (عرض + فواتير)
select tst.ok((select count(*) from attachments where sensitivity = 'invoice') = 1, 'صاحب صلاحية الفواتير يرى الفاتورة');
select tst.ok((select count(*) from storage.objects where name like 'maintenance/%') = 1, 'ويستطيع تنزيل ملفها');
select tst.ok((select count(*) from employee_private) = 0, 'لكنه لا يرى الإقامات');

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';  -- مدخل بيانات
select tst.fails($$insert into user_permissions(user_id, permission) values ('a0000000-0000-0000-0000-000000000002', 'edit')$$,
                 'row-level security', 'مدخل البيانات لا يستطيع منح صلاحيات');
with u as (update sites set name = 'x' returning 1)
select tst.ok((select count(*) from u) = 0, 'مدخل البيانات لا يعدّل المواقع (يتطلب صلاحية الإعدادات)');

set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';  -- المسؤول
select tst.fails($$update profiles set is_admin = false where email = 'admin@test.local'$$, 'LAST_ADMIN', 'لا يمكن تعطيل آخر مسؤول');

-- ---------------------------------------------------------------------
\echo '== 15) تعديل اسم الموقع لا يفقد السجلات'
update sites set name = 'مزرعة إرم' where name = 'مزرعة ارم';
select tst.ok((select s.name from vehicles v join sites s on s.id = v.site_id) = 'مزرعة إرم', 'السيارة ما زالت مرتبطة بالموقع بعد إعادة تسميته');
reset role;
select tst.ok((select old_value = 'مزرعة ارم' from site_history where field = 'name'), 'الاسم القديم محفوظ في تاريخ الموقع');

-- ---------------------------------------------------------------------
\echo '== 16) طلبات الصيانة'
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';  -- مدخل بيانات
insert into maintenance_requests(vehicle_id, fault, fault_cause, project_text)
values ('b0000000-0000-0000-0000-000000000001', 'صوت في المحرك', 'قيد الفحص', 'مشروع تجريبي');
select tst.ok((select request_no from maintenance_requests order by created_at limit 1) = 'MR-000001', 'رقم طلب تلقائي MR-000001');
select tst.ok((select r.plate_no = v.plate_no and r.model like '%هايلكس%' and r.meter_reading = v.odometer and r.site_id = v.site_id and r.driver_id is not distinct from v.current_driver_id
               from maintenance_requests r join vehicles v on v.id = r.vehicle_id), 'اللوحة والموديل والعداد والموقع والسائق تُجلب من ملف السيارة');
select tst.ok((select request_date = app_today() and status = 'new' from maintenance_requests), 'التاريخ تلقائي والحالة «جديد»');
insert into maintenance_requests(equipment_text, plate_no, model, fault, meter_unit, meter_reading)
values ('مولد كهرباء', 'بدون', 'كاتربلر', 'لا يعمل', 'hours', 1200);
select tst.ok((select request_no from maintenance_requests where equipment_text = 'مولد كهرباء') = 'MR-000002', 'معدة غير مسجلة كسيارة بإدخال يدوي، والرقم متسلسل MR-000002');
select tst.fails($$insert into maintenance_requests(vehicle_id, fault) values ('b0000000-0000-0000-0000-000000000001', '  ')$$, 'check constraint', 'وصف العطل مطلوب');
select tst.fails($$insert into maintenance_requests(fault) values ('عطل')$$, 'mr_subject', 'لا بد من سيارة أو معدة أو لوحة');
update maintenance_requests set status = 'pending_supervisor', site_notes = 'عاجل' where request_no = 'MR-000001';
select tst.ok((select status from maintenance_requests where request_no = 'MR-000001') = 'pending_supervisor', 'إرسال الطلب للاعتماد');
select tst.fails($$update maintenance_requests set status = 'approved', approver_name = 'س' where request_no = 'MR-000001'$$, 'MR_APPROVE_DENIED', 'مدخل البيانات لا يعتمد الطلب');
select tst.fails($$update maintenance_requests set status = 'completed' where request_no = 'MR-000001'$$, 'MR_BAD_TRANSITION', 'لا يكتمل طلب قبل اعتماده');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';  -- المسؤول
select tst.fails($$update maintenance_requests set status = 'approved' where request_no = 'MR-000001'$$, 'MR_APPROVER_REQUIRED', 'الاعتماد يتطلب اسم المعتمد');
select tst.fails($$update maintenance_requests set status = 'rejected', approver_name = 'المدير' where request_no = 'MR-000002'$$, 'MR_REASON_REQUIRED', 'الرفض يتطلب سبباً');
update maintenance_requests set status = 'approved', supervisor_name = 'مشرف تجريبي', approver_name = 'مدير تجريبي' where request_no = 'MR-000001';
select tst.ok((select decided_at is not null and decided_by = 'a0000000-0000-0000-0000-000000000001' from maintenance_requests where request_no = 'MR-000001'), 'الاعتماد يسجل الوقت والمستخدم');
select tst.fails($$update maintenance_requests set fault = 'تغيير' where request_no = 'MR-000001'$$, 'MR_LOCKED', 'الطلب المعتمد مقفل');
update maintenance_requests set technician_opinion = 'تغيير سير المحرك' where request_no = 'MR-000001';
select tst.ok((select technician_opinion from maintenance_requests where request_no = 'MR-000001') = 'تغيير سير المحرك', 'رأي الفني يُضاف بعد الاعتماد');
update maintenance_requests set status = 'in_progress' where request_no = 'MR-000001';
update maintenance_requests set status = 'completed' where request_no = 'MR-000001';
select tst.ok((select started_at is not null and completed_at is not null from maintenance_requests where request_no = 'MR-000001'), 'قيد الصيانة ثم مكتمل مع الأوقات');
update maintenance_requests set status = 'rejected', approver_name = 'مدير تجريبي', approval_notes = 'يُصلح داخلياً' where request_no = 'MR-000002';
select tst.ok((select count(*) from v_followups where alert_type = 'maintenance_request') = 0, 'المكتمل والمرفوض لا يظهران في التنبيهات');
insert into maintenance_requests(vehicle_id, fault, meter_reading) values ('b0000000-0000-0000-0000-000000000001', 'فرامل', 999999);
select tst.ok((select count(*) from v_followups where alert_type = 'maintenance_request') = 1, 'الطلب الجديد يظهر في التنبيهات');
select tst.ok((select odometer from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = 999999, 'قراءة العداد في الطلب ترفع عداد السيارة');
select tst.ok((select count(*) from maintenance_requests) = 3, 'الطلبات السابقة محفوظة عند إنشاء طلب جديد');
select tst.fails($$delete from maintenance_requests$$, 'permission denied', 'لا يمكن حذف طلب صيانة');
select tst.ok((select count(*) from audit_log where table_name = 'maintenance_requests') >= 8, 'كل خطوة في سجل التدقيق');
reset role;

\echo '== اكتملت جميع الاختبارات بنجاح'
