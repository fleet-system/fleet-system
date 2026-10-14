// تقرير خطة تجديد المركبة والمفوض PDF: الخطوات الخمس بحالتها وتواريخها ومن أكّدها (خطة واحدة فقط بالمعرّف)
import * as api from './api.js';
import { html, raw } from './ui.js';
import { date, dateTime, todayISO, num } from './fmt.js';
import { saveBlob } from './xlsx.js';
import { cardStateOf } from './pages/vehicles.js';
import { reportFileName, dataUrl, renderPages, pdfFromJpegs, printFallback, REPORT_CSS, loadRenewalData, renewalModel } from './renewal-report.js';
import { STEPS } from './pages/renewal.js';

const COMPANY = 'شركة روى الرمال الزراعية';
const NR = 'غير مسجل';
const ST = { done: 'مكتملة', entered: 'بانتظار التأكيد', pending: 'لم تبدأ' };
const RESULT = { passed: 'اجتاز', failed: 'لم يجتز' };
const FINES = { none: 'لا توجد مخالفات أو رسوم', paid: 'تم السداد' };
const SRC = { plan: 'من الخطة', card: 'من بطاقة السيارة', delegate: 'من ملف المفوّض' };
const CSS2 = `.st-done{color:#1f5c3a;font-weight:700}.st-entered{color:#9a6b12;font-weight:700}.st-pending{color:#5d6b62}
.prog{height:12px;border-radius:6px;background:#e3e8e4;overflow:hidden;margin-top:6px}.prog span{display:block;height:100%;background:#1f5c3a}`;

export async function planReport(id) {
  const [[p], steps] = await Promise.all([
    api.get('v_renewal_plans', { select: '*', id: `eq.${id}` }),
    api.get('v_renewal_steps', { select: '*', plan_id: `eq.${id}`, order: 'step_no' }),
  ]);
  if (!p) throw new Error('الخطة غير موجودة.');
  if (steps.some((s) => s.plan_id !== id)) throw new Error('بيانات غير مطابقة للخطة — أُلغي التقرير.');
  // معلومات السيارة الكاملة (من ملف هذه السيارة فقط بالمعرّف، مثل تقرير تجديد المركبة)
  const vm = renewalModel(await loadRenewalData(p.vehicle_id));
  if (vm.v.id !== p.vehicle_id) throw new Error('بيانات غير مطابقة للسيارة — أُلغي التقرير.');
  const VEH_PARTS = ['vehicle', 'owner', 'reg', 'insp', 'ins', 'follow'];
  const name = reportFileName(p.plate_no).replace('تقرير-تجديد-المركبة-', 'خطة-تجديد-المركبة-والمفوض-');
  const op = cardStateOf(p);
  const row = (k, x) => html`<tr><td class="k">${k}</td><td class="${x === NR ? 'nr' : ''}">${x}</td></tr>`;
  const logo = await dataUrl('logo-mark.png') || await dataUrl('logo.png');
  const markup = String(html`<div class="rp" xmlns="http://www.w3.org/1999/xhtml"><style>${raw(REPORT_CSS + CSS2)}</style>
    <div class="rb hd">${raw(logo ? html`<img src="${logo}" alt=""/>` : '')}
      <div class="co"><b>${COMPANY}</b><span>نظام إدارة الأسطول والمواقع الزراعية</span></div>
      <div class="meta">تاريخ التقرير: ${date(todayISO())}<br/>${api.currentUser()?.full_name ? `أعدّه: ${api.currentUser().full_name}` : ''}</div></div>
    <div class="rb ttl"><h1>خطة تجديد المركبة والمفوض</h1><div class="plate">${p.plate_no}</div></div>
    <div class="rb sub">رقم الخطة: ${p.plan_no} — الرقم الداخلي للسيارة: ${p.code}</div>
    <div class="rb"><h2>ملخص الخطة</h2><table>
      ${raw(row('حالة الخطة', p.status === 'completed' ? `مكتملة بتاريخ ${dateTime(p.completed_at)}` : 'جارية'))}
      ${raw(row('التقدّم', `${num(p.done_count)} من 5`))}
      ${raw(row('الخطوة التالية', p.status === 'completed' ? '—' : (STEPS.find(([n]) => n === p.next_step)?.[2] || '—')))}
      ${raw(row('المفوّض', p.delegate_name || NR))}
      ${raw(row('تاريخ انتهاء رخصة المفوّض', p.delegate_license_expiry ? date(p.delegate_license_expiry) : NR))}
      ${raw(row('حالة السيارة', op.text || NR))}
      ${raw(row('تاريخ إنشاء الخطة', dateTime(p.created_at)))}
    </table><div class="prog"><span style="width:${(p.done_count / 5) * 100}%"></span></div></div>
    <div class="rb"><h2>الخطوات بالترتيب</h2><table>
      <tr><th>#</th><th>الخطوة</th><th>الحالة</th><th>البيانات</th><th>التأكيد</th></tr>
      ${raw(steps.map((s) => html`<tr><td>${num(s.step_no)}</td><td>${STEPS.find(([n]) => n === s.step_no)?.[2]}</td>
        <td class="st-${s.status}">${ST[s.status]}</td>
        <td>${[s.new_expiry ? `ينتهي ${date(s.new_expiry)}` : '', s.result ? `النتيجة: ${RESULT[s.result]}` : '', s.fines_status ? FINES[s.fines_status] : '', s.notes || ''].filter(Boolean).join(' · ') || '—'}</td>
        <td>${s.status === 'done' ? `${s.confirmed_by_name || ''} ${dateTime(s.confirmed_at)} ${SRC[s.source] ? `(${SRC[s.source]})` : ''}` : '—'}</td></tr>`).join(''))}
    </table></div>
    <div class="rb sub"><b>معلومات السيارة الكاملة</b> — من ملف السيارة ${p.code} مباشرة.</div>
    ${raw(vm.sections.filter(([k]) => VEH_PARTS.includes(k)).map(([, t, rows]) => html`<div class="rb"><h2>${t}</h2><table>${raw(rows.map(([k, x]) => row(k, x)).join(''))}</table></div>`).join(''))}
    <div class="rb sub">النظام للمتابعة والتسجيل فقط، ولا ينفّذ أي إجراء حكومي.</div>
    <div class="rb sign"><div>المسؤول عن التجديد</div><div>المدير المختص</div><div>الختم</div></div>
    <div class="rb foot">${COMPANY} — خطة تجديد المركبة ${p.plate_no} — صدر من النظام بتاريخ ${date(todayISO())}</div>
  </div>`);
  let pages;
  try { pages = await renderPages(markup); } catch (_) { printFallback(markup, name); return { name, fallback: true }; }
  const blob = pdfFromJpegs(pages, name.replace(/\.pdf$/, ''));
  saveBlob(blob, name);
  return { name, pages: pages.length, size: blob.size };
}
