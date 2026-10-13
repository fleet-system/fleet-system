// ملف Excel المربوط: يبني مصنفاً بأوراق عربية من بيانات النظام (للقراءة فقط).
// لا يحتوي أي أرقام هوية أو إقامة أو جوالات أو أرقام فواتير أو وثائق: الأعمدة محددة هنا صراحةً.
import { writeXlsx } from './xlsx.js';

const L = {
  op_status: { working: 'تعمل', stopped: 'متوقفة', under_maintenance: 'تحت الصيانة', accident_damaged: 'متضررة بحادث' },
  op_state: { inside: 'تعمل داخل الموقع', outside: 'تعمل خارج الموقع', other: 'أخرى' },
  doc_type: { iqama: 'الإقامة', driving_license: 'رخصة القيادة', registration: 'الاستمارة', periodic_inspection: 'الفحص الدوري', authorization: 'تفويض السائق', insurance: 'التأمين', vehicle_authorization: 'تفويض السيارة' },
  doc_status: { valid: 'سارية', expiring: 'اقتربت من الانتهاء', expired: 'منتهية', no_date: 'لا يوجد تاريخ مسجل', missing: 'غير مسجلة', not_authorized: 'غير مفوض' },
  oil_status: { not_due: 'لم يحن موعد التغيير', soon: 'اقترب موعد التغيير', due: 'حان موعد التغيير', overdue: 'تجاوز موعد التغيير', no_record: 'لا يوجد سجل' },
  accident_status: { new: 'جديد', awaiting_estimate: 'بانتظار التقدير', awaiting_repair: 'بانتظار الإصلاح', repairing: 'جارٍ الإصلاح', completed: 'مكتمل' },
  alert_type: { iqama: 'انتهاء الإقامة', driving_license: 'انتهاء رخصة القيادة', registration: 'انتهاء الاستمارة', periodic_inspection: 'الفحص الدوري', authorization: 'تفويض السائق', oil_change: 'تغيير الزيت', accident: 'حادث مفتوح', maintenance_request: 'طلب صيانة', insurance: 'انتهاء التأمين', vehicle_authorization: 'انتهاء تفويض السيارة' },
  mr_status: { new: 'جديد', pending_supervisor: 'بانتظار اعتماد المشرف', approved: 'معتمد', in_progress: 'قيد الصيانة', completed: 'مكتمل', rejected: 'مرفوض' },
  payment_status: { unpaid: 'غير مسدد', partially_paid: 'مسدد جزئياً', paid: 'مسدد' },
  category: { oil_change: 'تغيير الزيت', maintenance: 'الصيانة', accident: 'الحوادث', housing_maintenance: 'صيانة السكن', food_supply: 'توريد الطعام' },
  card_auth: { authorized: 'مفوضة', not_authorized: 'غير مفوضة' },
  severity: { 1: 'عاجل', 2: 'قريب', 3: 'للمتابعة' },
};
const lab = (g, k) => (k == null || k === '' ? '' : (L[g] && L[g][k]) || String(k));

