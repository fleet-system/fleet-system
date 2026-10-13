// إعدادات بطاقة السيارة من «الإعدادات ← إدارة بيانات السيارات»:
// أسماء الحقول، القوائم، والحقول الإضافية. تُحفظ في app_settings (vehicle_fields_config) ويُسجَّل كل تغيير في سجل التدقيق.
// تغيير اسم حقل أو إيقاف حقل إضافي لا يمس البيانات المخزنة: القيم مربوطة بمفتاح ثابت لا يتغير.
import * as data from './data.js';

export const SECTIONS = { 1: 'أولاً: بيانات ومعلومات المركبة الأساسية', 2: 'ثانياً: التشغيل والمشاريع', 3: 'ثالثاً: المسؤولية والمالكون', 4: 'رابعاً: التراخيص والمستندات', 5: 'خامساً: التكاليف والمالية', 6: 'معلومات إضافية' };
export const TYPES = { text: 'نص', textarea: 'نص طويل', number: 'رقم', date: 'تاريخ', select: 'قائمة منسدلة' };

// الحقول الأساسية التي يمكن تغيير أسمائها (المفتاح الثابت ← الاسم الافتراضي)
export const BUILTIN = [
  ['plate_letters', 'اللوحة (حروف)', 1], ['plate_digits', 'اللوحة (أرقام)', 1], ['make', 'ماركة السيارة', 1], ['model', 'طراز المركبة', 1],
  ['manufacture_year', 'الموديل', 1], ['vin', 'رقم الهيكل', 1], ['registration_type', 'نوع التسجيل', 1], ['wheels_count', 'عدد العجلات', 1],
  ['site_name', 'المشروع الحالي', 2], ['op_state', 'الحالة التشغيلية', 2], ['notes', 'ملاحظة', 2],
  ['current_user_name', 'المستخدم الحالي', 3], ['current_user_id_no', 'هوية المستخدم', 3], ['current_user_mobile', 'رقم هاتف السائق', 3], ['owner_company', 'المالك', 3], ['owner_id_no', 'هوية المالك', 3],
  ['registration_serial', 'الرقم التسلسلي للاستمارة', 4], ['registration_expiry', 'تاريخ انتهاء رخصة السير', 4], ['inspection_expiry', 'تاريخ انتهاء الفحص', 4], ['insurance_expiry', 'تاريخ انتهاء تأمين السيارة', 4],
  ['cost_oil', 'تكلفة تغيير الزيت (ر.س)', 5], ['cost_maint', 'تكلفة الصيانة (ر.س)', 5], ['cost_maint_total', 'إجمالي تكلفة الصيانة (ر.س)', 5],
];
export const DEFAULT_REG_TYPES = ['خصوصي', 'نقل خاص', 'نقل عام', 'أجرة', 'مركبة أشغال عامة', 'دراجة نارية', 'معدات ثقيلة'];
export const DEFAULT_OP_STATE = { inside: 'تعمل داخل الموقع', outside: 'تعمل خارج الموقع', other: 'أخرى' };

export function config() {
  const c = data.setting('vehicle_fields_config', null) || {};
  return { labels: c.labels || {}, options: c.options || {}, custom: Array.isArray(c.custom) ? c.custom : [] };
}
export const fieldLabel = (name, dflt) => { const l = config().labels[name]; return l && String(l).trim() ? l : dflt; };
export const regTypes = () => { const o = config().options.registration_type; return Array.isArray(o) && o.length ? o : DEFAULT_REG_TYPES; };
export const extraMakes = () => { const o = config().options.makes; return Array.isArray(o) ? o : []; };
export const opStateLabels = () => ({ ...DEFAULT_OP_STATE, ...(config().options.op_state || {}) });
export const customFields = (all = false) => config().custom.filter((f) => all || f.active !== false);

// حقل إضافي ← حقل في نموذج البطاقة
export function customFormField(f) {
  const base = { name: `cf__${f.key}`, label: f.label, required: !!f.required };
  if (f.type === 'number') return { ...base, type: 'number', decimal: true };
  if (f.type === 'date') return { ...base, type: 'date' };
  if (f.type === 'select') return { ...base, type: 'select', options: (f.options || []).map((o) => [o, o]) };
  if (f.type === 'textarea') return { ...base, type: 'textarea', full: true };
  return base;
}

export const newKey = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
