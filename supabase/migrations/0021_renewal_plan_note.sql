-- =====================================================================
-- 0021: a note on each renewal plan (one per vehicle), written and changed from the plan page.
-- The note is internal: it is not printed in the plan PDF.
-- set_renewal_plan_note(plan, note): needs create or edit; the change is kept in the audit log.
-- Uses the existing column renewal_plans.notes. No data changes. ASCII only. Safe to run more than once.
-- =====================================================================
create or replace function set_renewal_plan_note(p_plan uuid, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare n text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not (has_perm('edit') or has_perm('create')) then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if n is not null and length(n) > 2000 then raise exception 'RENEWAL_NOTE_TOO_LONG'; end if;
  update renewal_plans set notes = n where id = p_plan and deleted_at is null;
  if not found then raise exception 'RENEWAL_PLAN_NOT_FOUND'; end if;
  return n;
end $$;
revoke execute on function set_renewal_plan_note(uuid, text) from public, anon;
grant execute on function set_renewal_plan_note(uuid, text) to authenticated;

select 'RENEWAL_PLAN_NOTE_OK' as result;
