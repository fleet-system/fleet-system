-- =====================================================================
-- 0023: the fines and fees step (step 4) can also be skipped, like the delegate step (step 1).
-- Only skip_renewal_step changes: steps 1 and 4 are allowed. No data changes. ASCII only. Safe to run again.
-- =====================================================================
create or replace function skip_renewal_step(p_plan uuid, p_step int, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_step not in (1, 4) then raise exception 'RENEWAL_SKIP_NOT_ALLOWED'; end if;
  if not exists (select 1 from renewal_plans where id = p_plan and status = 'active' and deleted_at is null) then raise exception 'RENEWAL_PLAN_CLOSED'; end if;
  update renewal_steps set status = 'done', source = 'skip',
         notes = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), notes),
         confirmed_by = auth.uid(), confirmed_at = now()
   where plan_id = p_plan and step_no = p_step and status <> 'done';
  if not found then raise exception 'RENEWAL_STEP_DONE'; end if;
  perform _renewal_check_complete(p_plan);
end $$;
revoke execute on function skip_renewal_step(uuid, int, text) from public, anon;
grant execute on function skip_renewal_step(uuid, int, text) to authenticated;

select 'RENEWAL_SKIP_FINES_OK' as result;
