// جدول السيارات: بحث، فرز، فلاتر، إضافة
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, $, PAGE_ROWS, moreRows, bindMore } from '../ui.js';
import { label, LABELS, km, num, date, money, todayISO, toWestern, parseDate, saMobile, saMobileText } from '../fmt.js';
import { openForm, saved, userError } from '../form.js';
import { companyNames, siteNames, employeeNamesPlain, resolveOwner, resolveSite } from '../resolve.js';

import { fieldLabel, regTypes, extraMakes, opStateLabels, customFields, customFormField, SECTIONS } from '../vehicle-config.js';

// ماركات وطرازات شائعة في السوق السعودي — اقتراحات فقط، ويمكن كتابة أي قيمة جديدة
const MAKES = {
  'تويوتا': ['هايلكس', 'لاندكروزر', 'لاندكروزر بيك أب', 'هايس', 'كامري', 'كورولا', 'يارس', 'فورتشنر', 'برادو', 'كوستر', 'راف 4'],
  'نيسان': ['نافارا', 'باترول', 'باترول بيك أب', 'صني', 'أورفان', 'ألتيما', 'إكس تريل', 'سيفيليان'],
  'إيسوزو': ['دي ماكس', 'NPR', 'NQR', 'FVR', 'إم يو إكس'],
  'هيونداي': ['أكسنت', 'إلنترا', 'سوناتا', 'توسان', 'H1', 'H100', 'كاونتي', 'HD72'],
  'ميتسوبيشي': ['L200', 'باجيرو', 'كانتر', 'أتراج', 'لانسر', 'روزا'],
  'فورد': ['F-150', 'رينجر', 'إكسبلورر', 'إكسبديشن', 'ترانزيت', 'توروس'],
  'شيفروليه': ['سلفرادو', 'تاهو', 'سوبربان', 'كابتيفا', 'ماليبو', 'إكوينوكس'],
  'جي إم سي': ['سييرا', 'يوكن', 'سافانا'],
  'كيا': ['سيراتو', 'بيكانتو', 'ريو', 'سبورتاج', 'K2700', 'K4000'],
  'مرسيدس بنز': ['أكتروس', 'سبرنتر', 'أتيجو', 'G-Class'],
  'هينو': ['300', '500', '700'],
  'مازدا': ['BT-50', 'CX-5', '6'],
  'سوزوكي': ['جيمني', 'سويفت', 'ديزاير', 'APV'],
  'شانجان': ['هنتر', 'CS35', 'CS85', 'ألسفن'],
  'جيلي': ['إمجراند', 'كولراي', 'أوكافانجو'],
  'رينو': ['داستر', 'سيمبول', 'ماستر'],
  'فولفو': ['FH', 'FM', 'FMX'],
  'مان': ['TGS', 'TGX', 'TGM'],
};
const MAKE_ALIASES = { toyota: 'تويوتا', nissan: 'نيسان', isuzu: 'إيسوزو', hyundai: 'هيونداي', mitsubishi: 'ميتسوبيشي', ford: 'فورد', chevrolet: 'شيفروليه', gmc: 'جي إم سي', kia: 'كيا', mercedes: 'مرسيدس بنز', 'mercedes-benz': 'مرسيدس بنز', hino: 'هينو', mazda: 'مازدا', suzuki: 'سوزوكي', changan: 'شانجان', geely: 'جيلي', renault: 'رينو', volvo: 'فولفو', man: 'مان' };
const fold = (s) => String(s || '').trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ـ/g, '').replace(/\s+/g, ' ');
const canonMake = (m) => { const f = fold(m); if (!f) return ''; if (MAKE_ALIASES[f]) return MAKE_ALIASES[f]; return Object.keys(MAKES).find((k) => fold(k) === f) || m.trim(); };
const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = fold(x); if (!x || seen.has(k)) return false; seen.add(k); return true; }); };

