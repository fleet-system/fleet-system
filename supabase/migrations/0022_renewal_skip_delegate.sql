-- =====================================================================
-- 0022: the delegate step (step 1, delegate driving licence) of a renewal plan can be skipped.
-- skip_renewal_step(plan, step, reason): only step 1; needs edit. The step counts as complete
-- (status 'done', source 'skip'), the reason is kept in its note, and who / when are saved.
-- renewal_steps.source accepts 'skip'. No data changes. ASCII only. Safe to run more than once.
-- =====================================================================
alter table renewal_steps drop constraint if exists renewal_steps_source_check;
alter table renewal_steps add constraint renewal_steps_source_check check (source is null or source in ('plan', 'card', 'delegate', 'auto', 'skip'));

create or replace function skip_renewal_step(p_plan uuid, p_step int, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_step <> 1 then raise exception 'RENEWAL_SKIP_NOT_ALLOWED'; end if;
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

select 'RENEWAL_SKIP_DELEGATE_OK' as result;
