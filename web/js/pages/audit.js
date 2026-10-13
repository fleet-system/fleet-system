// سجل التعديلات: من عدّل، ومتى، وماذا تغيّر
import * as api from '../api.js';
import { html, raw, $ } from '../ui.js';
import { dateTime, parseDate, num, LABELS } from '../fmt.js';

const TABLES = {
  vehicles: 'السيارات', employees: 'الموظفون', employee_private: 'بيانات الموظف الحساسة', vehicle_private: 'هويات السيارة (حساسة)', documents: 'الوثائق', authorizations: 'التفويضات',
  oil_changes: 'تغيير الزيت', maintenance: 'الصيانة', maintenance_items: 'بنود الصيانة', maintenance_requests: 'طلبات الصيانة', accidents: 'الحوادث', handovers: 'نماذج التسليم',
  housing_maintenance: 'صيانة السكن', food_supplies: 'توريد الطعام', attachments: 'المرفقات', companies: 'الشركات', sites: 'المواقع',
  profiles: 'المستخدمون', user_permissions: 'الصلاحيات', app_settings: 'الإعدادات',
};
const ACTIONS = { INSERT: 'إضافة', UPDATE: 'تعديل', ARCHIVE: 'أرشفة', RESTORE: 'استعادة', DELETE: 'حذف', IMPORT: 'استيراد' };
export const FIELDS = {
  plate_no: 'رقم اللوحة', make: 'ماركة السيارة', vehicle_type: 'نوع السيارة', model: 'طراز المركبة', manufacture_year: 'الموديل (سنة الصنع)', color: 'اللون', vin: 'رقم الهيكل', engine_no: 'رقم المحرك',
  owner_company_id: 'الشركة المالكة', site_id: 'الموقع', company_id: 'الشركة', current_driver_id: 'السائق المسؤول', odometer: 'العداد', location_status: 'موقع السيارة',
  op_status: 'حالة السيارة', op_state: 'الحالة التشغيلية', op_state_text: 'وصف الحالة التشغيلية', wheels_count: 'عدد العجلات', insurance_expiry: 'تاريخ انتهاء التأمين',
  cost_oil: 'تكلفة تغيير الزيت', cost_maint: 'تكلفة الصيانة', cost_maint_total: 'إجمالي تكلفة الصيانة', registration_type: 'نوع التسجيل', registration_serial: 'الرقم التسلسلي للاستمارة',
  current_user_name: 'المستخدم الحالي', current_user_mobile: 'رقم هاتف السائق', id_numbers: 'أرقام الهوية', site_entry_date: 'تاريخ الدخول للموقع', oil_interval_km: 'فترة الزيت', notes: 'ملاحظات', full_name: 'الاسم', job_title: 'المسمى الوظيفي',
  status: 'الحالة', iqama_no: 'رقم الإقامة', mobile: 'الجوال', driving_license_no: 'رقم الرخصة', doc_type: 'نوع الوثيقة', doc_no: 'رقم الوثيقة', issue_date: 'تاريخ الإصدار',
  expiry_date: 'تاريخ الانتهاء', is_authorized: 'مفوّض', auth_no: 'رقم التفويض', change_date: 'تاريخ تغيير الزيت', interval_km: 'فترة التغيير', workshop: 'الورشة',
  oil_type: 'نوع الزيت', filter_type: 'نوع الفلتر', oil_cost: 'تكلفة الزيت', filter_cost: 'تكلفة الفلتر', extra_cost: 'تكاليف إضافية', invoice_no: 'رقم الفاتورة',
  payment_status: 'حالة السداد', payer_company_id: 'الجهة الدافعة', maint_date: 'تاريخ الصيانة', maint_type: 'نوع الصيانة', fault_description: 'وصف العطل',
  vat_amount: 'الضريبة', parts_cost: 'قطع الغيار', labor_cost: 'أجور العمل', other_cost: 'أخرى', status_before: 'الحالة قبل', status_after: 'الحالة بعد',
  occurred_at: 'تاريخ ووقت الحادث', driver_id: 'السائق', description: 'الوصف', damages: 'الأضرار', repair_start_date: 'بدء الإصلاح', repair_end_date: 'انتهاء الإصلاح',
  back_to_work_date: 'العودة للعمل', kind: 'النوع', from_employee_id: 'المسلِّم', to_employee_id: 'المستلِم', fuel_level: 'الوقود', state: 'حالة النموذج',
  work_date: 'تاريخ الصيانة', contractor: 'المقاول', subtotal: 'قبل الضريبة', paid_date: 'تاريخ السداد', supply_date: 'تاريخ التوريد', supplier: 'المورد',
  quantity: 'الكمية', unit: 'الوحدة', unit_price: 'سعر الوحدة', deleted_at: 'الأرشفة', name: 'الاسم', is_active: 'نشط', is_admin: 'مسؤول', permission: 'الصلاحية',
  value: 'القيمة', category: 'نوع المستند', file_name: 'اسم الملف', description_item: 'البند',
  request_no: 'رقم الطلب', request_date: 'تاريخ الطلب', project_text: 'المشروع (نص)', equipment_text: 'المعدة', driver_name: 'المستخدم', meter_reading: 'كيلو متر / الساعة',
  meter_unit: 'وحدة العداد', fault: 'العطل', fault_cause: 'سبب العطل', technician_opinion: 'رأي الفني', site_notes: 'ملاحظات الموقع', last_change_date: 'تاريخ آخر تغيير',
  custom_fields: 'حقول إضافية', delete_reason: 'سبب الحذف', deleted_by: 'حذفها', restored_at: 'تاريخ الاسترداد', restored_by: 'استردها', change_note: 'سبب التعديل',
  supervisor_name: 'مشرف الصيانة', approver_name: 'المعتمد', approval_notes: 'ملاحظات الاعتماد', maintenance_id: 'فاتورة الصيانة',
};
export const VALUE_LABELS = { op_status: LABELS.op_status, op_state: { inside: 'تعمل داخل الموقع', outside: 'تعمل خارج الموقع', other: 'أخرى' }, location_status: LABELS.location_status, payment_status: LABELS.payment_status, status: { ...LABELS.accident_status, ...LABELS.employee_status, ...LABELS.mr_status }, meter_unit: LABELS.meter_unit, status_before: LABELS.op_status, status_after: LABELS.op_status, doc_type: LABELS.doc_type };
const HIDE = new Set(['updated_at', 'created_at', 'odometer_updated_at', 'subtotal', 'total', 'next_odometer', 'line_total', 'sensitivity', 'approved_at', 'approved_by', 'decided_at', 'decided_by', 'started_at', 'completed_at', 'created_by']);
const st = { table: '', action: '', user: '', from: '', to: '' };