// مجموعات البيانات المطلوبة (اسم ← مسار PostgREST). كلها قراءة فقط.
export const DATASETS = {
  vehicles: 'v_vehicles_overview?select=*&order=code',
  vauth: 'vehicles?select=id,card_auth_status,card_auth_expiry&deleted_at=is.null',
  vlist: 'vehicles?select=id,code,plate_no',
  sites: 'sites?select=id,name',
  companies: 'companies?select=id,name',
  docs: 'v_document_status?select=owner_type,owner_id,doc_type,subject_label,site_id,company_id,expiry_date,days_left,status',
  followups: 'v_followups?select=subject_label,alert_type,status,site_id,company_id,due_date,days_left,km_left,severity&order=severity,due_date.nullslast',
  oil: 'oil_changes?select=oil_no,vehicle_id,site_id,change_date,odometer,interval_km,next_odometer,workshop,oil_type,total,payment_status&deleted_at=is.null&order=change_date.desc',
  maint: 'maintenance?select=maint_no,vehicle_id,site_id,maint_date,odometer,maint_type,fault_description,workshop,subtotal,vat_amount,total,payment_status&deleted_at=is.null&order=maint_date.desc',
  requests: 'maintenance_requests?select=request_no,request_date,vehicle_id,plate_no,equipment_text,site_id,project_text,fault,status,last_change_date&deleted_at=is.null&order=request_date.desc,request_no.desc',
  accidents: 'accidents?select=accident_no,vehicle_id,site_id,occurred_at,description,workshop,total,status,payment_status&deleted_at=is.null&order=occurred_at.desc',
  expenses: 'v_expenses?select=category,ref_no,expense_date,vehicle_id,site_id,owner_company_id,subtotal,vat_amount,total,payment_status&order=expense_date.desc',
  settings: 'app_settings?select=key,value&key=in.(excel_feed,vehicle_auth_alert_days)',
};

// مقارنة المفتاح بالبصمة المحفوظة (SHA-256) — المفتاح نفسه لا يُحفظ في أي مكان
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function keyAllowed(key, settingsRows) {
  const cfg = (settingsRows || []).find((r) => r.key === 'excel_feed')?.value;
  if (!cfg || cfg.enabled === false || !cfg.hash || typeof key !== 'string' || key.length < 32) return false;
  const h = await sha256Hex(key);
  if (h.length !== cfg.hash.length) return false;
  let diff = 0; for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ cfg.hash.charCodeAt(i);
  return diff === 0;
}

