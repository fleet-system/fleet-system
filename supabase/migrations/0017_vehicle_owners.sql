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