function show(field, v, names) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (VALUE_LABELS[field]?.[v]) return VALUE_LABELS[field][v];
  if (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) return names.get(v) || '(سجل مرتبط)';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dateTime(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.replaceAll('-', '/');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function summaryOf(row) {
  const d = row.new_data || row.old_data || {};
  return d.request_no || d.code || d.plate_no || d.oil_no || d.maint_no || d.accident_no || d.form_no || d.op_no || d.full_name || d.name || d.file_name || d.description || d.key || d.permission || '';
}

export async function renderAudit(el) {
  if (!api.can('manage_users')) { el.innerHTML = html`<div class="empty"><h1>سجل التعديلات</h1><p>هذه الصفحة للمسؤول ومن يملك صلاحية «إدارة المستخدمين».</p></div>`; return; }
  const [profiles, companies, sites, employees, vehicles] = await Promise.all([
    api.get('profiles', { select: 'user_id,full_name,email' }),
    api.get('companies', { select: 'id,name' }), api.get('sites', { select: 'id,name' }),
    api.get('employees', { select: 'id,full_name' }), api.get('vehicles', { select: 'id,plate_no,code' }),
  ]);
  const names = new Map([...companies.map((x) => [x.id, x.name]), ...sites.map((x) => [x.id, x.name]), ...employees.map((x) => [x.id, x.full_name]), ...vehicles.map((x) => [x.id, `${x.plate_no} (${x.code})`]), ...profiles.map((p) => [p.user_id, p.full_name || p.email])]);
  const opt = (v, t, cur) => html`<option value="${v}" ${raw(v === cur ? 'selected' : '')}>${t}</option>`;
  el.innerHTML = html`
    <div class="page-head"><h1>سجل التعديلات</h1></div>
    <p class="muted note">كل إضافة أو تعديل أو أرشفة تُسجَّل هنا تلقائياً مع اسم المستخدم والوقت والقيم قبل التغيير وبعده. لا يمكن تعديل هذا السجل أو حذفه. أرقام الإقامة والجوال لا تُعرض هنا، يظهر فقط أنها تغيّرت.</p>
    <form class="filters wide-filters" onsubmit="return false">
      <label><span>القسم</span><select name="table">${raw(opt('', 'الكل', st.table))}${raw(Object.entries(TABLES).map(([k, t]) => opt(k, t, st.table)).join(''))}</select></label>
      <label><span>العملية</span><select name="action">${raw(opt('', 'الكل', st.action))}${raw(Object.entries(ACTIONS).map(([k, t]) => opt(k, t, st.action)).join(''))}</select></label>
      <label><span>المستخدم</span><select name="user">${raw(opt('', 'الكل', st.user))}${raw(profiles.map((p) => opt(p.user_id, p.full_name || p.email, st.user)).join(''))}</select></label>
      <label><span>من تاريخ</span><input name="from" type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" value="${st.from}"></label>
      <label><span>إلى تاريخ</span><input name="to" type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" value="${st.to}"></label>
    </form>
    <div class="audit-body"><div class="loading">جارٍ التحميل…</div></div>`;

  let seq = 0;
  const load = async () => {
    const my = ++seq;
    const q = { select: '*', order: 'changed_at.desc', limit: 300 };
    if (st.table) q.table_name = `eq.${st.table}`;
    if (st.action) q.action = `eq.${st.action}`;
    if (st.user) q.changed_by = `eq.${st.user}`;
    const box = $('.audit-body', el);
    try {
      const and = [];
      if (st.from) and.push(`changed_at.gte.${parseDate(st.from)}T00:00:00+03:00`);
      if (st.to) and.push(`changed_at.lte.${parseDate(st.to)}T23:59:59+03:00`);
      if (and.length) q.and = `(${and.join(',')})`;
    } catch (e) { box.innerHTML = html`<p class="form-error">${e.message}</p>`; return; }
    if (my !== seq) return;
    const rows = await api.get('audit_log', q);
    if (my !== seq) return; // نتيجة قديمة وصلت بعد تغيير الفلتر
    box.innerHTML = rows.length ? html`<p class="muted small">آخر <span class="num">${num(rows.length)}</span> عملية${rows.length === 300 ? ' (استخدم الفلاتر لعرض الأقدم)' : ''}</p>
      <ol class="audit">${raw(rows.map((r) => {
        const ch = Object.entries(r.changes || {}).filter(([k]) => !HIDE.has(k));
        return html`<li class="a-${r.action}">
          <div class="a-head"><span class="tag a-tag">${ACTIONS[r.action] || r.action}</span><b>${TABLES[r.table_name] || r.table_name}</b><span>${summaryOf(r)}</span></div>
          <div class="muted small"><span>${names.get(r.changed_by) || 'النظام'}</span> · <span class="num">${dateTime(r.changed_at)}</span></div>
          ${raw(ch.length ? html`<table class="diff"><tbody>${raw(ch.map(([k, c]) => html`<tr><th>${FIELDS[k] || k}</th><td class="old">${typeof c === 'string' ? 'تغيّرت القيمة (بيانات حساسة)' : show(k, c.old, names)}</td><td class="arrow">←</td><td class="new">${typeof c === 'string' ? '' : show(k, c.new, names)}</td></tr>`).join(''))}</tbody></table>` : '')}
        </li>`;
      }).join(''))}</ol>` : html`<div class="empty soft"><p>لا توجد عمليات مطابقة.</p></div>`;
  };
  await load();
  const f = $('form', el);
  f.addEventListener('change', () => { st.table = f.table.value; st.action = f.action.value; st.user = f.user.value; st.from = f.from.value.trim(); st.to = f.to.value.trim(); load(); });
}