// الأسماء قابلة للتعديل من الإعدادات؛ المفاتيح الثلاثة ثابتة
export const OP_STATE = new Proxy({}, { get: (_, k) => opStateLabels()[k], ownKeys: () => Object.keys(opStateLabels()), getOwnPropertyDescriptor: (_, k) => ({ enumerable: true, configurable: true, value: opStateLabels()[k] }) });
// الحالة التشغيلية للعرض. السيارات القديمة (قبل هذا الإصدار) تُعرض من حقل «داخل/خارج الموقع» المكافئ دون تغيير بياناتها
export function opStateOf(v) {
  if (v.op_state === 'other') return { key: 'other', text: v.op_state_text || 'أخرى' };
  if (v.op_state) return { key: v.op_state, text: OP_STATE[v.op_state] };
  if (v.location_status === 'inside_site') return { key: 'inside', text: OP_STATE.inside, legacy: true };
  if (v.location_status === 'outside_site') return { key: 'outside', text: OP_STATE.outside, legacy: true };
  if (v.location_status === 'in_workshop') return { key: 'other', text: 'في الورشة', legacy: true };
  return { key: '', text: '—' };
}
// الحالة التشغيلية في البطاقة ← حالة السيارة التي تعتمد عليها لوحة التحكم (تعمل / متوقفة / تحت الصيانة / متضررة بحادث)
export function opStatusFor(state, text) {
  if (state !== 'other') return 'working';
  const t = String(text || '');
  if (/حادث|متضرر/.test(t)) return 'accident_damaged';
  if (/متوقف|لا تعمل|معطل/.test(t)) return 'stopped';
  if (/صيان|ورش/.test(t)) return 'under_maintenance';
  return 'working';
}
// خانة السيارة في لوحة التحكم (داخل/خارج المواقع للسيارات التي تعمل، متوقفة، متضررة بحادث، في الورشة)
export const PLACES = [['inside', 'داخل المواقع'], ['outside', 'خارج المواقع'], ['stopped', 'متوقفة'], ['maintenance', 'تحت الصيانة'], ['accident', 'متضررة بحادث'], ['workshop', 'في الورشة']];
export function placeOf(v) {
  if (v.op_status === 'stopped') return 'stopped';
  if (v.op_status === 'accident_damaged') return 'accident';
  if (v.op_status === 'under_maintenance') return 'maintenance';
  if (v.location_status === 'in_workshop') return 'workshop';
  return v.location_status === 'outside_site' ? 'outside' : 'inside';
}
// خيارات «الحالة التشغيلية» في البطاقة، مربوطة مباشرة بخانات لوحة التحكم
// المفتاح ← { حقول السيارة }: op_state/op_state_text للبطاقة، op_status وlocation_status للوحة التحكم
export const FIXED_STATES = { stopped: 'متوقفة', maintenance: 'تحت الصيانة', accident: 'متضررة بحادث', workshop: 'في الورشة' };
const FIXED_STATUS = { stopped: 'stopped', maintenance: 'under_maintenance', accident: 'accident_damaged', workshop: 'working' };
export const cardStateOptions = () => { const o = OP_STATE; return [['inside', o.inside], ['outside', o.outside], ...Object.entries(FIXED_STATES), ['other', o.other]]; };
export function cardStateOf(v) {
  if (v.op_status === 'stopped') return { key: 'stopped', text: FIXED_STATES.stopped };
  if (v.op_status === 'accident_damaged') return { key: 'accident', text: FIXED_STATES.accident };
  if (v.op_status === 'under_maintenance') return { key: 'maintenance', text: FIXED_STATES.maintenance };
  if (v.location_status === 'in_workshop') return { key: 'workshop', text: FIXED_STATES.workshop };
  const o = opStateOf(v);
  const fixed = o.key === 'other' && Object.entries(FIXED_STATES).find(([, t]) => t === (v.op_state_text || '').trim());
  if (fixed) return { key: fixed[0], text: fixed[1] };
  return { key: o.key, text: o.text };
}
export const opChip = (v) => { const o = cardStateOf(v); return o.key ? html`<span class="op-chip ${o.key === 'inside' ? '' : o.key === 'outside' ? 'out' : FIXED_STATES[o.key] ? `fx fx-${o.key}` : 'other'}">${o.key === 'other' ? `أخرى: ${o.text}` : o.text}</span>` : '—'; };

// حالة المستند: ساري / قارب على الانتهاء (30 يوماً أو أقل) / منتهي / غير محدد
export function docState(iso) {
  if (!iso) return { key: 'none', text: 'غير محدد', days: null, daysText: '—' };
  const days = Math.round((new Date(iso) - new Date(todayISO())) / 864e5);
  if (days < 0) return { key: 'expired', text: 'منتهي', days, daysText: `منتهي منذ ${num(-days)} يوم` };
  if (days <= 30) return { key: 'expiring', text: 'قريب الانتهاء', days, daysText: days === 0 ? 'ينتهي اليوم' : `${num(days)} يوم` };
  return { key: 'valid', text: 'ساري', days, daysText: `${num(days)} يوم` };
}
const DOC_TAG = { none: 'missing', expired: 'expired', expiring: 'expiring', valid: 'valid' };
export const docLive = (iso) => { const s = docState(iso); return html`<div class="doc-live"><span>عدد الأيام حتى الانتهاء: <b class="num">${s.daysText}</b></span><span>الحالة: <span class="tag t-${DOC_TAG[s.key]}">${s.text}</span></span></div>`; };

// التكاليف: إذا وُجدت سجلات تفصيلية (تغيير زيت / فواتير صيانة) يُحسب الإجمالي منها فقط حتى لا يتكرر المصروف نفسه
export function costSummary(v, oilRecs = [], maintRecs = []) {
  const sum = (a) => Math.round(a.reduce((t, r) => t + Number(r.total || 0), 0) * 100) / 100;
  if (oilRecs.length || maintRecs.length) {
    const oil = sum(oilRecs), m = sum(maintRecs);
    return { total: Math.round((oil + m) * 100) / 100, fromRecords: true,
      source: `محسوب من السجلات: ${num(oilRecs.length)} تغيير زيت (${money(oil)}) + ${num(maintRecs.length)} فاتورة صيانة (${money(m)}). المبالغ اليدوية لا تُضاف حتى لا يتكرر المصروف.` };
  }
  if (v.cost_maint_total != null) return { total: Number(v.cost_maint_total), fromRecords: false, source: 'مدخل يدوياً' };
  if (v.cost_oil != null || v.cost_maint != null) {
    return { total: Math.round((Number(v.cost_oil || 0) + Number(v.cost_maint || 0)) * 100) / 100, fromRecords: false, source: 'مجموع تكلفة تغيير الزيت وتكلفة الصيانة المدخلتين يدوياً' };
  }
  return { total: null, fromRecords: false, source: 'لا توجد سجلات ولا مبالغ مدخلة' };
}

// قيمة حقل إضافي للعرض
export const cfText = (c, x) => (x == null || x === '' ? '—' : c.type === 'date' ? date(x) : c.type === 'number' ? num(x, 2).replace(/\.00$/, '') : String(x));

