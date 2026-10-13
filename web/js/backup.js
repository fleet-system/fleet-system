// النسخ الاحتياطي الكامل (ملف JSON) وتوليد ملف استعادة SQL لمشروع Supabase جديد
import * as api from './api.js';
import { todayISO } from './fmt.js';

// ترتيب الجداول حسب العلاقات (الأب قبل الابن)
export const TABLES = [
  'companies', 'sites', 'site_history', 'app_settings', 'profiles', 'user_permissions',
  'employees', 'employee_private', 'vehicles', 'vehicle_private', 'odometer_readings', 'vehicle_field_history',
  'authorizations', 'documents', 'oil_changes', 'maintenance', 'maintenance_items', 'maintenance_requests', 'accidents',
  'handovers', 'vehicle_assignments', 'housing_maintenance', 'food_supplies', 'attachments', 'import_batches', 'audit_log',
];
// أعمدة محسوبة تلقائياً لا تُدرج
const GENERATED = {
  oil_changes: ['next_odometer', 'total'], maintenance: ['subtotal', 'total'], maintenance_items: ['line_total'],
  accidents: ['total'], housing_maintenance: ['total'], food_supplies: ['subtotal', 'total'], attachments: ['sensitivity'],
};
const IDENTITY = ['site_history', 'odometer_readings', 'vehicle_field_history', 'audit_log'];
const SEQS = [
  ['employee_code_seq', 'employees', 'code'], ['vehicle_code_seq', 'vehicles', 'code'], ['oil_no_seq', 'oil_changes', 'oil_no'],
  ['maint_no_seq', 'maintenance', 'maint_no'], ['accident_no_seq', 'accidents', 'accident_no'], ['handover_no_seq', 'handovers', 'form_no'],
  ['housing_no_seq', 'housing_maintenance', 'op_no'], ['food_no_seq', 'food_supplies', 'op_no'],
  ['maint_request_no_seq', 'maintenance_requests', 'request_no'],
];

async function fetchAll(table) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const page = await api.get(table, { select: '*', limit: 1000, offset: off, order: table === 'profiles' ? 'user_id' : table === 'user_permissions' ? 'user_id' : table === 'app_settings' ? 'key' : table === 'employee_private' ? 'employee_id' : table === 'vehicle_private' ? 'vehicle_id' : 'id' })
      .catch((e) => { if (table === 'vehicle_private') return []; throw e; });
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

function saveFile(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export async function downloadBackup(onProgress = () => {}) {
  const tables = {};
  for (const [i, t] of TABLES.entries()) {
    onProgress(`جارٍ نسخ ${i + 1} من ${TABLES.length}…`);
    try { tables[t] = await fetchAll(t); } catch (e) { if (t === 'import_batches' || t === 'maintenance_requests') tables[t] = []; else throw e; }
  }
  const created = new Date().toISOString();
  const backup = { format: 'fleet-backup', version: 1, created_at: created, tables };
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  saveFile(`fleet-backup-${todayISO()}.json`, JSON.stringify(backup), 'application/json');
  // تسجيل وقت آخر نسخة (للتذكير)
  const val = { at: created, counts };
  const upd = await api.update('app_settings', { key: 'eq.last_backup' }, { value: val });
  if (!upd.length) await api.insert('app_settings', { key: 'last_backup', value: val, description: 'آخر نسخة احتياطية' });
  return counts;
}

// نص SQL بحروف إنجليزية فقط (حتى لا يغيّره الآيفون عند النسخ واللصق)
function asciiLiteral(text) {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (c >= 32 && c < 127) out += ch;
    else out += c > 0xFFFF ? `\\+${c.toString(16).toUpperCase().padStart(6, '0')}` : `\\${c.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return `U&'${out}'`;
}

export function buildRestoreSql(backup) {
  if (backup?.format !== 'fleet-backup') throw new Error('هذا الملف ليس نسخة احتياطية من النظام.');
  const L = [];
  L.push('-- Fleet system restore file. Run ONCE in a NEW Supabase project, after setup_clean.sql, before entering any data.');
  L.push(`-- Backup taken at ${backup.created_at}`);
  L.push('begin;');
  L.push(`do $$ begin if exists (select 1 from public.vehicles) or exists (select 1 from public.employees) then raise exception 'RESTORE_ABORTED: target database already has data'; end if; end $$;`);
  for (const t of TABLES) L.push(`alter table public.${t} disable trigger user;`);
  L.push('delete from public.app_settings; delete from public.sites; delete from public.companies;');
  for (const t of TABLES) {
    let rows = backup.tables[t] || [];
    if (!rows.length) continue;
    const gen = new Set(GENERATED[t] || []);
    const cols = Object.keys(rows[0]).filter((c) => !gen.has(c));
    const colList = cols.map((c) => `"${c}"`).join(', ');
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
      const src = `jsonb_populate_recordset(null::public.${t}, ${asciiLiteral(JSON.stringify(chunk))}::jsonb)`;
      let where = '';
      if (t === 'profiles') where = ' where exists (select 1 from auth.users u where u.id = r.user_id)';
      if (t === 'user_permissions') where = ' where exists (select 1 from public.profiles p where p.user_id = r.user_id)';
      L.push(`insert into public.${t} (${colList}) ${IDENTITY.includes(t) ? 'overriding system value ' : ''}select ${cols.map((c) => `r."${c}"`).join(', ')} from ${src} r${where} on conflict do nothing;`);
    }
  }
  for (const [seq, t, col] of SEQS) L.push(`select setval('public.${seq}', greatest(coalesce((select max(nullif(regexp_replace(${col}, '\\D', '', 'g'), '')::bigint) from public.${t}), 0), 1));`);
  for (const t of IDENTITY) L.push(`select setval(pg_get_serial_sequence('public.${t}', 'id'), greatest(coalesce((select max(id) from public.${t}), 0), 1));`);
  for (const t of TABLES) L.push(`alter table public.${t} enable trigger user;`);
  L.push('commit;');
  L.push("select 'RESTORE_OK' as result, (select count(*) from public.vehicles) as vehicles, (select count(*) from public.employees) as employees;");
  return L.join('\n') + '\n';
}

export async function restoreFileFromBackup(file) {
  const backup = JSON.parse(await file.text());
  const sql = buildRestoreSql(backup);
  saveFile(`fleet-restore-${String(backup.created_at).slice(0, 10)}.sql`, sql, 'text/plain');
  return Object.fromEntries(Object.entries(backup.tables).map(([k, v]) => [k, v.length]));
}
