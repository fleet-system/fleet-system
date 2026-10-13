// تحويل النص الحر (شركة، موقع، شخص) إلى سجل مرتبط: يُستخدم السجل الموجود إن وُجد، وإلا يُسجَّل اسم جديد
import * as api from './api.js';
import * as data from './data.js';

const norm = (s) => String(s ?? '').replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim();
const same = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();

export const companyNames = () => data.companyOptions(false).map(([, n]) => n);
export const siteNames = () => (data.cache()?.sites || []).map((s) => s.name);
export const employeeLabels = () => (data.cache()?.employees || []).filter((e) => e.status !== 'terminated').map((e) => `${e.full_name} (${e.code})`);
export const employeeNamesPlain = () => [...new Set((data.cache()?.employees || []).map((e) => e.full_name))];

// اسم الشركة → معرّفها (تُسجَّل الشركة الجديدة تلقائياً)
export async function resolveCompany(text) {
  const t = norm(text); if (!t) return null;
  const hit = data.companyOptions(false).find(([, n]) => same(n, t));
  if (hit) return hit[0];
  const id = await api.rpc('ensure_company', { p_name: t });
  data.cache()?.companies.push({ id, name: t, is_active: true });
  return id;
}

// اسم الموقع/المشروع → معرّفه (الموقع الجديد يُسجَّل تحت الشركة المحددة)
export async function resolveSite(text, companyId) {
  const t = norm(text); if (!t) return null;
  const hit = (data.cache()?.sites || []).find((s) => same(s.name, t) || same(`${s.name} — ${data.companyName(s.company_id)}`, t));
  if (hit) return hit.id;
  const id = await api.rpc('ensure_site', { p_name: t, p_company: companyId || null });
  if (!(data.cache()?.sites || []).some((x) => x.id === id)) data.cache()?.sites.push({ id, name: t, company_id: companyId, kind: 'other', is_active: true });
  return id;
}

// اسم الموظف → معرّفه. يقبل «الاسم (EMP-0001)» أو الاسم وحده؛ الاسم الجديد يُنشأ له ملف موظف
export async function resolveEmployee(text, { company_id = null, site_id = null, job_title = 'سائق' } = {}) {
  const t = norm(text); if (!t) return null;
  const emps = data.cache()?.employees || [];
  const code = (t.match(/\((EMP-\d+)\)\s*$/) || [])[1];
  if (code) { const e = emps.find((x) => x.code === code); if (e) return e.id; }
  const name = norm(t.replace(/\((EMP-\d+)\)\s*$/, ''));
  const hit = emps.find((e) => same(e.full_name, name) && e.status !== 'terminated') || emps.find((e) => same(e.full_name, name));
  if (hit) return hit.id;
  const [row] = await api.insert('employees', { full_name: name, company_id, site_id, job_title, notes: 'أُضيف تلقائياً عند كتابة اسمه في ملف سيارة' });
  data.cache()?.employees.push(row);
  return row.id;
}
export const employeeLabel = (id) => { const e = (data.cache()?.employees || []).find((x) => x.id === id); return e ? `${e.full_name} (${e.code})` : ''; };