// اللوحة: «د هـ و 5678» ← حروف + أرقام (السيارات القديمة تُقسَم تلقائياً عند التعديل)
export function splitPlate(p) {
  const t = toWestern(String(p || '')).trim();
  let m = t.match(/^(.*?)[\s-]*(\d+)$/);
  if (m && m[1]) return { letters: m[1].trim(), digits: m[2] };
  m = t.match(/^(\d+)[\s-]*(.+)$/);
  if (m) return { letters: m[2].trim(), digits: m[1] };
  return /^\d+$/.test(t) ? { letters: '', digits: t } : { letters: t, digits: '' };
}
const idNo = (v) => { const d = toWestern(v).replace(/[\s-]/g, ''); if (!/^\d{1,20}$/.test(d)) throw new Error('أرقام فقط (حتى 20 رقماً)'); return d; };
// نوع الرقم للعرض أثناء الكتابة: هوية وطنية تبدأ بـ1، إقامة تبدأ بـ2 (10 أرقام)
const idKind = (d) => (/^1\d{9}$/.test(d) ? `✓ هوية وطنية ${d}` : /^2\d{9}$/.test(d) ? `✓ رقم إقامة ${d}` : `✓ ${d}`);
const localMobile = (m) => (m && /^\+9665\d{8}$/.test(m) ? `0${m.slice(4)}` : m || '');

// اقتراحات من البيانات المحفوظة
async function suggestions() {
  const rows = await api.get('vehicles', { select: 'make,model,registration_type,current_user_name', deleted_at: 'is.null' }).catch(() => []);
  const makes = uniq([...Object.keys(MAKES), ...extraMakes(), ...rows.map((r) => canonMake(r.make || ''))]);
  const modelsFor = (make) => {
    const k = canonMake(make || '');
    const saved = rows.filter((r) => !k || fold(canonMake(r.make || '')) === fold(k)).map((r) => r.model);
    return uniq([...(MAKES[k] || (k ? [] : Object.values(MAKES).flat())), ...saved]);
  };
  return {
    makes, modelsFor,
    regTypes: uniq([...regTypes(), ...rows.map((r) => r.registration_type)]),
    users: uniq([...employeeNamesPlain(), ...rows.map((r) => r.current_user_name)]),
  };
}

export function vehicleFields({ isNew, sug, costsFromRecords = false }) {
  const sens = api.can('view_sensitive');
  const f = [
    { type: 'section', label: 'أولاً: بيانات ومعلومات المركبة الأساسية' },
    { name: 'plate_letters', label: 'اللوحة (حروف)', required: true, help: 'مثل: أ ب ج' },
    { name: 'plate_digits', label: 'اللوحة (أرقام)', required: isNew, inputmode: 'numeric', dir: 'ltr', western: true, help: 'من 1 إلى 4 أرقام',
      normalize: (x) => { if (!/^\d{1,4}$/.test(x)) throw new Error('أرقام فقط، من 1 إلى 4 أرقام'); return x; } },
    { name: 'make', label: 'ماركة السيارة', type: 'combo', options: sug.makes, help: 'اختر أو اكتب ماركة جديدة' },
    { name: 'model', label: 'طراز المركبة', type: 'combo', options: sug.modelsFor(''), help: 'تظهر طرازات الماركة المختارة' },
    { name: 'manufacture_year', label: 'الموديل', type: 'number', min: 1950, max: 2100, help: 'سنة الصنع، مثل 2022' },
    { name: 'vin', label: 'رقم الهيكل', dir: 'ltr', western: true,
      normalize: (x) => { const c = x.replace(/\s+/g, '').toUpperCase(); if (!/^[A-Z0-9-]{1,25}$/.test(c)) throw new Error('حروف إنجليزية وأرقام فقط'); return c; } },
    { name: 'registration_type', label: 'نوع التسجيل', type: 'combo', options: sug.regTypes, help: 'اختر أو اكتب' },
    { name: 'wheels_count', label: 'عدد العجلات', type: 'number', min: 1, max: 40 },

    { type: 'section', label: 'ثانياً: التشغيل والمشاريع' },
    { name: 'site_name', label: 'المشروع الحالي', type: 'combo', options: siteNames(), help: 'اختر مشروعاً محفوظاً أو اكتب اسم مشروع جديد' },
    { name: 'op_state', label: 'الحالة التشغيلية', type: 'select', required: true, placeholder: false, options: cardStateOptions(), help: 'تظهر مباشرة في لوحة التحكم' },
    { name: 'op_state_text', label: 'اكتب الحالة التشغيلية', hidden: true, help: 'مثل: بانتظار قطع غيار، محجوزة' },
    { name: 'notes', label: 'ملاحظة', type: 'textarea', rows: 4, full: true },

    { type: 'section', label: 'ثالثاً: المسؤولية والمالكون' },
    { name: 'current_user_name', label: 'المستخدم الحالي', type: 'combo', options: sug.users },
    { name: 'card_auth_status', label: 'حالة التفويض', type: 'select', options: Object.entries(AUTH_CHOICES), help: 'اختر: مفوضة أو غير مفوضة' },
    { name: 'card_auth_expiry', label: 'تاريخ انتهاء التفويض', type: 'date', help: 'من التقويم أو بصيغة YYYY/MM/DD' },
    { name: 'auth_live', type: 'info' },
  ];
  if (sens) f.push({ name: 'current_user_id_no', label: 'هوية المستخدم', inputmode: 'numeric', dir: 'ltr', western: true, normalize: idNo, preview: idKind, help: 'رقم الهوية الوطنية أو رقم الإقامة' });
  f.push({ name: 'current_user_mobile', label: 'رقم هاتف السائق', type: 'tel', inputmode: 'tel', dir: 'ltr', western: true, full: true, normalize: saMobile, preview: (m) => `✓ ${localMobile(m)}`, help: 'مثل 0501234567' });
  f.push({ name: 'owner_company', label: 'المالك', type: 'combo', required: true, options: companyNames(), help: 'اختر من القائمة أو اكتب اسماً جديداً' });
  if (sens) f.push({ name: 'owner_id_no', label: 'هوية المالك', inputmode: 'numeric', dir: 'ltr', western: true, normalize: idNo, preview: idKind, help: 'رقم الهوية الوطنية أو رقم الإقامة (أو السجل التجاري للشركة)' });

  f.push(
    { type: 'section', label: 'رابعاً: التراخيص والمستندات' },
    { type: 'subsection', label: 'أ. رخصة السير والاستمارة' },
    { name: 'registration_serial', label: 'الرقم التسلسلي للاستمارة', dir: 'ltr', western: true },
    { name: 'registration_expiry', label: 'تاريخ انتهاء رخصة السير', type: 'date' },
    { name: 'reg_live', type: 'info' },
    { type: 'subsection', label: 'ب. الفحص الدوري' },
    { name: 'inspection_expiry', label: 'تاريخ انتهاء الفحص', type: 'date' },
    { name: 'insp_live', type: 'info' },
    { type: 'subsection', label: 'ج. التأمين' },
    { name: 'insurance_expiry', label: 'تاريخ انتهاء تأمين السيارة', type: 'date' },
    { name: 'ins_live', type: 'info' },

    { type: 'section', label: 'خامساً: التكاليف والمالية' },
    { name: 'cost_oil', label: 'تكلفة تغيير الزيت (ر.س)', type: 'number', decimal: true, min: 0 },
    { name: 'cost_maint', label: 'تكلفة الصيانة (ر.س)', type: 'number', decimal: true, min: 0 },
    { name: 'cost_maint_total', label: 'إجمالي تكلفة الصيانة (ر.س)', type: 'number', decimal: true, min: 0, readonly: costsFromRecords,
      help: costsFromRecords ? 'محسوب تلقائياً من سجلات تغيير الزيت وفواتير الصيانة' : 'اختياري؛ إذا تُرك فارغاً يُحسب من المبلغين أعلاه' },
    { name: 'cost_live', type: 'info' },
  );
  // أسماء الحقول من الإعدادات + الحقول الإضافية في أقسامها
  for (const x of f) if (x.name && x.type !== 'info') x.label = fieldLabel(x.name, x.label);
  const extra = customFields();
  const secIdx = f.map((x, i) => (x.type === 'section' ? i : -1)).filter((i) => i >= 0);
  for (let n = 5; n >= 1; n--) {
    const add = extra.filter((c) => Number(c.section) === n).map(customFormField);
    if (!add.length) continue;
    const end = n < secIdx.length ? secIdx[n] : f.length;
    // في القسم الخامس نضع الحقول قبل مربع الإجمالي
    const at = n === 5 ? f.findIndex((x) => x.name === 'cost_live') : end;
    f.splice(at < 0 ? end : at, 0, ...add);
  }
  const more = extra.filter((c) => !(Number(c.section) >= 1 && Number(c.section) <= 5)).map(customFormField);
  if (more.length) f.push({ type: 'section', label: SECTIONS[6] }, ...more);
  if (!isNew) f.push({ type: 'section', label: 'سبب التعديل' }, { name: 'change_note', label: 'سبب التعديل (اختياري)', full: true, help: 'يُحفظ مع هذا التعديل في سجل التعديلات' });
  return f;
}

