// التنسيق الموحّد: التواريخ YYYY/MM/DD بأرقام غربية، توقيت الرياض، الريال السعودي، والتسميات العربية

const TZ = 'Asia/Riyadh';
const pad = (n) => String(n).padStart(2, '0');

// تاريخ اليوم في الرياض كـ 'YYYY-MM-DD'
export function todayISO() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // en-CA => YYYY-MM-DD
}
export function todayParts() {
  const [y, m, d] = todayISO().split('-').map(Number);
  return { y, m, d };
}

// 'YYYY-MM-DD' => 'YYYY/MM/DD' بدون أي تحويل توقيت (حتى لا يتغير اليوم)
export function date(v) {
  if (!v) return '—';
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replaceAll('-', '/') : '—';
}

// timestamp => 'YYYY/MM/DD HH:mm' بتوقيت الرياض
export function dateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return '—';
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).reduce((a, p) => ((a[p.type] = p.value), a), {});
  // عزل باتجاه يسار-يمين حتى يظهر التاريخ قبل الوقت داخل النص العربي
  return `\u2066${f.year}/${f.month}/${f.day} ${f.hour}:${f.minute}\u2069`;
}

// تحويل إدخال المستخدم YYYY/MM/DD (يقبل الأرقام العربية) إلى YYYY-MM-DD مع رفض التواريخ غير الموجودة
export function parseDate(input) {
  if (input == null || String(input).trim() === '') return null;
  // يقبل - و . و / والفاصلة العربية، ويقبل الشهر واليوم برقم واحد (2026/1/5)
  const s = toWestern(String(input).trim()).replace(/\s+/g, '').replace(/[-.\u060C\\]/g, '/');
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) throw new Error('صيغة التاريخ يجب أن تكون YYYY/MM/DD');
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const iso = `${m[1]}-${pad(mo)}-${pad(d)}`;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) throw new Error(`التاريخ ${iso.replaceAll('-', '/')} غير موجود في التقويم`);
  return iso;
}

// رقم جوال سعودي: يقبل 05XXXXXXXX أو 5XXXXXXXX أو +9665XXXXXXXX أو 009665XXXXXXXX (بمسافات أو شرطات أو أرقام عربية)
// ويُحفظ بالصيغة الدولية +9665XXXXXXXX
export function saMobile(input) {
  if (input == null || String(input).trim() === '') return null;
  let d = toWestern(String(input)).replace(/[\s\-().\u200e\u200f]/g, '');
  if (!/^\+?\d+$/.test(d)) throw new Error('اكتب الأرقام فقط، مثل 0501234567');
  d = d.replace(/^\+/, '').replace(/^00/, '');
  if (d.startsWith('966')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (!/^5\d{8}$/.test(d)) throw new Error('رقم جوال سعودي غير صحيح: يبدأ بـ 05 ويتكون من 10 أرقام، أو +966 ثم 9 أرقام');
  return `+966${d}`;
}
// عرض: +966 50 123 4567
// عرض محلي يحافظ على الصفر في البداية: 055 123 4567
export const saMobileLocal = (m) => (m && /^\+9665\d{8}$/.test(m) ? `0${m.slice(4, 6)} ${m.slice(6, 9)} ${m.slice(9)}` : m || '');
export const saMobileText = (m) => (m && /^\+9665\d{8}$/.test(m) ? `+966 ${m.slice(4, 6)} ${m.slice(6, 9)} ${m.slice(9)}` : m || '');
export const toWestern = (s) => String(s).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c));

