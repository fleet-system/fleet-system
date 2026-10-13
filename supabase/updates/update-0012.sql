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