// تفويض السيارة في البطاقة (القسم الثالث): الحالة تُحسب من الاختيار والتاريخ مقارنةً بتاريخ اليوم
export const AUTH_CHOICES = { authorized: 'مفوضة', not_authorized: 'غير مفوضة' };
export const authAlertDays = () => { const n = Number(data.setting('vehicle_auth_alert_days', 30)); return Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30; };
export function authState(status, expiry) {
  if (status === 'not_authorized') return { key: 'not_authorized', tag: 'not_authorized', text: 'غير مفوضة', note: 'السيارة غير مفوضة، ولا تُعد منتهية.' };
  if (status !== 'authorized') return { key: 'none', tag: 'missing', text: 'غير محدد', note: 'لم تُحدد حالة التفويض.' };
  if (!expiry) return { key: 'no_date', tag: 'no_date', text: 'غير محدد التاريخ', note: 'يرجى تحديد تاريخ انتهاء التفويض' };
  const d = Math.round((new Date(expiry) - new Date(todayISO())) / 864e5);
  if (d < 0) return { key: 'expired', tag: 'expired', text: 'منتهٍ', days: d, note: `انتهى التفويض منذ ${Math.abs(d)} يوم` };
  const soon = d <= authAlertDays();
  return { key: soon ? 'expiring' : 'valid', tag: soon ? 'expiring' : 'valid', text: 'غير منتهٍ', days: d, note: d === 0 ? 'ينتهي التفويض اليوم' : `باقي ${d} يوم${soon ? ' — اقترب موعد الانتهاء' : ''}` };
}
const authLive = (status, expiry) => {
  const s = authState(status, expiry);
  return html`<div class="doc-live"><span>حالة انتهاء التفويض: <span class="tag t-${s.tag}">${s.text}</span></span><small class="${s.key === 'no_date' || s.key === 'expired' ? 'bad-text' : 'muted'}">${s.note}</small></div>`;
};

// تحديث الأجزاء التلقائية في النموذج (الأيام المتبقية، الحالة، الإجمالي، طرازات الماركة، حقل «أخرى»)
function cardOnChange(sug, recCosts) {
  return (ctx, name) => {
    const v = ctx.values; const form = ctx.form;
    const other = form.elements.op_state.value === 'other';
    const box = form.elements.op_state_text.closest('.field'); box.hidden = !other;
    form.elements.op_state_text.required = other;
    for (const [n, live] of [['registration_expiry', 'reg_live'], ['inspection_expiry', 'insp_live'], ['insurance_expiry', 'ins_live']]) ctx.live(live, docLive(v[n]));
    ctx.live('auth_live', authLive(v.card_auth_status, v.card_auth_expiry));
    if (!name || name === 'make') {
      const dl = form.elements.model.list;
      if (dl) dl.innerHTML = sug.modelsFor(form.elements.make.value).map((o) => html`<option value="${o}"></option>`).join('');
    }
    const c = recCosts ? costSummary({}, recCosts.oil, recCosts.maint) : costSummary({ cost_oil: v.cost_oil, cost_maint: v.cost_maint, cost_maint_total: v.cost_maint_total });
    if (recCosts && name === '') ctx.set('cost_maint_total', c.total);
    ctx.live('cost_live', html`<div class="cost-live"><span>إجمالي تكلفة الصيانة: <span class="total num">${c.total == null ? '—' : money(c.total)}</span></span><small class="muted">المصدر: ${c.source}</small></div>`);
  };
}

