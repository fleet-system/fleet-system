-- Large fake dataset (no real personal data) for phase 8: > 1000 rows in the big tables,
-- boundary values for every status rule, soft-deleted rows, Riyadh-midnight timestamps.
-- Run after ui_seed.sql:  psql -d fleet_ui -f bulk_seed.sql
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
select setseed(0.42);

do $$
declare
  sites uuid[] := array(select id from sites order by name);
  c1 uuid := '11111111-1111-1111-1111-111111111111';
  c2 uuid := '22222222-2222-2222-2222-222222222222';
  t date := app_today();
  -- days-left boundaries around the alert levels 90/60/30/7 and today
  offs int[] := array[-400,-31,-1,0,1,6,7,8,29,30,31,59,60,61,89,90,91,92,200,365];
  -- oil: remaining km boundaries around warning 1000 and tolerance 500
  rems int[] := array[5000,1001,1000,999,1,0,-1,-499,-500,-501,-3000];
  ops text[] := array['working','working','working','stopped','under_maintenance','accident_damaged'];
  locs text[] := array['inside_site','inside_site','outside_site','in_workshop'];
  kinds text[] := array['part','labor','other'];
  i int; j int; k int; n int; v uuid; e uuid; s uuid; m uuid; odo int; itv int; d date;
  emp_ids uuid[] := '{}'; veh_ids uuid[] := '{}';
