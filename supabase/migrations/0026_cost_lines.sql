-- 0026: maintenance costs page ("takalif al-siyana"): maintenance + oil + tires + batteries from the owner's Excel file.
--  * cost_lines: one row per Excel row (sheet + row number = stable key). Linked to the vehicle by its internal id
--    (matched from the plate digits; unmatched rows keep vehicle_id null and the plate text).
--  * sync_cost_lines(jsonb): insert new rows, update changed rows, and ARCHIVE (is_active = false) rows that are no
--    longer in the Excel sheet. Nothing is ever deleted. Needs the 'import' or 'edit' permission.
--  * readable by anyone with 'view'. No direct insert/update/delete from the browser.
-- No existing table, column or row changes. ASCII only. Safe to run more than once.
-- =====================================================================
create table if not exists cost_lines (
  id             uuid primary key default gen_random_uuid(),
  category       text not null check (category in ('maintenance', 'oil', 'tires', 'batteries')),
  source_sheet   text not null,
  source_row     int  not null,
  vehicle_id     uuid references vehicles(id),
  plate_text     text,
  company_name   text,
  site_name      text,
  brand          text,
  user_name      text,
  line_date      date,
  description    text,
  quantity       numeric(10,2),
  supplier       text,
  invoice_no     text,
  amount         numeric(12,2) not null default 0,
  payment_status text,
  payment_method text,
  payer          text,
  doc_type       text,
  attachment_url text,
  notes          text,
  row_hash       text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  synced_at      timestamptz not null default now(),
  unique (source_sheet, source_row)
);
create index if not exists cost_lines_vehicle_idx on cost_lines(vehicle_id, line_date desc);
create index if not exists cost_lines_cat_idx on cost_lines(category, line_date desc);
alter table cost_lines enable row level security;
revoke all on cost_lines from anon, public;
revoke insert, update, delete, truncate, references, trigger on cost_lines from authenticated;
grant select on cost_lines to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cost_lines' and policyname = 'p_select') then
    create policy p_select on cost_lines for select to authenticated using (has_perm('view'));
  end if;
end $$;

-- p_rows: [{category, source_sheet, source_row, plate, company, site, brand, user_name, date (YYYY-MM-DD), description,
--           quantity, supplier, invoice_no, amount, payment_status, payment_method, payer, doc_type, attachment_url, notes}]
-- p_sheets: the sheets that were read in full (rows of these sheets missing from p_rows are archived).
create or replace function sync_cost_lines(p_rows jsonb, p_sheets text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_id uuid; v_hash text; v_old cost_lines; n_new int := 0; n_upd int := 0; n_same int := 0; n_arch int := 0; n_back int := 0;
  v_digits text; v_cnt int;
begin
  if auth.uid() is not null and not (has_perm('import') or has_perm('edit')) then
    raise exception 'not allowed';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_hash := md5(r::text);
    v_digits := regexp_replace(coalesce(r->>'plate', ''), '\D', '', 'g');
    v_id := null;
    if v_digits <> '' then
      select count(*), min(id::text)::uuid into v_cnt, v_id from vehicles
       where deleted_at is null and regexp_replace(coalesce(plate_no, ''), '\D', '', 'g') = v_digits;
      if v_cnt <> 1 then v_id := null; end if;
    end if;
    select * into v_old from cost_lines where source_sheet = r->>'source_sheet' and source_row = (r->>'source_row')::int;
    if not found then
      insert into cost_lines (category, source_sheet, source_row, vehicle_id, plate_text, company_name, site_name, brand, user_name,
        line_date, description, quantity, supplier, invoice_no, amount, payment_status, payment_method, payer, doc_type, attachment_url, notes, row_hash)
      values (r->>'category', r->>'source_sheet', (r->>'source_row')::int, v_id, r->>'plate', r->>'company', r->>'site', r->>'brand', r->>'user_name',
        nullif(r->>'date', '')::date, r->>'description', nullif(r->>'quantity', '')::numeric, r->>'supplier', r->>'invoice_no',
        coalesce(nullif(r->>'amount', '')::numeric, 0), r->>'payment_status', r->>'payment_method', r->>'payer', r->>'doc_type', r->>'attachment_url', r->>'notes', v_hash);
      n_new := n_new + 1;
    elsif v_old.row_hash is distinct from v_hash or not v_old.is_active or v_old.vehicle_id is distinct from v_id then
      if not v_old.is_active then n_back := n_back + 1; end if;
      update cost_lines set category = r->>'category', vehicle_id = v_id, plate_text = r->>'plate', company_name = r->>'company',
        site_name = r->>'site', brand = r->>'brand', user_name = r->>'user_name', line_date = nullif(r->>'date', '')::date,
        description = r->>'description', quantity = nullif(r->>'quantity', '')::numeric, supplier = r->>'supplier', invoice_no = r->>'invoice_no',
        amount = coalesce(nullif(r->>'amount', '')::numeric, 0), payment_status = r->>'payment_status', payment_method = r->>'payment_method',
        payer = r->>'payer', doc_type = r->>'doc_type', attachment_url = r->>'attachment_url', notes = r->>'notes',
        row_hash = v_hash, is_active = true, updated_at = now(), synced_at = now()
       where id = v_old.id;
      n_upd := n_upd + 1;
    else
      update cost_lines set synced_at = now() where id = v_old.id;
      n_same := n_same + 1;
    end if;
  end loop;
  -- rows that disappeared from a sheet that was read in full: archived, never deleted
  if p_sheets is not null then
    update cost_lines c set is_active = false, updated_at = now()
     where c.is_active and c.source_sheet = any(p_sheets)
       and not exists (select 1 from jsonb_array_elements(p_rows) x
                        where x->>'source_sheet' = c.source_sheet and (x->>'source_row')::int = c.source_row);
    get diagnostics n_arch = row_count;
  end if;
  return jsonb_build_object('new', n_new, 'updated', n_upd, 'unchanged', n_same, 'archived', n_arch, 'restored', n_back);
end $$;
revoke execute on function sync_cost_lines(jsonb, text[]) from public, anon;
grant execute on function sync_cost_lines(jsonb, text[]) to authenticated;

-- backups include the new table
create or replace function backup_table_list() returns text[] language sql immutable as $$
  select array['companies', 'sites', 'site_history', 'app_settings', 'profiles', 'user_permissions', 'employees', 'employee_private',
               'delegates', 'delegate_private',
               'vehicles', 'vehicle_private', 'odometer_readings', 'vehicle_field_history', 'authorizations', 'documents',
               'oil_changes', 'maintenance', 'maintenance_items', 'maintenance_requests', 'accidents', 'handovers',
               'vehicle_assignments', 'housing_maintenance', 'food_supplies', 'attachments', 'import_batches',
               'renewal_plans', 'renewal_steps', 'cost_lines', 'audit_log']
$$;
revoke execute on function backup_table_list() from public, anon;

select 'COST_LINES_OK' as result;
