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
