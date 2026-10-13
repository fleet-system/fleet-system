-- Fake demo data for UI testing only (no real personal data).
insert into auth.users(id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-000000000001', 'admin@test.local',  '{"full_name":"عبدالله المسؤول"}'),
 ('a0000000-0000-0000-0000-000000000002', 'viewer@test.local', '{"full_name":"مستخدم للعرض"}'),
 ('a0000000-0000-0000-0000-000000000003', 'acct@test.local', '{"full_name":"محاسب تجريبي"}');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
insert into user_permissions(user_id, permission) values ('a0000000-0000-0000-0000-000000000002', 'view'),
 ('a0000000-0000-0000-0000-000000000003', 'view'), ('a0000000-0000-0000-0000-000000000003', 'invoices');

do $$
declare
  s_gh uuid := (select id from sites where name = 'مزرعة الغملاس');
  s_bk uuid := (select id from sites where name = 'مزرعة البركة');
  s_irm uuid := (select id from sites where name = 'مزرعة ارم');
  s_ns uuid := (select id from sites where name = 'مشتل الغملاس');
  c1 uuid := '11111111-1111-1111-1111-111111111111';
  c2 uuid := '22222222-2222-2222-2222-222222222222';
  t date := app_today();
begin
  insert into employees(id, full_name, company_id, site_id, job_title) values
   ('e0000000-0000-0000-0000-000000000001', 'سائق تجريبي 1', c1, s_gh, 'سائق'),
   ('e0000000-0000-0000-0000-000000000002', 'سائق تجريبي 2', c1, s_bk, 'سائق'),
   ('e0000000-0000-0000-0000-000000000003', 'سائق تجريبي 3', c1, s_irm, 'سائق'),
   ('e0000000-0000-0000-0000-000000000004', 'سائق تجريبي 4', c2, s_ns, 'سائق'),
   ('e0000000-0000-0000-0000-000000000005', 'مشرف تجريبي', c1, s_gh, 'مشرف');

  insert into vehicles(id, plate_no, make, vehicle_type, model, manufacture_year, owner_company_id, site_id, current_driver_id, location_status, op_status) values
   ('b0000000-0000-0000-0000-000000000001', 'أ ب ج 1234', 'تويوتا', 'بيك أب', 'هايلكس', 2022, c1, s_gh,  'e0000000-0000-0000-0000-000000000001', 'inside_site', 'working'),
   ('b0000000-0000-0000-0000-000000000002', 'د هـ و 5678', 'نيسان', 'بيك أب', 'نافارا', 2021, c2, s_bk,  'e0000000-0000-0000-0000-000000000002', 'outside_site', 'working'),
   ('b0000000-0000-0000-0000-000000000003', 'ر س ص 2468', 'إيسوزو', 'شاحنة', 'NPR', 2019, c1, s_irm, 'e0000000-0000-0000-0000-000000000003', 'in_workshop', 'under_maintenance'),
   ('b0000000-0000-0000-0000-000000000004', 'ط ع ق 1357', 'تويوتا', 'باص', 'كوستر', 2020, c2, s_ns,  'e0000000-0000-0000-0000-000000000004', 'inside_site', 'accident_damaged'),
   ('b0000000-0000-0000-0000-000000000005', 'ك ل م 9090', 'هيونداي', 'ونيت', 'H100', 2018, c1, s_gh, null, 'inside_site', 'stopped');

  insert into oil_changes(vehicle_id, change_date, odometer, oil_cost, filter_cost, workshop) values
   ('b0000000-0000-0000-0000-000000000001', t - 40, 82000, 140, 35, 'ورشة تجريبية'),
   ('b0000000-0000-0000-0000-000000000002', t - 70, 51000, 150, 40, 'ورشة تجريبية'),
   ('b0000000-0000-0000-0000-000000000003', t - 5, 120500, 220, 60, 'ورشة تجريبية');
  update vehicles set odometer = 91300  where id = 'b0000000-0000-0000-0000-000000000001';  -- 700 km left
  update vehicles set odometer = 61400  where id = 'b0000000-0000-0000-0000-000000000002';  -- overdue 400
  update vehicles set odometer = 121000 where id = 'b0000000-0000-0000-0000-000000000003';
  update vehicles set odometer = 64000  where id = 'b0000000-0000-0000-0000-000000000004';
  update vehicles set odometer = 143200 where id = 'b0000000-0000-0000-0000-000000000005';

  insert into documents(doc_type, vehicle_id, doc_no, expiry_date) values
   ('registration', 'b0000000-0000-0000-0000-000000000001', 'R-1001', t + 210),
   ('periodic_inspection', 'b0000000-0000-0000-0000-000000000001', 'P-1001', t + 25),
   ('registration', 'b0000000-0000-0000-0000-000000000002', 'R-1002', t - 4),
   ('periodic_inspection', 'b0000000-0000-0000-0000-000000000002', 'P-1002', t + 300),
   ('registration', 'b0000000-0000-0000-0000-000000000003', 'R-1003', t + 6),
   ('periodic_inspection', 'b0000000-0000-0000-0000-000000000003', null, null),
   ('registration', 'b0000000-0000-0000-0000-000000000004', 'R-1004', t + 400),
   ('periodic_inspection', 'b0000000-0000-0000-0000-000000000004', 'P-1004', t + 58),
   ('registration', 'b0000000-0000-0000-0000-000000000005', 'R-1005', t + 120),
   ('periodic_inspection', 'b0000000-0000-0000-0000-000000000005', 'P-1005', t + 140);
  insert into documents(doc_type, employee_id, doc_no, expiry_date) values
   ('iqama', 'e0000000-0000-0000-0000-000000000001', null, t + 180),
   ('driving_license', 'e0000000-0000-0000-0000-000000000001', null, t + 500),
   ('iqama', 'e0000000-0000-0000-0000-000000000002', null, t + 15),
   ('driving_license', 'e0000000-0000-0000-0000-000000000002', null, t + 90),
   ('iqama', 'e0000000-0000-0000-0000-000000000003', null, t - 12),
   ('driving_license', 'e0000000-0000-0000-0000-000000000003', null, t + 200),
   ('iqama', 'e0000000-0000-0000-0000-000000000004', null, t + 250),
   ('driving_license', 'e0000000-0000-0000-0000-000000000004', null, t + 260),
   ('iqama', 'e0000000-0000-0000-0000-000000000005', null, t + 300);

  insert into authorizations(vehicle_id, employee_id, auth_no, expiry_date) values
   ('b0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'T-1', t + 100),
   ('b0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'T-2', t - 20),
   ('b0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000004', 'T-4', t + 45);

  insert into maintenance(id, vehicle_id, maint_date, odometer, maint_type, workshop, vat_amount) values
   ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', t - 3, 121000, 'إصلاح', 'ورشة تجريبية', 0);
  insert into maintenance_items(maintenance_id, kind, description, quantity, unit_price) values
   ('c0000000-0000-0000-0000-000000000001', 'part', 'قطعة تجريبية', 2, 450),
   ('c0000000-0000-0000-0000-000000000001', 'labor', 'أجور', 1, 300);
  update maintenance set vat_amount = round(subtotal * 0.15, 2);

  insert into accidents(vehicle_id, driver_id, occurred_at, description, parts_cost, labor_cost, status) values
   ('b0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000004', now() - interval '6 days',
    'حادث تجريبي', 2400, 900, 'awaiting_repair');

  insert into housing_maintenance(site_id, work_date, description, contractor, subtotal, vat_amount) values
   (s_gh, t - 8, 'صيانة تجريبية للسكن', 'مقاول تجريبي', 1200, 180),
   (s_ns, t - 2, 'صيانة تجريبية للسكن', 'مقاول تجريبي', 600, 90);
  insert into food_supplies(site_id, supply_date, supplier, description, quantity, unit, unit_price, vat_amount) values
   (s_gh, t - 1, 'مورد تجريبي', 'مواد غذائية', 20, 'كرتون', 85, 255),
   (s_bk, t - 9, 'مورد تجريبي', 'مواد غذائية', 12, 'كرتون', 85, 153),
   (s_ns, t - 4, 'مورد تجريبي', 'مواد غذائية', 8, 'كرتون', 85, 102);
end $$;
