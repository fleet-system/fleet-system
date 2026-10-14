-- =====================================================================
-- 0020: renewal plan steps complete automatically when the current document is still valid
-- (more than 30 days left): 1 delegate driving licence, 2 periodic inspection, 3 insurance, 5 registration.
-- Step 4 (fines and fees) has no date and is still confirmed by the user.
--  * _renewal_auto_complete(plan): marks those steps done with source 'auto' (who / when kept).
--  * runs when a plan is created, when a vehicle gets a delegate, and from refresh_renewal_plan(plan)
--    (called by the plan page), and once now for the active plans.
--  * renewal_steps.source accepts 'auto'.
-- No other data changes. ASCII only. Safe to run more than once.
-- =====================================================================
alter table renewal_steps drop constraint if exists renewal_steps_source_check;
alter table renewal_steps add constraint renewal_steps_source_check check (source is null or source in ('plan', 'card', 'delegate', 'auto'));

create or replace function _renewal_auto_complete(p_plan uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v vehicles; dl_exp date; n int := 0; k int; e date;
begin
  select v2.* into v from renewal_plans p join vehicles v2 on v2.id = p.vehicle_id
   where p.id = p_plan and p.status = 'active' and p.deleted_at is null;
  if v.id is null then return 0; end if;
  select license_expiry into dl_exp from delegates where id = v.delegate_id and deleted_at is null;
  foreach k in array array[1, 2, 3, 5] loop
    e := case k
      when 1 then dl_exp
      when 2 then (select max(expiry_date) from documents where vehicle_id = v.id and doc_type = 'periodic_inspection' and deleted_at is null)
      when 3 then v.insurance_expiry
      when 5 then (select max(expiry_date) from documents where vehicle_id = v.id and doc_type = 'registration' and deleted_at is null)
    end;
    if e is not null and e - app_today() > 30 then
      update renewal_steps set status = 'done', source = 'auto', new_expiry = e,
             result = case when k = 2 then coalesce(result, 'passed') else result end,
             confirmed_by = auth.uid(), confirmed_at = now()
       where plan_id = p_plan and step_no = k and status <> 'done';
      if found then n := n + 1; end if;
    end if;
  end loop;
  perform _renewal_check_complete(p_plan);
  return n;
end $$;
revoke execute on function _renewal_auto_complete(uuid) from public, anon, authenticated;

-- called by the plan page: completes the steps whose document is valid
create or replace function refresh_renewal_plan(p_plan uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not (has_perm('edit') or has_perm('create')) then return 0; end if;
  return _renewal_auto_complete(p_plan);
end $$;
revoke execute on function refresh_renewal_plan(uuid) from public, anon;
grant execute on function refresh_renewal_plan(uuid) to authenticated;

create or replace function create_renewal_plan(p_vehicle uuid, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pid uuid; i int;
begin
  if not has_perm('create') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if not exists (select 1 from vehicles where id = p_vehicle and deleted_at is null) then raise exception 'RENEWAL_VEHICLE_NOT_FOUND'; end if;
  if exists (select 1 from renewal_plans where vehicle_id = p_vehicle and status = 'active' and deleted_at is null) then
    raise exception 'RENEWAL_PLAN_EXISTS';
  end if;
  insert into renewal_plans(vehicle_id, notes, created_by) values (p_vehicle, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()) returning id into pid;
  for i in 1..5 loop
    insert into renewal_steps(plan_id, step_no, step_key) values (pid, i, renewal_step_key(i));
  end loop;
  perform _renewal_auto_complete(pid);
  return pid;
end $$;

-- a vehicle that gets a delegate: his valid licence completes step 1 of the active plan
create or replace function trg_renewal_vehicle_delegate() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if new.delegate_id is distinct from old.delegate_id and new.delegate_id is not null then
    select id into pid from renewal_plans where vehicle_id = new.id and status = 'active' and deleted_at is null;
    if pid is not null then perform _renewal_auto_complete(pid); end if;
  end if;
  return new;
end $$;
revoke execute on function trg_renewal_vehicle_delegate() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renewal_delegate' and tgrelid = 'public.vehicles'::regclass) then
    create trigger renewal_delegate after update of delegate_id on vehicles for each row execute function trg_renewal_vehicle_delegate();
  end if;
end $$;

-- the active plans now
do $$
declare r record;
begin
  for r in select id from renewal_plans where status = 'active' and deleted_at is null loop
    perform _renewal_auto_complete(r.id);
  end loop;
end $$;

select 'RENEWAL_AUTO_COMPLETE_OK' as result;

-- executed together on 2026/10/14 at the owner's request: admin display name
update profiles set full_name = U&'\0639\0628\062F \0627\0644\0631\062D\0645\0646 \0627\0644\0634\0645\064A\0631\064A' where is_admin and email = 'abdama700@gmail.com';