// قيم النموذج من سجل سيارة موجود
export function vehicleValues(v, { docs = {}, priv = {} } = {}) {
  const p = splitPlate(v.plate_no); const o = opStateOf(v);
  return {
    ...v, plate_letters: p.letters, plate_digits: p.digits,
    owner_company: v.owner_company_id ? data.companyName(v.owner_company_id) : '', site_name: v.site_id ? data.siteName(v.site_id) : '',
    op_state: cardStateOf(v).key || 'inside',
    op_state_text: cardStateOf(v).key === 'other' ? (v.op_state === 'other' ? v.op_state_text : o.legacy && o.key === 'other' ? o.text : (v.op_state_text || '')) : '',
    current_user_mobile: localMobile(v.current_user_mobile),
    registration_expiry: docs.registration?.expiry_date || '', inspection_expiry: docs.periodic_inspection?.expiry_date || '',
    current_user_id_no: priv.current_user_id_no || '', owner_id_no: priv.owner_id_no || '', change_note: '',
    ...Object.fromEntries(Object.entries(v.custom_fields || {}).map(([k, x]) => [`cf__${k}`, x])),
  };
}

// قيم النموذج ← سجل السيارة + الوثائق + البيانات الحساسة
export async function vehicleRecord(v, { costsFromRecords = false, existingCustom = {} } = {}) {
  const letters = (v.plate_letters || '').replace(/\s+/g, ' ').trim();
  const digits = v.plate_digits || '';
  if (/\d/.test(letters) && digits) throw userError('اكتب حروف اللوحة في خانة «اللوحة (حروف)» والأرقام في خانة «اللوحة (أرقام)».');
  if (v.op_state === 'other' && !(v.op_state_text || '').trim()) throw userError('اكتب الحالة التشغيلية في خانة «اكتب الحالة التشغيلية».');
  const rec = {
    plate_no: [letters, digits].filter(Boolean).join(' '),
    make: v.make, model: v.model, manufacture_year: v.manufacture_year, vin: v.vin,
    registration_type: v.registration_type, wheels_count: v.wheels_count,
    op_state: FIXED_STATES[v.op_state] ? 'other' : v.op_state,
    op_state_text: FIXED_STATES[v.op_state] ? FIXED_STATES[v.op_state] : v.op_state === 'other' ? v.op_state_text.trim() : null, notes: v.notes,
    current_user_name: v.current_user_name, current_user_mobile: v.current_user_mobile,
    registration_serial: v.registration_serial, insurance_expiry: v.insurance_expiry,
    cost_oil: v.cost_oil, cost_maint: v.cost_maint,
    card_auth_status: v.card_auth_status || null, card_auth_expiry: v.card_auth_expiry || null,
  };
  if (!costsFromRecords) rec.cost_maint_total = v.cost_maint_total;
  // الحقول الإضافية: تُدمج مع القيم المحفوظة (قيم الحقول الموقوفة تبقى كما هي)
  const cf = { ...existingCustom };
  for (const [k, x] of Object.entries(v)) if (k.startsWith('cf__')) cf[k.slice(4)] = x ?? null;
  rec.custom_fields = cf;
  // الحقل القديم «داخل/خارج الموقع» يبقى متوافقاً (تعتمد عليه لوحة التحكم)
  rec.op_status = FIXED_STATES[v.op_state] ? FIXED_STATUS[v.op_state] : opStatusFor(v.op_state, v.op_state_text);
  if (v.op_state === 'inside') rec.location_status = 'inside_site';
  else if (v.op_state === 'outside') rec.location_status = 'outside_site';
  else if (v.op_state === 'workshop' || (v.op_state === 'other' && /ورش/.test(v.op_state_text || ''))) rec.location_status = 'in_workshop';
  rec.owner_company_id = await resolveOwner(v.owner_company);
  if (!rec.owner_company_id) throw userError('اكتب اسم المالك.');
  rec.site_id = await resolveSite(v.site_name, rec.owner_company_id);
  const priv = 'current_user_id_no' in v || 'owner_id_no' in v ? { current_user_id_no: v.current_user_id_no ?? null, owner_id_no: v.owner_id_no ?? null } : null;
  return { rec, docs: { registration: v.registration_expiry, periodic_inspection: v.inspection_expiry }, priv };
}

// الاستمارة والفحص الدوري: سجلات في جدول الوثائق (تظهر في التنبيهات). تعديل التاريخ يحدّث الوثيقة الحالية ولا ينشئ نسخة مكررة
export async function saveVehicleDocs(vehicleId, docs, current = {}) {
  for (const [type, expiry] of Object.entries(docs)) {
    if (!expiry) continue;
    const cur = current[type];
    if (cur && cur.expiry_date === expiry) continue;
    if (cur) await api.update('documents', { id: `eq.${cur.id}` }, { expiry_date: expiry });
    else await api.insert('documents', { doc_type: type, vehicle_id: vehicleId, expiry_date: expiry });
  }
}
export async function saveVehiclePrivate(vehicleId, priv, current = {}) {
  if (!priv || !api.can('view_sensitive')) return;
  if ((priv.current_user_id_no ?? null) === (current.current_user_id_no ?? null) && (priv.owner_id_no ?? null) === (current.owner_id_no ?? null)) return;
  const u = await api.update('vehicle_private', { vehicle_id: `eq.${vehicleId}` }, priv);
  if (!u.length) await api.insert('vehicle_private', { vehicle_id: vehicleId, ...priv });
}

