-- =====================================================================
-- 0024: changing the delegate of a vehicle re-checks step 1 (delegate licence) of its active plan.
--  * new delegate with a licence valid more than 30 days: step 1 done (source 'auto').
--  * otherwise (no delegate, no date, expired or within 30 days): a completed step 1 goes back to
--    'pending' (it belonged to the previous delegate). The change is kept in the audit log.
--  * a skipped step 1 (source 'skip') is kept as it is.
-- No other data changes. ASCII only. Safe to run more than once.
-- =====================================================================
create or replace function trg_renewal_vehicle_delegate() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid; lic date;
begin
  if new.delegate_id is distinct from old.delegate_id then
    select id into pid from renewal_plans where vehicle_id = new.id and status = 'active' and deleted_at is null;
    if pid is not null then
      select license_expiry into lic from delegates where id = new.delegate_id and deleted_at is null;
      if lic is null or lic - app_today() <= 30 then
        update renewal_steps set status = 'pending', new_expiry = null, source = null,
               entered_by = null, entered_at = null, confirmed_by = null, confirmed_at = null
         where plan_id = pid and step_no = 1 and status <> 'pending' and coalesce(source, '') <> 'skip';
      end if;
      perform _renewal_auto_complete(pid);
    end if;
  end if;
  return new;
end $$;
revoke execute on function trg_renewal_vehicle_delegate() from public, anon, authenticated;
drop trigger if exists renewal_delegate on vehicles;
create trigger renewal_delegate after update of delegate_id on vehicles for each row execute function trg_renewal_vehicle_delegate();

select 'RENEWAL_DELEGATE_CHANGE_OK' as result;