const todayRiyadh = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const daysBetween = (iso, today) => Math.round((Date.UTC(...iso.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...today.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 864e5);

export function authStateText(status, expiry, alertDays, today = todayRiyadh()) {
  if (status === 'not_authorized') return 'غير مفوضة';
  if (status !== 'authorized') return '';
  if (!expiry) return 'غير محدد التاريخ';
  const d = daysBetween(expiry, today);
  if (d < 0) return 'منتهٍ';
  return d <= alertDays ? 'غير منتهٍ (اقترب الانتهاء)' : 'غير منتهٍ';
}

// d: { name: rows[] } لكل مجموعة في DATASETS
export function buildSheets(d, now = new Date()) {
  const site = new Map(d.sites.map((s) => [s.id, s.name]));
  const comp = new Map(d.companies.map((c) => [c.id, c.name]));
  const veh = new Map(d.vlist.map((v) => [v.id, v]));
  const auth = new Map(d.vauth.map((a) => [a.id, a]));
  const alertDays = Number((d.settings.find((s) => s.key === 'vehicle_auth_alert_days') || {}).value) || 30;
  const doc = (id, t) => d.docs.find((x) => x.owner_id === id && x.doc_type === t) || {};
  const vcode = (id) => (id && veh.get(id) ? veh.get(id).code : '');
  const vplate = (id) => (id && veh.get(id) ? veh.get(id).plate_no : '');
  const T = (header, value, type = 'text', width) => ({ header, value, type, width });

  const sheets = [
    { name: 'السيارات', rows: d.vehicles, columns: [
      T('الرقم الداخلي', (r) => r.code), T('رقم اللوحة', (r) => r.plate_no), T('الماركة', (r) => r.make), T('الطراز', (r) => r.model), T('الموديل', (r) => r.manufacture_year, 'int', 10),
      T('نوع التسجيل', (r) => r.registration_type), T('الشركة المالكة', (r) => r.owner_company_name), T('الموقع / المشروع', (r) => r.site_name),
      T('الحالة التشغيلية', (r) => (r.op_state === 'other' ? r.op_state_text || 'أخرى' : lab('op_state', r.op_state) || lab('op_status', r.op_status))),
      T('حالة السيارة', (r) => lab('op_status', r.op_status)), T('المستخدم الحالي', (r) => r.current_user_name), T('السائق المسؤول', (r) => r.driver_name),
      T('قراءة العداد (كم)', (r) => r.odometer, 'int'), T('موعد تغيير الزيت القادم (كم)', (r) => r.oil_next_odometer, 'int'), T('المتبقي للزيت (كم)', (r) => r.oil_remaining_km, 'int'),
      T('حالة الزيت', (r) => lab('oil_status', r.oil_status)),
      T('انتهاء الاستمارة', (r) => doc(r.id, 'registration').expiry_date, 'date'), T('حالة الاستمارة', (r) => lab('doc_status', doc(r.id, 'registration').status)),
      T('انتهاء الفحص الدوري', (r) => doc(r.id, 'periodic_inspection').expiry_date, 'date'), T('حالة الفحص', (r) => lab('doc_status', doc(r.id, 'periodic_inspection').status)),
      T('انتهاء التأمين', (r) => r.insurance_expiry, 'date'), T('حالة التأمين', (r) => (r.insurance_expiry ? lab('doc_status', doc(r.id, 'insurance').status) : 'غير محدد')),
      T('حالة التفويض', (r) => lab('card_auth', auth.get(r.id)?.card_auth_status)), T('انتهاء التفويض', (r) => auth.get(r.id)?.card_auth_expiry, 'date'),
      T('حالة انتهاء التفويض', (r) => authStateText(auth.get(r.id)?.card_auth_status, auth.get(r.id)?.card_auth_expiry, alertDays)),
      T('إجمالي تكلفة الصيانة (ر.س)', (r) => r.cost_maint_total, 'money'),
    ] },
    { name: 'الوثائق والتنبيهات', rows: d.docs.filter((x) => x.status !== 'valid').sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9)), columns: [
      T('السيارة / الموظف', (r) => r.subject_label, 'text', 32), T('نوع الوثيقة', (r) => lab('doc_type', r.doc_type)), T('تاريخ الانتهاء', (r) => r.expiry_date, 'date'),
      T('الأيام المتبقية', (r) => r.days_left, 'int'), T('الحالة', (r) => lab('doc_status', r.status)), T('الموقع', (r) => site.get(r.site_id) || ''), T('الشركة', (r) => comp.get(r.company_id) || ''),
    ] },
    { name: 'المتابعات', rows: d.followups, columns: [
      T('الأولوية', (r) => lab('severity', r.severity), 'text', 10), T('السجل', (r) => r.subject_label, 'text', 32), T('نوع التنبيه', (r) => lab('alert_type', r.alert_type)),
      T('تاريخ الاستحقاق', (r) => r.due_date, 'date'), T('الأيام المتبقية', (r) => r.days_left, 'int'), T('الكيلومترات المتبقية', (r) => r.km_left, 'int'),
      T('الموقع', (r) => site.get(r.site_id) || ''), T('الشركة', (r) => comp.get(r.company_id) || ''),
    ] },
    { name: 'تغيير الزيت', rows: d.oil, columns: [
      T('رقم العملية', (r) => r.oil_no), T('التاريخ', (r) => r.change_date, 'date'), T('الرقم الداخلي', (r) => vcode(r.vehicle_id)), T('اللوحة', (r) => vplate(r.vehicle_id)),
      T('الموقع', (r) => site.get(r.site_id) || ''), T('العداد (كم)', (r) => r.odometer, 'int'), T('الفترة (كم)', (r) => r.interval_km, 'int'), T('التغيير القادم (كم)', (r) => r.next_odometer, 'int'),
      T('الورشة', (r) => r.workshop), T('نوع الزيت', (r) => r.oil_type), T('الإجمالي (ر.س)', (r) => r.total, 'money'), T('السداد', (r) => lab('payment_status', r.payment_status)),
    ] },
    { name: 'الصيانة', rows: d.maint, columns: [
      T('رقم العملية', (r) => r.maint_no), T('التاريخ', (r) => r.maint_date, 'date'), T('الرقم الداخلي', (r) => vcode(r.vehicle_id)), T('اللوحة', (r) => vplate(r.vehicle_id)),
      T('الموقع', (r) => site.get(r.site_id) || ''), T('العداد (كم)', (r) => r.odometer, 'int'), T('نوع الصيانة', (r) => r.maint_type), T('العطل', (r) => r.fault_description, 'wrap'),
      T('الورشة', (r) => r.workshop), T('قبل الضريبة (ر.س)', (r) => r.subtotal, 'money'), T('الضريبة (ر.س)', (r) => r.vat_amount, 'money'), T('الإجمالي (ر.س)', (r) => r.total, 'money'),
      T('السداد', (r) => lab('payment_status', r.payment_status)),
    ] },
    { name: 'طلبات الصيانة', rows: d.requests, columns: [
      T('رقم الطلب', (r) => r.request_no), T('تاريخ الطلب', (r) => r.request_date, 'date'), T('الرقم الداخلي', (r) => vcode(r.vehicle_id)),
      T('اللوحة / المعدة', (r) => r.plate_no || r.equipment_text), T('الموقع / المشروع', (r) => site.get(r.site_id) || r.project_text || ''), T('العطل', (r) => r.fault, 'wrap'),
      T('الحالة', (r) => lab('mr_status', r.status)), T('تاريخ آخر تغيير', (r) => r.last_change_date, 'date'),
    ] },
    { name: 'الحوادث', rows: d.accidents, columns: [
      T('رقم الحادث', (r) => r.accident_no), T('التاريخ', (r) => r.occurred_at, 'datetime'), T('الرقم الداخلي', (r) => vcode(r.vehicle_id)), T('اللوحة', (r) => vplate(r.vehicle_id)),
      T('الموقع', (r) => site.get(r.site_id) || ''), T('الوصف', (r) => r.description, 'wrap'), T('الورشة', (r) => r.workshop), T('الإجمالي (ر.س)', (r) => r.total, 'money'),
      T('الحالة', (r) => lab('accident_status', r.status)), T('السداد', (r) => lab('payment_status', r.payment_status)),
    ] },
    { name: 'المصروفات', rows: d.expenses, columns: [
      T('النوع', (r) => lab('category', r.category)), T('رقم العملية', (r) => r.ref_no), T('التاريخ', (r) => r.expense_date, 'date'), T('الشهر', (r) => (r.expense_date || '').slice(0, 7).replace('-', '/')),
      T('الرقم الداخلي', (r) => vcode(r.vehicle_id)), T('الموقع', (r) => site.get(r.site_id) || ''), T('الشركة المالكة', (r) => comp.get(r.owner_company_id) || ''),
      T('قبل الضريبة (ر.س)', (r) => r.subtotal, 'money'), T('الضريبة (ر.س)', (r) => r.vat_amount, 'money'), T('الإجمالي (ر.س)', (r) => r.total, 'money'), T('السداد', (r) => lab('payment_status', r.payment_status)),
    ] },
  ];
  const stamp = new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ').replaceAll('-', '/');
  sheets.push({ name: 'معلومات', rows: [
    ['آخر تحديث (توقيت الرياض)', stamp], ['المصدر', 'نظام إدارة الأسطول والمواقع الزراعية'], ['ملاحظة', 'هذا الملف للقراءة فقط. التعديل يتم من الموقع.'],
    ['الأمان', 'لا يحتوي أرقام الهوية أو الإقامة أو الجوالات أو أرقام الفواتير.'],
    ...sheets.map((s) => [`عدد صفوف «${s.name}»`, String(s.rows.length)]),
  ], columns: [T('البند', (r) => r[0], 'text', 30), T('القيمة', (r) => r[1], 'text', 60)] });
  return sheets;
}

export function buildWorkbook(d, now = new Date()) { return writeXlsx(buildSheets(d, now)); }
