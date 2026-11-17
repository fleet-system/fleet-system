-- 0027: security hardening (owner request after the security check, 2026/11/17).
-- Pin search_path on 16 helper functions flagged by the Supabase security advisor
-- (function_search_path_mutable). Metadata only: no tables, rows or function bodies change.
-- Safe to run more than once.
alter function public._rec_label(text, jsonb) set search_path = public;
alter function public.app_schema_version() set search_path = public;
alter function public.app_today() set search_path = public;
alter function public.backup_table_list() set search_path = public;
alter function public.can_see_attachment(text) set search_path = public;
alter function public.correct_odometer(uuid, integer, text) set search_path = public;
alter function public.current_uid() set search_path = public;
alter function public.dashboard_stats(uuid, uuid, integer, integer) set search_path = public;
alter function public.fmt_date(date) set search_path = public;
alter function public.fmt_datetime(timestamp with time zone) set search_path = public;
alter function public.parse_app_date(text) set search_path = public;
alter function public.renewal_step_key(integer) set search_path = public;
alter function public.restore_table_list() set search_path = public;
alter function public.trg_block_delete() set search_path = public;
alter function public.trg_set_updated_at() set search_path = public;
alter function public.trg_vehicle_before() set search_path = public;

select 'SEARCH_PATH_OK' as result;
