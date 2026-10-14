-- =====================================================================
-- 0019: renewal plan steps are all open. Any step can be recorded and confirmed in any order
-- (the site marks the next step in order with a warning). Only save_renewal_step changes:
-- the check that refused a step before the previous ones were complete (RENEWAL_STEP_ORDER) is removed.
-- Everything else stays: confirmation required, dates written to the vehicle card and delegate file.
-- No tables or data change. ASCII only. Safe to run more than once.
-- =====================================================================
create or replace function save_renewal_step(p_plan uuid, p_step int, p_data jsonb, p_confirm boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pl renewal_plans; st renewal_steps; v vehicles; dl delegates;
  d_exp date; d_res text; d_fines text; d_notes text; cur_exp date;
begin
  if not (has_perm('edit') or has_perm('create')) then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  if p_confirm and not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into pl from renewal_plans where id = p_plan and deleted_at is null;
  if pl.id is null then raise exception 'RENEWAL_PLAN_NOT_FOUND'; end if;
  if pl.status <> 'active' then raise exception 'RENEWAL_PLAN_CLOSED'; end if;
  select * into st from renewal_steps where plan_id = p_plan and step_no = p_step for update;
  if st.id is null then raise exception 'RENEWAL_STEP_NOT_FOUND'; end if;
  if st.status = 'done' then raise exception 'RENEWAL_STEP_DONE'; end if;
  select * into v from vehicles where id = pl.vehicle_id;
  d_exp := nullif(p_data->>'new_expiry', '')::date;
  d_res := nullif(p_data->>'result', '');
  d_fines := nullif(p_data->>'fines_status', '');
  d_notes := nullif(btrim(coalesce(p_data->>'notes', '')), '');

  if p_step = 1 then
    if v.delegate_id is null then raise exception 'RENEWAL_NO_DELEGATE'; end if;
    select * into dl from delegates where id = v.delegate_id;
    cur_exp := dl.license_expiry;
  elsif p_step = 2 then
    select max(expiry_date) into cur_exp from documents where vehicle_id = v.id and doc_type = 'periodic_inspection' and deleted_at is null;
  elsif p_step = 3 then
    cur_exp := v.insurance_expiry;
  elsif p_step = 5 then
    select max(expiry_date) into cur_exp from documents where vehicle_id = v.id and doc_type = 'registration' and deleted_at is null;
  end if;

  update renewal_steps set
    new_expiry = coalesce(d_exp, new_expiry),
    result = coalesce(d_res, result),
    fines_status = coalesce(d_fines, fines_status),
    notes = coalesce(d_notes, notes),
    status = 'entered', entered_by = auth.uid(), entered_at = now()
  where id = st.id returning * into st;

  if p_confirm then
    if p_step = 2 and coalesce(st.result, '') <> 'passed' then raise exception 'RENEWAL_INSPECTION_NOT_PASSED'; end if;
    if p_step = 4 and st.fines_status is null then raise exception 'RENEWAL_FINES_REQUIRED'; end if;
    if p_step <> 4 then
      if st.new_expiry is null and cur_exp is not null and cur_exp >= app_today() then
        update renewal_steps set new_expiry = cur_exp where id = st.id returning * into st;
      end if;
      if st.new_expiry is null then raise exception 'RENEWAL_DATE_REQUIRED'; end if;
      if st.new_expiry < app_today() then raise exception 'RENEWAL_DATE_PAST'; end if;
    end if;
    update renewal_steps set status = 'done', source = 'plan', confirmed_by = auth.uid(), confirmed_at = now()
     where id = st.id returning * into st;
    -- write the new date to the existing records (the vehicle card and alerts read them)
    if p_step = 1 and st.new_expiry is distinct from cur_exp then
      update delegates set license_expiry = st.new_expiry where id = v.delegate_id;
    elsif p_step = 2 and st.new_expiry is distinct from cur_exp then
      insert into documents(doc_type, vehicle_id, expiry_date, notes) values ('periodic_inspection', v.id, st.new_expiry, 'renewal plan ' || pl.plan_no);
    elsif p_step = 3 and st.new_expiry is distinct from cur_exp then
      update vehicles set insurance_expiry = st.new_expiry, change_note = 'renewal plan ' || pl.plan_no where id = v.id;
    elsif p_step = 5 and st.new_expiry is distinct from cur_exp then
      insert into documents(doc_type, vehicle_id, expiry_date, notes) values ('registration', v.id, st.new_expiry, 'renewal plan ' || pl.plan_no);
    end if;
    perform _renewal_check_complete(p_plan);
  end if;
  return to_jsonb(st);
end $$;
revoke execute on function save_renewal_step(uuid, int, jsonb, boolean) from public, anon;
grant execute on function save_renewal_step(uuid, int, jsonb, boolean) to authenticated;

select 'RENEWAL_OPEN_STEPS_OK' as result;
