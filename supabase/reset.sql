-- Removes everything created by setup_clean.sql so it can be run again from scratch.
-- Use ONLY before any real data is entered.
drop trigger if exists on_auth_user_created on auth.users;
drop policy if exists attachments_read on storage.objects;
drop policy if exists attachments_upload on storage.objects;
drop view if exists v_followups, v_expenses, v_vehicles_overview, v_vehicle_oil_status,
  v_document_status, v_vehicle_authorization cascade;
drop table if exists import_batches, audit_log, attachments, food_supplies, housing_maintenance,
  vehicle_assignments, handovers, accidents, maintenance_items, maintenance, oil_changes, documents,
  authorizations, odometer_readings, vehicle_field_history, vehicles, employee_private, employees,
  site_history, sites, companies, user_permissions, profiles, app_settings cascade;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'app_today','fmt_date','fmt_datetime','parse_app_date','current_uid','is_admin','has_perm',
             'setting_int','doc_alert_days','trg_set_updated_at','trg_block_delete','trg_audit','trg_site_history',
             'trg_vehicle_before','vehicle_ref_label','trg_vehicle_after','bump_odometer','correct_odometer',
             'trg_vehicle_op_snapshot','trg_vehicle_op_bump','trg_fill_company_from_site','recalc_maintenance',
             'trg_maintenance_items_recalc','trg_handover_before','trg_handover_after','handle_new_user',
             'dashboard_stats','can_see_attachment','trg_protect_admin','trg_protect_grant')
  loop execute 'drop function if exists ' || r.f || ' cascade'; end loop;
end $$;
drop sequence if exists employee_code_seq, vehicle_code_seq, oil_no_seq, maint_no_seq, accident_no_seq,
  handover_no_seq, housing_no_seq, food_no_seq;
drop type if exists site_kind, employee_status, vehicle_op_status, vehicle_location, doc_type, payment_status,
  accident_status, handover_kind, handover_state, maint_item_kind, odometer_source, app_permission cascade;
