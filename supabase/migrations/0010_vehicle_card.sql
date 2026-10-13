-- =====================================================================
-- 0010: new vehicle card (add / edit). ASCII only. Adds columns and one protected table only;
-- no existing vehicle, document, expense or history row is changed or removed. Safe to run more than once.
--  * wheels_count, operating state (inside / outside / other + free text), insurance expiry,
--    manual cost fields (oil, maintenance, maintenance total) on vehicles
--  * ID numbers of the current user and of the owner in vehicle_private: readable only with view_sensitive
-- =====================================================================
alter table vehicles add column if not exists wheels_count     int;
alter table vehicles add column if not exists op_state         text;
alter table vehicles add column if not exists op_state_text    text;
alter table vehicles add column if not exists insurance_expiry date;
alter table vehicles add column if not exists cost_oil         numeric(12,2);
alter table vehicles add column if not exists cost_maint       numeric(12,2);
alter table vehicles add column if not exists cost_maint_total numeric(12,2);

alter table vehicles drop constraint if exists vehicles_wheels_count_range;
alter table vehicles add constraint vehicles_wheels_count_range check (wheels_count is null or wheels_count between 1 and 40);
alter table vehicles drop constraint if exists vehicles_op_state_values;
alter table vehicles add constraint vehicles_op_state_values check (op_state is null or op_state in ('inside', 'outside', 'other'));
alter table vehicles drop constraint if exists vehicles_op_state_other_text;
alter table vehicles add constraint vehicles_op_state_other_text check (op_state is distinct from 'other' or nullif(btrim(op_state_text), '') is not null);
alter table vehicles drop constraint if exists vehicles_costs_positive;
alter table vehicles add constraint vehicles_costs_positive check (coalesce(cost_oil, 0) >= 0 and coalesce(cost_maint, 0) >= 0 and coalesce(cost_maint_total, 0) >= 0);

-- ID numbers (user / owner): separate table, same protection as employee_private
create table if not exists vehicle_private (
  vehicle_id         uuid primary key references vehicles(id),
  current_user_id_no text,
  owner_id_no        text,
  updated_at         timestamptz not null default now(),
  constraint vp_user_id_digits  check (current_user_id_no is null or current_user_id_no ~ '^[0-9]{1,20}$'),
  constraint vp_owner_id_digits check (owner_id_no is null or owner_id_no ~ '^[0-9]{1,20}$')
);
alter table vehicle_private enable row level security;
drop policy if exists p_select on vehicle_private;
drop policy if exists p_insert on vehicle_private;
drop policy if exists p_update on vehicle_private;
create policy p_select on vehicle_private for select to authenticated using (has_perm('view_sensitive'));
create policy p_insert on vehicle_private for insert to authenticated with check (has_perm('create') and has_perm('view_sensitive'));
create policy p_update on vehicle_private for update to authenticated
  using (has_perm('edit') and has_perm('view_sensitive')) with check (has_perm('edit') and has_perm('view_sensitive'));
revoke all on vehicle_private from anon, public;
revoke delete, truncate, references, trigger on vehicle_private from authenticated;
grant select, insert, update on vehicle_private to authenticated;

drop trigger if exists set_updated_at on vehicle_private;
create trigger set_updated_at before update on vehicle_private for each row execute function trg_set_updated_at();
drop trigger if exists block_delete on vehicle_private;
create trigger block_delete before delete on vehicle_private for each row execute function trg_block_delete();

-- audit without storing the numbers themselves
create or replace function trg_audit_vehicle_private() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log(table_name, record_id, action, changed_by, old_data, new_data, changes)
  values ('vehicle_private', coalesce(new.vehicle_id, old.vehicle_id)::text, tg_op, auth.uid(), null, null,
          '{"id_numbers": "(sensitive value changed)"}'::jsonb);
  return coalesce(new, old);
end $$;
revoke execute on function trg_audit_vehicle_private() from public, anon;
drop trigger if exists audit on vehicle_private;
create trigger audit after insert or update on vehicle_private for each row execute function trg_audit_vehicle_private();

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

select 'VEHICLE_CARD_OK' as result;