export function num(v, digits = 0) {
  if (v == null || v === '' || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export const money = (v) => (v == null ? '—' : `${num(v, 2)} ر.س`);
export const km = (v) => (v == null ? '—' : `${num(v)} كم`);

// ---------------------------------------------------------------------
// التسميات العربية
// ---------------------------------------------------------------------
export const LABELS = {
  op_status: { working: 'تعمل', stopped: 'متوقفة', under_maintenance: 'تحت الصيانة', accident_damaged: 'متضررة بحادث' },
  location_status: { inside_site: 'داخل الموقع', outside_site: 'خارج الموقع', in_workshop: 'في الورشة' },
  doc_type: { iqama: 'الإقامة', driving_license: 'رخصة القيادة', registration: 'الاستمارة', periodic_inspection: 'الفحص الدوري', authorization: 'التفويض', insurance: 'التأمين', vehicle_authorization: 'تفويض السيارة' },
  doc_status: { valid: 'سارية', expiring: 'اقتربت من الانتهاء', expired: 'منتهية', no_date: 'لا يوجد تاريخ مسجل', missing: 'غير مسجلة', not_authorized: 'غير مفوض' },
  auth_status: { valid: 'ساري', expired: 'منتهٍ', missing: 'غير متوفر', not_authorized: 'غير مفوض', no_date: 'بلا تاريخ', no_driver: 'بلا سائق' },
  oil_status: { not_due: 'لم يحن موعد التغيير', soon: 'اقترب موعد التغيير', due: 'حان موعد التغيير', overdue: 'تجاوز موعد التغيير', no_record: 'لا يوجد سجل' },
  accident_status: { new: 'جديد', awaiting_estimate: 'بانتظار التقدير', awaiting_repair: 'بانتظار الإصلاح', repairing: 'جارٍ الإصلاح', completed: 'مكتمل' },
  alert_type: { iqama: 'انتهاء الإقامة', driving_license: 'انتهاء رخصة القيادة', registration: 'انتهاء الاستمارة', periodic_inspection: 'الفحص الدوري', authorization: 'التفويض', oil_change: 'تغيير الزيت', accident: 'حادث مفتوح', maintenance_request: 'طلب صيانة', insurance: 'انتهاء التأمين', vehicle_authorization: 'انتهاء تفويض السيارة' },
  mr_status: { new: 'جديد', pending_supervisor: 'بانتظار اعتماد المشرف', approved: 'معتمد', in_progress: 'قيد الصيانة', completed: 'مكتمل', rejected: 'مرفوض' },
  meter_unit: { km: 'كيلومتر', hours: 'ساعة تشغيل' },
  employee_status: { active: 'على رأس العمل', on_leave: 'في إجازة', terminated: 'منتهي الخدمة', other: 'أخرى' },
  site_kind: { farm: 'مزرعة', nursery: 'مشتل', other: 'أخرى' },
  field: { current_driver_id: 'السائق المسؤول', site_id: 'الموقع', owner_company_id: 'الشركة المالكة', op_status: 'الحالة التشغيلية', location_status: 'موقع السيارة', plate_no: 'رقم اللوحة' },
  odometer_source: { manual: 'تحديث يدوي', oil_change: 'تغيير زيت', maintenance: 'صيانة', accident: 'حادث', handover: 'نموذج تسليم', import: 'استيراد Excel', correction: 'تصحيح مؤكد' },
  payment_status: { unpaid: 'غير مسدد', partially_paid: 'مسدد جزئياً', paid: 'مسدد' },
};
export const label = (group, key) => (LABELS[group] && LABELS[group][key]) || key || '—';

// نص "المتبقي" لصف المتابعة: أيام أو كيلومترات
export function statusText(r) {
  const n = (v) => Number(Math.abs(v)).toLocaleString('en-US');
  if (r.alert_type === 'oil_change') return r.km_left < 0 ? `متجاوز بـ ${n(r.km_left)} كم` : `باقي ${n(r.km_left)} كم`;
  if (r.alert_type === 'maintenance_request') return `${label('mr_status', r.status)} منذ ${n(r.days_left)} يوم`;
  if (r.alert_type === 'accident') return `${label('accident_status', r.status)} منذ ${n(r.days_left)} يوم`;
  if (r.alert_type === 'vehicle_authorization' && r.status === 'no_date') return 'يرجى تحديد تاريخ انتهاء التفويض';
  if (r.status === 'missing' || r.status === 'no_date' || r.status === 'not_authorized')
    return r.alert_type === 'authorization' ? label('auth_status', r.status) : label('doc_status', r.status);
  if (r.days_left < 0) return `منتهية منذ ${n(r.days_left)} يوم`;
  return `باقي ${n(r.days_left)} يوم`;
}

// رسائل الأخطاء بالعربي (قاعدة البيانات تُرجع رمزاً بالإنجليزية)
const ERRORS = [
  [/Invalid login credentials|invalid_grant/i, 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'],
  [/Email not confirmed/i, 'هذا الحساب لم يُفعّل بعد. اطلب من المسؤول تفعيله.'],
  [/NETWORK/, 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مرة أخرى.'],
  [/SESSION_EXPIRED/, 'انتهت الجلسة. سجّل الدخول مرة أخرى.'],
  [/INVALID_DATE_FORMAT/, 'صيغة التاريخ يجب أن تكون YYYY/MM/DD.'],
  [/INVALID_DATE/, 'التاريخ المدخل غير موجود في التقويم.'],
  [/ODOMETER_NEGATIVE/, 'لا يُسمح بقراءة عداد سالبة.'],
  [/ODOMETER_DECREASE/, 'القراءة الجديدة أقل من آخر قراءة مسجلة. يلزم تأكيد التصحيح مع ذكر السبب.'],
  [/REASON_REQUIRED/, 'اكتب سبب تصحيح العداد.'],
  [/MR_APPROVE_DENIED/, 'اعتماد طلبات الصيانة يتطلب صلاحية «اعتماد طلبات الصيانة».'],
  [/MR_APPROVER_REQUIRED/, 'اكتب اسم المسؤول المعتمد.'],
  [/MR_REASON_REQUIRED/, 'اكتب سبب رفض الطلب.'],
  [/MR_LOCKED/, 'الطلب معتمد ولا يمكن تعديل بياناته الأساسية. أنشئ طلباً جديداً إذا لزم.'],
  [/MR_BAD_TRANSITION|MR_BAD_STATUS/, 'لا يمكن نقل الطلب إلى هذه الحالة من حالته الحالية.'],
  [/mr_subject/, 'اختر السيارة أو اكتب اسم المعدة أو رقم اللوحة.'],
  [/maintenance_requests_fault_check/, 'اكتب وصف العطل.'],
  [/HANDOVER_LOCKED/, 'نموذج التسليم معتمد ولا يمكن تعديله. أنشئ نموذجاً جديداً.'],
  [/DELETE_NOT_ALLOWED/, 'الحذف غير مسموح للحفاظ على السجل التاريخي. استخدم الأرشفة.'],
  [/LAST_ADMIN/, 'لا يمكن تعطيل آخر مسؤول في النظام.'],
  [/ADMIN_ONLY/, 'هذا الإجراء متاح للمسؤول فقط.'],
  [/BACKUP_CORRUPT/, 'ملف النسخة تالف أو عُدِّل بعد تنزيله، لذلك لن يُستخدم. لم يتغير شيء في بياناتك.'],
  [/BACKUP_INVALID/, 'هذا الملف ليس نسخة احتياطية من هذا النظام.'],
  [/BACKUP_VERIFY_FAILED/, 'تعذر التحقق من سلامة النسخة، لذلك لم تُعتبر ناجحة. حاول مرة أخرى.'],
  [/BACKUP_NOT_FOUND/, 'النسخة غير موجودة.'],
  [/RESTORE_PLATE_CONFLICT/, 'لا يمكن استرداد البطاقة: توجد سيارة نشطة أخرى بنفس رقم اللوحة. عدّل لوحة تلك السيارة أو انقلها إلى السجل أولاً.'],
  [/RESTORE_VIN_CONFLICT/, 'لا يمكن استرداد البطاقة: توجد سيارة نشطة أخرى بنفس رقم الهيكل.'],
  [/VEHICLE_ALREADY_ARCHIVED/, 'هذه البطاقة موجودة في سجل السيارات المحذوفة مسبقاً.'],
  [/VEHICLE_NOT_ARCHIVED/, 'هذه البطاقة نشطة وليست في سجل المحذوفات.'],
  [/REQUEST_ALREADY_ARCHIVED/, 'هذا الطلب موجود في سجل الطلبات المحذوفة مسبقاً.'],
  [/REQUEST_NOT_ARCHIVED/, 'هذا الطلب موجود في القائمة وليس في سجل المحذوفات.'],
  [/REQUEST_NOT_FOUND/, 'لم يُعثر على طلب الصيانة.'],
  [/RESTORE_CONFIRMATION_REQUIRED/, 'الاستعادة الكاملة تحتاج تأكيداً صريحاً بكتابة كلمة «استبدال».'],
  [/vehicle_private|vp_.*_digits/, 'رقم الهوية يجب أن يكون أرقاماً فقط.'],
  [/op_state_other_text/, 'اكتب الحالة التشغيلية عند اختيار «أخرى».'],
  [/row-level security|permission denied|PERMISSION_DENIED/i, 'لا تملك صلاحية تنفيذ هذا الإجراء.'],
  [/duplicate key.*plate/i, 'رقم اللوحة مسجل مسبقاً لسيارة أخرى.'],
  [/duplicate key.*iqama/i, 'رقم الإقامة مسجل مسبقاً لموظف آخر.'],
  [/duplicate key/i, 'هذه القيمة مسجلة مسبقاً.'],
  [/iqama_digits/, 'رقم الإقامة يجب أن يكون 10 أرقام.'],
  [/mobile_format/, 'رقم الجوال غير صحيح.'],
  [/date\/time field value out of range/, 'التاريخ المدخل غير موجود في التقويم.'],
];
export function errorText(e) {
  const m = String(e?.message || e || '');
  for (const [re, t] of ERRORS) if (re.test(m) || re.test(e?.code || '')) return t;
  return 'حدث خطأ غير متوقع. حاول مرة أخرى، وإن تكرر فأرسل صورة هذه الرسالة: ' + m.slice(0, 120);
}
