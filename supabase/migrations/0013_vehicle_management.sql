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