// بطاقة إضافة السيارة وبطاقة تعديلها (النموذج نفسه)
export async function vehicleCardForm(v = null, { docs = {}, priv = {}, oil = [], maint = [] } = {}) {
  await data.lookups(true);
  const sug = await suggestions();
  const isNew = !v;
  const recCosts = !isNew && (oil.length || maint.length) ? { oil, maint } : null;
  return openForm({
    title: isNew ? 'إضافة سيارة' : `تعديل بيانات ${v.code}`, wide: true,
    fields: vehicleFields({ isNew, sug, costsFromRecords: !!recCosts }),
    values: isNew ? { op_state: 'inside' } : vehicleValues(v, { docs, priv }),
    submitText: isNew ? 'حفظ السيارة' : 'حفظ التعديلات',
    intro: isNew ? '' : 'تغيير المالك أو المشروع أو الحالة يُحفظ في «سجل التغييرات». لا تُحذف أي فواتير أو حوادث أو سجلات سابقة.',
    onChange: cardOnChange(sug, recCosts),
    onSubmit: async (val) => {
      const { rec, docs: d, priv: p } = await vehicleRecord(val, { costsFromRecords: !!recCosts, existingCustom: v?.custom_fields || {} });
      let row;
      if (isNew) {
        rec.oil_interval_km = Number(data.setting('oil_default_interval_km', 10000));
        [row] = await api.insert('vehicles', rec);
      } else {
        // تحديث السجل نفسه (لا تُنشأ سيارة جديدة)؛ تُرسل الحقول التي تغيّرت فقط
        const same = (a, b) => (a && typeof a === 'object' ? JSON.stringify(a) === JSON.stringify(b || {}) : (a ?? null) === (b ?? null));
        const changed = Object.fromEntries(Object.entries(rec).filter(([k, x]) => !same(x, v[k])));
        // حالة السيارة تتبع البطاقة فقط عند تغيير الحالة التشغيلية فيها (لا تُلغى حالة سجّلتها صيانة أو حادث)
        const shown = vehicleValues(v, { docs, priv });
        if (val.op_state === shown.op_state && (val.op_state_text || '') === (shown.op_state_text || '')) { delete changed.op_status; delete changed.location_status; delete changed.op_state; delete changed.op_state_text; }
        // سبب التعديل يُحفظ مع التعديل نفسه في سجل التعديلات
        if (Object.keys(changed).length) changed.change_note = (val.change_note || '').trim() || null;
        row = Object.keys(changed).length ? (await api.update('vehicles', { id: `eq.${v.id}` }, changed))[0] : v;
        if (!row) throw userError('لم يُحفظ التعديل: السيارة غير موجودة أو لا تملك صلاحية التعديل.');
      }
      await saveVehicleDocs(row.id, d, docs);
      await saveVehiclePrivate(row.id, p, priv);
      data.invalidate();
      return row;
    },
  });
}

export const addVehicle = () => vehicleCardForm(null);

// وثائق السائق: كل تاريخ جديد يُحفظ كسجل جديد (السابق يبقى في السجل)، ورقم الإقامة في البيانات الحساسة
export async function saveDriverDocs(employeeId, { iqama_no, iqama_expiry, license_expiry }, current = {}) {
  if (!employeeId) return;
  if (iqama_no && api.can('view_sensitive')) {
    if (!/^\d{10}$/.test(iqama_no)) throw userError('رقم الإقامة يجب أن يكون 10 أرقام.');
    const u = await api.update('employee_private', { employee_id: `eq.${employeeId}` }, { iqama_no });
    if (!u.length) await api.insert('employee_private', { employee_id: employeeId, iqama_no });
  }
  if (iqama_expiry && iqama_expiry !== current.iqama) await api.insert('documents', { doc_type: 'iqama', employee_id: employeeId, expiry_date: iqama_expiry });
  if (license_expiry && license_expiry !== current.license) await api.insert('documents', { doc_type: 'driving_license', employee_id: employeeId, expiry_date: license_expiry });
}

const COLS = [
  ['code', 'الرقم الداخلي'], ['plate_no', 'رقم اللوحة'], ['make', 'الماركة والطراز'], ['owner_company_name', 'الشركة المالكة'],
  ['site_name', 'الموقع الحالي'], ['driver_name', 'السائق الحالي'], ['authorization_status', 'حالة التفويض'], ['op_state_text_sort', 'الحالة التشغيلية'],
  ['op_status', 'حالة السيارة'], ['odometer', 'قراءة العداد'], ['oil_next_odometer', 'موعد تغيير الزيت القادم'], ['reg_expiry', 'انتهاء الاستمارة'], ['insp_expiry', 'انتهاء الفحص الدوري'], ['insurance_expiry', 'انتهاء التأمين'], ['nearest_doc_expiry', 'أقرب وثيقة انتهاءً'],
];
const st = { place: '', placeCompany: '', q: '', op: '', loc: '', owner: '', site: '', ins: '', insFrom: '', insTo: '', sort: 'code', dir: 1 };

