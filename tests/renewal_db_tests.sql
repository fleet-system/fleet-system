-- Renewal plan (0018): database rules. Fake data only. Run on the fleet_ui demo database (after reset_ui_db.sh).
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema if not exists rtst;
grant usage on schema rtst to authenticated;
create or replace function rtst.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', msg; end if;
  raise notice 'PASS: %', msg;
end $$;
create or replace function rtst.fails(cmd text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute cmd;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then raise notice 'PASS: % (refused: %)', msg, left(sqlerrm, 80); return; end if;
    raise exception 'FAIL: % - unexpected error: %', msg, sqlerrm;
  end;
  raise exception 'FAIL: % - was not refused', msg;
end $$;
grant execute on all functions in schema rtst to authenticated;

set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';

-- delegate: one record, matched by name with different letter forms / spaces
select rtst.ok(ensure_delegate(U&'\0623\062D\0645\062F  \0639\0644\064A') = ensure_delegate(U&'\0627\062D\0645\062F \0639\0644\0649'), 'same delegate found by name (letter forms, spaces)');
select rtst.ok((select count(*) from delegates) = 1, 'no duplicate delegate created');
update vehicles set delegate_id = (select id from delegates limit 1) where id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');
select rtst.ok((select authorized_name from vehicles where id = 'b0000000-0000-0000-0000-000000000001') = (select full_name from delegates limit 1), 'delegate name copied to the vehicle card field');
select rtst.ok((select vehicle_count from v_delegates limit 1) = 2, 'delegate linked to two vehicles without repeating data');
select rtst.ok(exists (select 1 from v_document_status where doc_type = 'delegate_license' and owner_id = 'b0000000-0000-0000-0000-000000000001' and status = 'no_date'), 'delegate licence appears in alerts (no date)');

-- plan (vehicle 1: documents expired, so its steps wait for the user)
update documents set expiry_date = app_today() - 5 where vehicle_id = 'b0000000-0000-0000-0000-000000000001' and doc_type in ('periodic_inspection', 'registration');
update vehicles set insurance_expiry = app_today() - 5 where id = 'b0000000-0000-0000-0000-000000000001';
select rtst.ok(create_renewal_plan('b0000000-0000-0000-0000-000000000001') is not null, 'plan created');
select rtst.ok((select count(*) from renewal_steps s join renewal_plans p on p.id = s.plan_id where p.vehicle_id = 'b0000000-0000-0000-0000-000000000001') = 5, 'plan has five steps');
select rtst.fails($$select create_renewal_plan('b0000000-0000-0000-0000-000000000001')$$, 'RENEWAL_PLAN_EXISTS', 'only one active plan per vehicle');
select rtst.ok((select next_step from v_renewal_plans where vehicle_id = 'b0000000-0000-0000-0000-000000000001') = 1, 'next step is 1');
select rtst.ok((save_renewal_step((select id from renewal_plans limit 1), 4, '{"notes":"early"}', false))->>'status' = 'entered', 'steps are open: a later step can be recorded first');
select rtst.fails(format($$select save_renewal_step(%L, 1, '{}', true)$$, (select id from renewal_plans limit 1)), 'RENEWAL_DATE_REQUIRED', 'licence step needs a valid date');

-- saving without confirming: waiting for confirmation, not complete
select save_renewal_step((select id from renewal_plans limit 1), 1, jsonb_build_object('new_expiry', (app_today() + 400)::text), false);
select rtst.ok((select status from renewal_steps where step_no = 1) = 'entered', 'saved step waits for confirmation');
select rtst.ok((select license_expiry from delegates limit 1) is null, 'nothing written before confirmation');
select save_renewal_step((select id from renewal_plans limit 1), 1, '{}', true);
select rtst.ok((select status from renewal_steps where step_no = 1) = 'done', 'confirmed step is complete');
select rtst.ok((select license_expiry from delegates limit 1) = app_today() + 400, 'licence date written to the delegate file');
select rtst.ok((select next_step from v_renewal_plans limit 1) = 2, 'next step moves to 2');

-- inspection: failed result cannot complete
select save_renewal_step((select id from renewal_plans limit 1), 2, jsonb_build_object('result', 'failed', 'new_expiry', (app_today() + 365)::text), false);
select rtst.fails(format($$select save_renewal_step(%L, 2, '{}', true)$$, (select id from renewal_plans limit 1)), 'RENEWAL_INSPECTION_NOT_PASSED', 'failed inspection is not complete');
select save_renewal_step((select id from renewal_plans limit 1), 2, '{"result":"passed"}', true);
select rtst.ok((select max(expiry_date) from documents where vehicle_id = 'b0000000-0000-0000-0000-000000000001' and doc_type = 'periodic_inspection') = app_today() + 365, 'inspection date written to the vehicle documents');

-- card -> plan: insurance updated in the vehicle card completes step 3
update vehicles set insurance_expiry = app_today() + 300 where id = 'b0000000-0000-0000-0000-000000000001';
select rtst.ok((select status || '/' || source from renewal_steps where step_no = 3) = 'done/card', 'insurance from the card completes step 3');
select rtst.fails(format($$select save_renewal_step(%L, 4, '{}', true)$$, (select id from renewal_plans limit 1)), 'RENEWAL_FINES_REQUIRED', 'fines step needs a status');
select save_renewal_step((select id from renewal_plans limit 1), 4, '{"fines_status":"paid","notes":"paid"}', true);
select rtst.fails(format($$select save_renewal_step(%L, 5, jsonb_build_object('new_expiry', (app_today() - 1)::text), true)$$, (select id from renewal_plans limit 1)), 'RENEWAL_DATE_PAST', 'past date refused');
select save_renewal_step((select id from renewal_plans limit 1), 5, jsonb_build_object('new_expiry', (app_today() + 700)::text), true);
select rtst.ok((select status from renewal_plans limit 1) = 'completed', 'plan complete after the five steps');
select rtst.ok((select completed_at from renewal_plans limit 1) is not null, 'completion time saved');
select rtst.ok((select count(*) from audit_log where table_name = 'renewal_steps') > 0, 'steps are in the audit log');

-- shared licence step: a second vehicle of the same delegate gets step 1 when the licence is renewed
select create_renewal_plan('b0000000-0000-0000-0000-000000000002');
update delegates set license_expiry = app_today() + 800;
select rtst.ok((select s.status from renewal_steps s join renewal_plans p on p.id = s.plan_id where p.vehicle_id = 'b0000000-0000-0000-0000-000000000002' and s.step_no = 1) = 'done', 'licence renewal applies to every vehicle of the delegate');

-- automatic completion: valid documents (more than 30 days) complete their steps; fines stay manual
update vehicles set insurance_expiry = app_today() + 200 where id = 'b0000000-0000-0000-0000-000000000003';
insert into documents(doc_type, vehicle_id, expiry_date) values ('registration', 'b0000000-0000-0000-0000-000000000003', app_today() + 300), ('periodic_inspection', 'b0000000-0000-0000-0000-000000000003', app_today() + 10);
select create_renewal_plan('b0000000-0000-0000-0000-000000000003');
select rtst.ok((select string_agg(s.step_no || ':' || s.status || ':' || coalesce(s.source, ''), ',' order by s.step_no) from renewal_steps s join renewal_plans p on p.id = s.plan_id where p.vehicle_id = 'b0000000-0000-0000-0000-000000000003')
  = '1:pending:,2:pending:,3:done:auto,4:pending:,5:done:auto', 'valid insurance and registration complete automatically; inspection within 30 days and fines do not');
update vehicles set delegate_id = (select id from delegates order by created_at limit 1) where id = 'b0000000-0000-0000-0000-000000000003';
select rtst.ok((select s.status || ':' || s.source from renewal_steps s join renewal_plans p on p.id = s.plan_id where p.vehicle_id = 'b0000000-0000-0000-0000-000000000003' and s.step_no = 1) = 'done:auto', 'linking a delegate with a valid licence completes step 1');
select rtst.ok(refresh_renewal_plan((select id from renewal_plans where vehicle_id = 'b0000000-0000-0000-0000-000000000003')) = 0, 'refresh is safe to repeat');
-- changing the delegate re-checks step 1: a new delegate without a licence date -> pending again; valid licence -> done
insert into delegates(full_name) values ('Test Delegate B');
update vehicles set delegate_id = (select id from delegates where full_name = 'Test Delegate B') where id = 'b0000000-0000-0000-0000-000000000003';
select rtst.ok((select s.status from renewal_steps s join renewal_plans p on p.id = s.plan_id where p.vehicle_id = 'b0000000-0000-0000-0000-000000000003' and s.step_no = 1) = 'pending', 'new delegate without licence date: step 1 not complete');
select rtst.ok((select authorized_name from vehicles where id = 'b0000000-0000-0000-0000-000000000003') = 'Test Delegate B', 'card shows the new delegate');
update vehicles set delegate_id = (select id from delegates where code = 'DLG-0001') where id = 'b0000000-0000-0000-0000-000000000003';
select rtst.ok((select s.status || ':' || s.source from renewal_steps s join renewal_plans p on p.id = s.plan_id where p.vehicle_id = 'b0000000-0000-0000-0000-000000000003' and s.step_no = 1) = 'done:auto', 'back to a delegate with a valid licence: step 1 complete');
insert into delegates(full_name) values (U&'\0627\062D\0645\062F \0639\0644\064A ');
select rtst.ok(exists (select 1 from jsonb_array_elements(delegate_duplicates()) x where x->>'reason' = 'name'), 'duplicate delegate detected');
select merge_delegates((select id from delegates where code = 'DLG-0001'), (select id from delegates where code <> 'DLG-0001' and full_name <> 'Test Delegate B' and deleted_at is null));
select rtst.ok(jsonb_array_length(delegate_duplicates()) = 0, 'no duplicates after merge');
select rtst.ok((select count(*) from delegates where full_name <> 'Test Delegate B') = 2 and (select count(*) from delegates where deleted_at is not null) = 1, 'merged delegate archived, not deleted');

-- archive (no hard delete)
select archive_renewal_plan((select id from renewal_plans where vehicle_id = 'b0000000-0000-0000-0000-000000000002'), 'test');
select rtst.ok((select count(*) from renewal_plans) = 3 and not exists (select 1 from v_renewal_plans where vehicle_id = 'b0000000-0000-0000-0000-000000000002'), 'archived plan kept but hidden');
select rtst.fails($$delete from renewal_plans$$, 'permission denied', 'plans cannot be deleted');
select rtst.fails($$update renewal_steps set status = 'done'$$, 'permission denied', 'steps change only through the functions');

-- plan note (internal)
select rtst.ok(set_renewal_plan_note((select id from renewal_plans where vehicle_id = 'b0000000-0000-0000-0000-000000000003'), '  test note  ') = 'test note', 'note saved on the plan');
select rtst.ok((select notes from v_renewal_plans where vehicle_id = 'b0000000-0000-0000-0000-000000000003') = 'test note', 'note visible with the plan');
-- skip the delegate step (step 1 only)
select rtst.fails(format($$select skip_renewal_step(%L, 2, 'x')$$, (select id from renewal_plans where vehicle_id = 'b0000000-0000-0000-0000-000000000003')), 'RENEWAL_SKIP_NOT_ALLOWED', 'only the delegate and fines steps can be skipped');
select skip_renewal_step((select id from renewal_plans where vehicle_id = 'b0000000-0000-0000-0000-000000000003'), 4, 'no fines');
select rtst.ok((select s.status || ':' || s.source from renewal_steps s join renewal_plans p on p.id = s.plan_id where p.vehicle_id = 'b0000000-0000-0000-0000-000000000003' and s.step_no = 4) = 'done:skip', 'fines step skipped');
-- view-only user
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
select rtst.fails($$select create_renewal_plan('b0000000-0000-0000-0000-000000000003')$$, 'PERMISSION_DENIED', 'view-only user cannot create a plan');
select rtst.fails(format($$select save_renewal_step(%L, 1, '{}', true)$$, gen_random_uuid()), 'PERMISSION_DENIED', 'view-only user cannot confirm steps');
select rtst.ok((select count(*) from delegate_private) = 0, 'view-only user sees no licence numbers or mobiles');
select rtst.fails($$select set_renewal_plan_note(gen_random_uuid(), 'x')$$, 'PERMISSION_DENIED', 'view-only user cannot write notes');
select rtst.ok((select count(*) from v_renewal_plans) = 2, 'view-only user can read plans');
reset role;
select rtst.ok(not has_function_privilege('anon', 'public.create_renewal_plan(uuid, text)', 'execute'), 'visitors cannot call the plan functions');
select rtst.ok('delegates' = any(backup_table_list()) and 'renewal_steps' = any(backup_table_list()), 'new tables included in backups');
drop schema rtst cascade;
