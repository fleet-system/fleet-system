-- Phase 8 hardening (safe to run more than once).
-- Functions created after the general revoke in 0003 kept the default EXECUTE grant for anon/public.
-- They are harmless (trigger functions cannot be called directly; can_see_attachment returns false
-- for anon), but nothing in public should be callable by a signed-out visitor.
revoke execute on function public.can_see_attachment(text), public.trg_protect_admin(), public.trg_protect_grant() from public, anon;
grant execute on function public.can_see_attachment(text) to authenticated;
-- Re-assert: signed-out visitors have no access to any table, view, sequence or function in public.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
-- Future objects created by migrations will not be granted to anon automatically.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;
-- Supabase grants ALL (incl. DELETE and TRUNCATE) on new tables to authenticated by default.
-- Records are never deleted in this system (archive only), so remove those rights at the privilege level too
-- (RLS already blocks row deletes; TRUNCATE is not covered by RLS, so it is revoked explicitly).
revoke delete, truncate, references, trigger on all tables in schema public from authenticated;
grant delete on public.user_permissions to authenticated;
revoke insert, update on public.audit_log from authenticated;
revoke insert, update, delete, truncate, references, trigger on
  public.v_vehicle_authorization, public.v_document_status, public.v_vehicle_oil_status,
  public.v_vehicles_overview, public.v_expenses, public.v_followups from authenticated;
alter default privileges in schema public revoke delete, truncate, references, trigger on tables from authenticated;
select 'HARDENING_OK' as result;