export async function renderVehicles(el, params = new URLSearchParams()) {
  await data.lookups();
  // فتح القائمة من لوحة التحكم (الضغط على لون أو خانة): تُعرض سيارات تلك الخانة فقط
  if (params.has('place')) {
    Object.assign(st, { q: '', op: '', loc: '', owner: '', ins: '', insFrom: '', insTo: '' });
    st.place = PLACES.some(([k]) => k === params.get('place')) ? params.get('place') : '';
    st.site = params.get('site') || ''; st.placeCompany = params.get('company') || '';
  } else if (st.place) { st.place = ''; st.placeCompany = ''; st.site = ''; }
  const extraCols = customFields().filter((c) => c.in_list);
  const [rows, vdocs, vauth] = await Promise.all([
    api.get('v_vehicles_overview', { select: '*', order: 'code' }),
    api.get('v_document_status', { select: 'owner_id,doc_type,expiry_date,status,days_left', owner_type: 'eq.vehicle', doc_type: 'in.(registration,periodic_inspection)' }),
    api.get('vehicles', { select: 'id,card_auth_status,card_auth_expiry', deleted_at: 'is.null' }).catch(() => []),
  ]);
  const authById = new Map(vauth.map((a) => [a.id, a]));
  for (const r of rows) {
    Object.assign(r, { card_auth_status: null, card_auth_expiry: null }, authById.get(r.id) ? { card_auth_status: authById.get(r.id).card_auth_status, card_auth_expiry: authById.get(r.id).card_auth_expiry } : {});
    r.cauth = r.card_auth_status ? authState(r.card_auth_status, r.card_auth_expiry) : null;
    const g = (t) => vdocs.find((d) => d.owner_id === r.id && d.doc_type === t);
    r.reg = g('registration'); r.insp = g('periodic_inspection');
    r.reg_expiry = r.reg?.expiry_date || null; r.insp_expiry = r.insp?.expiry_date || null;
    r.op = cardStateOf(r); r.op_state_text_sort = r.op.text; r.ins = docState(r.insurance_expiry);
    for (const c of extraCols) r[`cf__${c.key}`] = (r.custom_fields || {})[c.key] ?? null;
  }
  const docCell = (d) => (d?.expiry_date
    ? raw(html`${date(d.expiry_date)}<small class="tag t-${d.status}">${d.days_left < 0 ? `منتهية منذ ${-d.days_left} يوم` : `باقي ${d.days_left} يوم`}</small>`)
    : raw(html`<span class="tag t-${d?.status || 'missing'}">${label('doc_status', d?.status || 'missing')}</span>`));
  const opt = (v, t, cur) => html`<option value="${v}" ${raw(v === cur ? 'selected' : '')}>${t}</option>`;
  el.innerHTML = html`
    <div class="page-head row">
      <h1>السيارات <span class="count num">${num(rows.length)}</span></h1>
      ${raw(api.can('create') ? html`<button class="btn btn-primary" data-act="new">${icon('plus')}<span>إضافة سيارة</span></button>` : '')}
    </div>
    <form class="filters wide-filters" onsubmit="return false">
      <label class="grow"><span>بحث</span><input name="q" type="search" value="${st.q}" placeholder="رقم اللوحة، الرقم الداخلي، الموظف، النوع، الشركة، الموقع"></label>
      <label><span>حالة السيارة</span><select name="op">${raw(opt('', 'الكل', st.op))}${raw(Object.entries(LABELS.op_status).map(([k, t]) => opt(k, t, st.op)).join(''))}</select></label>
      <label><span>الحالة التشغيلية</span><select name="loc">${raw(opt('', 'الكل', st.loc))}${raw(cardStateOptions().map(([k, t]) => opt(k, t, st.loc)).join(''))}</select></label>
      <label><span>الشركة المالكة</span><select name="owner">${raw(opt('', 'الكل', st.owner))}${raw(data.companyOptions(false).map(([k, t]) => opt(k, t, st.owner)).join(''))}</select></label>
      <label><span>الموقع</span><select name="site">${raw(opt('', 'الكل', st.site))}${raw(data.siteOptions(false).map(([k, t]) => opt(k, t, st.site)).join(''))}</select></label>
      <label><span>حالة التأمين</span><select name="ins">${raw(opt('', 'الكل', st.ins))}${raw([['valid', 'ساري'], ['expiring', 'قريب الانتهاء (30 يوماً أو أقل)'], ['expired', 'منتهي'], ['none', 'غير محدد']].map(([k, t]) => opt(k, t, st.ins)).join(''))}</select></label>
      <label><span>انتهاء التأمين من</span><input name="insFrom" type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" value="${st.insFrom}" autocomplete="off"></label>
      <label><span>إلى</span><input name="insTo" type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" value="${st.insTo}" autocomplete="off"></label>
    </form>
    ${raw(st.place ? html`<div class="place-chip" data-place-chip><i class="dot pl-${st.place}"></i><span>من لوحة التحكم: <b>${PLACES.find(([k]) => k === st.place)[1]}</b>${st.placeCompany ? ` · ${data.companyName(st.placeCompany)}` : ''}</span><button type="button" class="btn btn-sm" data-act="clear-place">عرض كل السيارات</button></div>` : '')}
    <div id="vt"></div>`;

  const pager = { limit: PAGE_ROWS };
  const draw = (keep) => {
    if (!keep) pager.limit = PAGE_ROWS;
    const q = st.q.trim().toLowerCase();
    const day = (x) => { try { return x ? parseDate(x) : ''; } catch (_) { return ''; } };
    const insFrom = day(st.insFrom), insTo = day(st.insTo);
    let list = rows.filter((r) =>
      (!st.place || placeOf(r) === st.place) && (!st.placeCompany || r.site_company_id === st.placeCompany) &&
      (!st.op || r.op_status === st.op) && (!st.loc || r.op.key === st.loc) &&
      (!st.owner || r.owner_company_id === st.owner) && (!st.site || r.site_id === st.site) && (!st.ins || r.ins.key === st.ins) &&
      (!insFrom || (r.insurance_expiry && r.insurance_expiry >= insFrom)) && (!insTo || (r.insurance_expiry && r.insurance_expiry <= insTo)) &&
      (!q || [r.plate_no, r.code, r.driver_name, r.vehicle_type, r.make, r.model, r.owner_company_name, r.site_name, r.location_text, r.current_user_name, r.authorized_name, r.registration_serial, r.op.text, ...Object.values(r.custom_fields || {}).map((x) => (x == null ? '' : String(x)))].some((x) => (x || '').toLowerCase().includes(q))));
    list = list.sort((a, b) => {
      const x = a[st.sort], y = b[st.sort];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ar')) * st.dir;
    });
    const arrow = (k) => (st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : '');
    $('#vt', el).innerHTML = list.length ? html`
      <div class="table-wrap"><table class="rtable">
        <thead><tr>${raw([...COLS, ...extraCols.map((c) => [`cf__${c.key}`, c.label])].map(([k, t]) => html`<th><button class="sort" data-sort="${k}">${t}${arrow(k)}</button></th>`).join(''))}<th><span class="sr">إجراءات</span></th></tr></thead>
        <tbody>${raw(list.slice(0, pager.limit).map((r) => html`<tr>
          <td data-l="الرقم الداخلي"><a href="#/vehicles/${r.id}" class="code strong">${r.code}</a></td>
          <td data-l="رقم اللوحة" class="plate">${r.plate_no}</td>
          <td data-l="الماركة والطراز">${[r.make, r.model, r.manufacture_year].filter(Boolean).join(' · ') || '—'}</td>
          <td data-l="الشركة المالكة">${r.owner_company_name}</td>
          <td data-l="الموقع الحالي">${r.site_name || '—'}${raw(r.location_text ? html`<small class="muted">${r.location_text}</small>` : '')}</td>
          <td data-l="السائق الحالي">${r.driver_name || '—'}</td>
          <td data-l="حالة التفويض">${r.cauth ? raw(html`<span class="tag t-${r.cauth.tag}">${r.card_auth_status === 'authorized' ? `مفوضة · ${r.cauth.text}` : r.cauth.text}</span>`) : raw(html`<span class="tag t-${r.authorization_status}">${label('auth_status', r.authorization_status)}</span>`)}</td>
          <td data-l="الحالة التشغيلية">${raw(opChip(r))}</td>
          <td data-l="حالة السيارة"><span class="pill st-${r.op_status}">${label('op_status', r.op_status)}</span></td>
          <td data-l="قراءة العداد" class="num">${km(r.odometer)}</td>
          <td data-l="تغيير الزيت القادم" class="num">${r.oil_next_odometer ? raw(html`${km(r.oil_next_odometer)}<small class="tag t-${r.oil_status}">${label('oil_status', r.oil_status)}</small>`) : '—'}</td>
          <td data-l="انتهاء الاستمارة" class="num">${docCell(r.reg)}</td>
          <td data-l="انتهاء الفحص الدوري" class="num">${docCell(r.insp)}</td>
          <td data-l="انتهاء التأمين" class="num">${r.insurance_expiry ? raw(html`${date(r.insurance_expiry)}<small class="tag t-${{ none: 'missing', expired: 'expired', expiring: 'expiring', valid: 'valid' }[r.ins.key]}">${r.ins.key === 'expired' ? r.ins.daysText : `${r.ins.text} · ${r.ins.daysText}`}</small>`) : raw('<span class="tag t-missing">غير محدد</span>')}</td>
          <td data-l="أقرب وثيقة انتهاءً" class="num">${r.nearest_doc_expiry ? raw(html`${date(r.nearest_doc_expiry)}<small class="muted">${label('doc_type', r.nearest_doc_type)}</small>`) : '—'}</td>
          ${raw(extraCols.map((c) => html`<td data-l="${c.label}">${cfText(c, (r.custom_fields || {})[c.key])}</td>`).join(''))}
          <td class="act"><a class="btn btn-sm" href="#/vehicles/${r.id}">عرض الملف</a>${raw(api.can('edit') ? html`<a class="btn btn-sm" href="#/vehicles/${r.id}?edit=1">تعديل</a>` : '')}</td>
        </tr>`).join(''))}</tbody></table>${moreRows(Math.min(pager.limit, list.length), list.length)}</div>`
      : html`<div class="empty soft"><p>${rows.length ? 'لا توجد سيارات مطابقة للبحث أو الفلاتر.' : 'لم تُسجَّل أي سيارة بعد.'}</p>${raw(!rows.length && api.can('create') ? html`<button class="btn btn-primary" data-act="new">${icon('plus')}<span>إضافة أول سيارة</span></button>` : '')}</div>`;
  };
  draw();
  bindMore($('#vt', el), pager, draw);
  const f = $('form', el);
  f.addEventListener('input', () => { st.q = f.q.value; st.op = f.op.value; st.loc = f.loc.value; st.owner = f.owner.value; st.site = f.site.value; st.ins = f.ins.value; st.insFrom = f.insFrom.value; st.insTo = f.insTo.value; draw(); });
  el.onclick = async (e) => {
    const s = e.target.closest('[data-sort]');
    if (s) { const k = s.dataset.sort; st.dir = st.sort === k ? -st.dir : 1; st.sort = k; draw(); return; }
    if (e.target.closest('[data-act=clear-place]')) { st.place = ''; st.placeCompany = ''; st.site = ''; location.hash = '#/vehicles'; return; }
    if (e.target.closest('[data-act=new]')) {
      const row = await addVehicle();
      if (row) { saved(`تمت إضافة السيارة ${row.code}`); location.hash = `#/vehicles/${row.id}`; }
    }
  };
}
