// فحص تواريخ التجديد قبل الحفظ (رخصة المفوّض، الاستمارة، التأمين، الفحص الدوري) حسب النظام المروري السعودي.
// التنبيه لا يمنع الحفظ: يظهر للمستخدم ويختار «تصحيح» أو «حفظ على أي حال».
import { date, todayISO, num } from './fmt.js';
import { confirmBox, userError } from './form.js';
import { html, raw } from './ui.js';

const DAY = 864e5;
const days = (a, b) => Math.round((new Date(a) - new Date(b)) / DAY);
const addYears = (iso, y) => { const d = new Date(iso); d.setFullYear(d.getFullYear() + y); return d.toISOString().slice(0, 10); };
const TOL = 60; // سماح بالأيام حول المدة النظامية

// المدد النظامية بالسنوات لكل وثيقة
export const RULES = {
  license: { name: 'رخصة القيادة', years: [2, 5, 10], text: 'سنتان أو 5 سنوات أو 10 سنوات' },
  registration: { name: 'الاستمارة', years: [3], text: '3 سنوات' },
  insurance: { name: 'التأمين', years: [1], text: 'سنة واحدة (12 شهراً)' },
  inspection: { name: 'الفحص الدوري', years: [1], text: 'سنة واحدة' },
};

// هل المدة الجديدة قريبة من إحدى المدد النظامية (محسوبة من اليوم أو من تاريخ الانتهاء الحالي)؟
function fitsPeriod(kind, iso, current) {
  const bases = [todayISO(), ...(current && current >= todayISO() ? [current] : [])];
  return RULES[kind].years.some((y) => bases.some((b) => Math.abs(days(iso, addYears(b, y))) <= TOL));
}

// قائمة التنبيهات لتاريخ واحد
// kind: license | registration | insurance | inspection
// ctx: { current, manufactureYear, prereq: [{ ok, text }] }
export function dateWarnings(kind, iso, ctx = {}) {
  const out = [];
  if (!iso) return out;
  const r = RULES[kind], today = todayISO(), cur = ctx.current || null;
  const y = Number(String(iso).slice(0, 4)), ty = Number(today.slice(0, 4));
  if (y < ty - 1 || y > ty + 11) out.push(`السنة ${y} غير منطقية لتاريخ انتهاء ${r.name}. تأكد من الأرقام (مثلاً 2026 وليس 2062).`);
  else if (iso < today) out.push(`تاريخ انتهاء ${r.name} الجديد (${date(iso)}) قبل اليوم، أي أن الوثيقة منتهية.`);
  if (cur && iso === cur) out.push(`التاريخ الجديد مطابق للتاريخ المسجل حالياً (${date(cur)})، فلم يحدث تجديد فعلي.`);
  else if (cur && iso < cur) out.push(`التاريخ الجديد (${date(iso)}) أقدم من التاريخ المسجل حالياً (${date(cur)}).`);
  if (iso >= today && !(cur && iso <= cur) && !fitsPeriod(kind, iso, cur)) {
    const left = days(iso, today);
    out.push(`مدة ${r.name} النظامية ${r.text}، والتاريخ المدخل يعطي ${left >= 365 ? `${num(Math.round((left / 365) * 10) / 10)} سنة تقريباً` : `${num(left)} يوماً`}.`);
  }
  if (kind === 'inspection' && ctx.manufactureYear && ctx.manufactureYear >= ty - 2) {
    out.push(`السيارة موديل ${ctx.manufactureYear}: السيارات الخاصة الجديدة معفاة من الفحص لأول 3 سنوات من أول ترخيص. تأكد أن الفحص مطلوب.`);
  }
  for (const p of ctx.prereq || []) if (!p.ok) out.push(p.text);
  return out;
}

// نافذة التنبيه: true = حفظ على أي حال، ويرمي خطأً للبقاء في النموذج عند «تصحيح»
export async function confirmWarnings(list) {
  if (!list.length) return true;
  const ok = await confirmBox(html`<p><b>⚠️ لاحظ النظام ما قد يكون خطأً:</b></p><ul class="chk-list">${raw(list.map((t) => html`<li>${t}</li>`).join(''))}</ul>
    <p class="muted small">التنبيه لا يمنع الحفظ. اختر «تصحيح» للرجوع وتعديل البيانات.</p>`.toString(),
  { title: 'تنبيه قبل الحفظ', okText: 'حفظ على أي حال', cancelText: 'تصحيح' });
  if (!ok) throw userError('لم يُحفظ. صحّح البيانات ثم احفظ.');
  return true;
}