begin
  -- 420 employees
  for i in 1..420 loop
    s := sites[1 + (i % array_length(sites, 1))];
    insert into employees(full_name, company_id, site_id, job_title, status)
    values ('موظف تجريبي ' || i, (select company_id from sites where id = s), s, case when i % 3 = 0 then 'عامل' else 'سائق' end,
            (array['active','active','active','on_leave','terminated'])[1 + i % 5]::employee_status)
    returning id into e;
    emp_ids := emp_ids || e;
    if i % 4 <> 0 then
      insert into documents(doc_type, employee_id, expiry_date) values ('iqama', e, case when i % 23 = 0 then null else t + offs[1 + i % array_length(offs, 1)] end);
    end if;
    if i % 2 = 0 then
      insert into documents(doc_type, employee_id, expiry_date) values ('driving_license', e, t + offs[1 + (i * 7) % array_length(offs, 1)]);
    end if;
  end loop;

  -- 1100 vehicles; 70% have a driver (unique driver per vehicle)
  for i in 1..1100 loop
    s := case when i % 50 = 0 then null else sites[1 + (i % array_length(sites, 1))] end;
    insert into vehicles(plate_no, make, vehicle_type, model, manufacture_year, owner_company_id, site_id, current_driver_id,
                         location_status, op_status, oil_interval_km)
    values ('ت ج ر ' || (10000 + i), (array['تويوتا','نيسان','إيسوزو','هيونداي'])[1 + i % 4], 'بيك أب', 'تجريبي', 2010 + i % 15,
            case when i % 3 = 0 then c2 else c1 end, s,
            case when i % 10 < 7 and i <= 420 and (select status from employees where id = emp_ids[i]) <> 'terminated' then emp_ids[i] end,
            locs[1 + i % 4]::vehicle_location, ops[1 + i % 6]::vehicle_op_status, (array[5000, 10000, 7500])[1 + i % 3])
    returning id into v;
    veh_ids := veh_ids || v;

    -- documents: missing / no date / history (older + newer) / boundary offsets
    if i % 17 <> 0 then
      insert into documents(doc_type, vehicle_id, expiry_date) values ('registration', v, case when i % 29 = 0 then null else t + offs[1 + i % array_length(offs, 1)] end);
      if i % 5 = 0 then insert into documents(doc_type, vehicle_id, expiry_date) values ('registration', v, t - 500); end if; -- older record kept as history
    end if;
    if i % 13 <> 0 then
      insert into documents(doc_type, vehicle_id, expiry_date) values ('periodic_inspection', v, t + offs[1 + (i * 3) % array_length(offs, 1)]);
    end if;
    if i % 37 = 0 then  -- soft-deleted newer document must be ignored
      insert into documents(doc_type, vehicle_id, expiry_date, deleted_at) values ('periodic_inspection', v, t + 999, now());
    end if;

    -- oil changes: 0..3 per vehicle, increasing odometer, dates spread over ~3 years
    n := i % 4; odo := 1000 + (i * 37) % 5000;
    itv := (array[5000, 10000, 7500])[1 + i % 3];
    for j in 1..n loop
      odo := odo + 3000 + (j * 911 + i) % 6000;
      d := t - (n - j) * 160 - (i % 150);
      insert into oil_changes(vehicle_id, change_date, odometer, interval_km, oil_cost, filter_cost, extra_cost, payment_status)
      values (v, d, odo, case when j = n and i % 7 = 0 then null else itv end, 100 + (i % 90) + 0.25 * (j % 3), 20 + j * 5.5, case when i % 9 = 0 then 12.75 else 0 end,
              (array['paid','unpaid','partially_paid'])[1 + (i + j) % 3]::payment_status);
    end loop;
    if i % 41 = 0 and n > 0 then -- a soft-deleted oil change with a higher odometer must not count as "last"
      insert into oil_changes(vehicle_id, change_date, odometer, interval_km, oil_cost, deleted_at) values (v, t, odo + 50000, 10000, 999, now());
    end if;
    -- set the vehicle odometer so remaining km hits the boundaries
    if n > 0 then
      update vehicles set odometer = greatest(odometer,
        (select odometer + interval_km from oil_changes where vehicle_id = v and deleted_at is null order by odometer desc limit 1) - rems[1 + i % array_length(rems, 1)])
      where id = v;
    else
      update vehicles set odometer = 20000 + i where id = v;
    end if;
  end loop;

  -- authorizations for current drivers: none / not authorized / no date / expired / valid / stale (other driver)
  for i in 1..1100 loop
    select current_driver_id into e from vehicles where id = veh_ids[i];
    continue when e is null;
    k := i % 6;
    if k = 1 then insert into authorizations(vehicle_id, employee_id, expiry_date, is_authorized) values (veh_ids[i], e, t + 100, false);
    elsif k = 2 then insert into authorizations(vehicle_id, employee_id, expiry_date) values (veh_ids[i], e, null);
    elsif k = 3 then insert into authorizations(vehicle_id, employee_id, expiry_date) values (veh_ids[i], e, t - 1);
    elsif k = 4 then insert into authorizations(vehicle_id, employee_id, expiry_date) values (veh_ids[i], e, t);  -- expires today = still valid
    elsif k = 5 then insert into authorizations(vehicle_id, employee_id, expiry_date) values (veh_ids[i], emp_ids[1 + (i + 200) % 420], t + 300); -- for someone else
    end if;
  end loop;

  -- 650 maintenance jobs with 1..4 items, some items soft-deleted, VAT on most
  for i in 1..650 loop
    v := veh_ids[1 + (i * 7) % 1100];
    insert into maintenance(vehicle_id, maint_date, maint_type, payment_status)
    values (v, t - (i * 13) % 1000, (array['دورية','فرامل','كهرباء','إطارات'])[1 + i % 4], (array['paid','unpaid','partially_paid'])[1 + i % 3]::payment_status)
    returning id into m;
    for j in 1..(1 + i % 4) loop
      insert into maintenance_items(maintenance_id, kind, description, quantity, unit_price, deleted_at)
      values (m, kinds[1 + (i + j) % 3]::maint_item_kind, 'بند ' || j, 1 + (j % 3) * 0.5, 33.33 * j + (i % 50), case when j = 3 and i % 5 = 0 then now() end);
    end loop;
    update maintenance set vat_amount = case when i % 4 = 0 then 0 else round(subtotal * 0.15, 2) end where id = m;
    if i % 97 = 0 then update maintenance set deleted_at = now() where id = m; end if;
  end loop;

  -- 220 accidents, a few right around Riyadh midnight at month ends
  for i in 1..220 loop
    v := veh_ids[1 + (i * 11) % 1100];
    insert into accidents(vehicle_id, occurred_at, description, parts_cost, labor_cost, extra_cost, status, deleted_at)
    values (v,
            case when i % 10 = 0 then (date_trunc('month', (t - (i * 4) % 900)::timestamp) - interval '30 minutes') at time zone 'Asia/Riyadh' -- 23:30 Riyadh, last day of month
                 when i % 10 = 1 then (date_trunc('month', (t - (i * 4) % 900)::timestamp) + interval '30 minutes') at time zone 'Asia/Riyadh' -- 00:30 Riyadh, first day
                 else now() - ((i * 4) % 900) * interval '1 day' end,
            'حادث تجريبي', 500 + i * 3.5, 200 + (i % 7) * 10, case when i % 3 = 0 then 75.5 else 0 end,
            (array['new','awaiting_estimate','awaiting_repair','repairing','completed','completed'])[1 + i % 6]::accident_status,
            case when i % 53 = 0 then now() end);
  end loop;

  -- 320 housing jobs and 1300 food supplies (fractional quantities)
  for i in 1..320 loop
    insert into housing_maintenance(site_id, work_date, description, subtotal, vat_amount, deleted_at)
    values (sites[1 + i % array_length(sites, 1)], t - (i * 3) % 1000, 'صيانة تجريبية', 100 + i * 2.35, case when i % 3 = 0 then 0 else round((100 + i * 2.35) * 0.15, 2) end,
            case when i % 61 = 0 then now() end);
  end loop;
  for i in 1..1300 loop
    insert into food_supplies(site_id, supply_date, supplier, description, quantity, unit, unit_price, vat_amount, deleted_at)
    values (sites[1 + (i * 3) % array_length(sites, 1)], t - (i % 1000), 'مورد تجريبي', 'مواد', 1 + (i % 40) * 0.125 + 0.005 * (i % 3), 'كرتون', 7.77 + i % 13,
            case when i % 2 = 0 then round(round((1 + (i % 40) * 0.125 + 0.005 * (i % 3)) * (7.77 + i % 13), 2) * 0.15, 2) else 0 end,
            case when i % 89 = 0 then now() end);
  end loop;
end $$;
