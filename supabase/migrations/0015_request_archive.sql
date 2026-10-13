-- =====================================================================
-- 0015: Deleting a maintenance request moves it to an archived log (nothing is ever removed).
-- The request keeps its number, content, attachments, linked invoice and full audit history,
-- disappears from lists, alerts and reports, and can be restored as it was.
-- ASCII only. Safe to run more than once. Adds columns and functions only; no data is changed.
-- =====================================================================

alter table maintenance_requests add column if not exists deleted_by    uuid;
alter table maintenance_requests add column if not exists delete_reason text;
alter table maintenance_requests add column if not exists restored_at   timestamptz;
alter table maintenance_requests add column if not exists restored_by   uuid;
alter table maintenance_requests add column if not exists restore_note  text;

-- move a request to the archived log
create or replace function archive_request(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r maintenance_requests%rowtype;
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into r from maintenance_requests where id = p_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.deleted_at is not null then raise exception 'REQUEST_ALREADY_ARCHIVED'; end if;
  update maintenance_requests
     set deleted_at = now(), deleted_by = auth.uid(), delete_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id returning * into r;
  return jsonb_build_object('id', r.id, 'request_no', r.request_no, 'deleted_at', r.deleted_at);
end $$;

-- bring the same request back (same number, status and records)
create or replace function restore_request(p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r maintenance_requests%rowtype;
begin
  if not has_perm('edit') then raise exception 'PERMISSION_DENIED' using errcode = '42501'; end if;
  select * into r from maintenance_requests where id = p_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.deleted_at is null then raise exception 'REQUEST_NOT_ARCHIVED'; end if;
  update maintenance_requests
     set deleted_at = null, restored_at = now(), restored_by = auth.uid(), restore_note = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id returning * into r;
  return jsonb_build_object('id', r.id, 'request_no', r.request_no, 'restored_at', r.restored_at);
end $$;

revoke execute on function archive_request(uuid, text), restore_request(uuid, text) from public, anon;
grant execute on function archive_request(uuid, text), restore_request(uuid, text) to authenticated;

-- the archived log (with the names of who deleted / restored)
drop view if exists v_requests_archive;
create view v_requests_archive with (security_invoker = true) as
select r.*,
  user_display_name(r.deleted_by)  as deleted_by_name,
  user_display_name(r.restored_by) as restored_by_name,
  s.name as site_name,
  c.name as company_name,
  v.code as vehicle_code
from maintenance_requests r
left join sites s on s.id = r.site_id
left join companies c on c.id = r.company_id
left join vehicles v on v.id = r.vehicle_id;

revoke all on v_requests_archive from anon;
revoke insert, update, delete, truncate, references, trigger on v_requests_archive from authenticated;
grant select on v_requests_archive to authenticated;

select 'REQUEST_ARCHIVE_OK' as result;
