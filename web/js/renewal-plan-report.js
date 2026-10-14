// تقرير خطة تجديد المركبة والمفوض PDF: الخطوات الخمس بحالتها وتواريخها ومن أكّدها (خطة واحدة فقط بالمعرّف)
import * as api from './api.js';
import { html, raw } from './ui.js';
import { date, dateTime, todayISO, num } from './fmt.js';
import { saveBlob } from './xlsx.js';
import { cardStateOf, docState } from './pages/vehicles.js';
import { reportFileName, dataUrl, renderPages, pdfFromJpegs, printFallback, REPORT_CSS, loadRenewalData, renewalModel } from './renewal-report.js';
import { STEPS } from './pages/renewal.js';

const COMPANY = 'شركة روى الرمال الزراعية';
const NR = 'غير مسجل';
const ST = { done: 'مكتملة', entered: 'بانتظار التأكيد', pending: 'لم تبدأ' };
const RESULT = { passed: 'اجتاز', failed: 'لم يجتز' };
const FINES = { none: 'لا توجد مخالفات أو رسوم', paid: 'تم السداد' };
const SRC = { plan: 'من الخطة', card: 'من بطاقة السيارة', delegate: 'من ملف المفوّض', auto: 'تلقائياً: التاريخ ساري', skip: 'تم التجاوز' };
const CSS2 = `.bad{color:#b3261e;font-weight:700}.wrn{color:#9a6b12;font-weight:700}.nx{color:#9a6b12;font-size:11px}
td,th{font-size:12px}
.st-done{color:#1f5c3a;font-weight:700}.st-entered{color:#9a6b12;font-weight:700}.st-pending{color:#5d6b62}
.prog{height:12px;border-radius:6px;background:#e3e8e4;overflow:hidden;margin-top:6px}.prog span{display:block;height:100%;background:#1f5c3a}`;

export async function planReport(id) {
  const [[p], steps] = await Promise.all([
    api.get('v_renewal_plans', { select: '*', id: `eq.${id}` }),
    api.get('v_renewal_steps', { select: '*', plan_id: `eq.${id}`, order: 'step_no' }),
  ]);
  if (!p) throw new Error('الخطة غير موجودة.');
  if (steps.some((s) => s.plan_id !== id)) throw new Error('بيانات غير مطابقة للخطة — أُلغي التقرير.');
  // معلومات السيارة الكاملة (من ملف هذه السيارة فقط بالمعرّف، مثل تقرير تجديد المركبة)
  const vd = await loadRenewalData(p.vehicle_id);
  const vm = renewalModel(vd);
  if (vm.v.id !== p.vehicle_id) throw new Error('بيانات غير مطابقة للسيارة — أُلغي التقرير.');
  const VEH_PARTS = ['vehicle', 'owner', 'reg', 'insp', 'ins', 'follow'];
  // الوضع الحالي لوثيقة كل خطة (مكتملة أو غير مكتملة): التاريخ، الحالة، المتبقي
  const latest = (t) => vd.docs.filter((d) => d.doc_type === t).sort((a, b) => String(b.expiry_date || '').localeCompare(String(a.expiry_date || '')))[0]?.expiry_date || null;
  const DOC_ST = { valid: 'سارية', expiring: 'تنتهي قريباً', expired: 'منتهية', none: NR };
  const finesRows = (vm.sections.find(([k]) => k === 'fines') || [, , []])[2].filter(([, x]) => x !== NR);
  const current = (n) => {
    if (n === 4) return { date: '—', state: finesRows.length ? finesRows.map(([k, x]) => `${k}: ${x}`).join('، ') : NR, bad: false };
    if (n === 1 && !p.delegate_id) return { date: 'لا يوجد مفوّض', state: NR, bad: true };
    const iso = { 1: p.delegate_license_expiry, 2: latest('periodic_inspection'), 3: vd.v.insurance_expiry, 5: latest('registration') }[n];
    const st = docState(iso);
    return { date: iso ? date(iso) : NR, state: iso ? (st.key === "expired" ? st.daysText : `${DOC_ST[st.key]} · ${st.daysText}`) : NR, bad: st.key === 'expired' || !iso, warn: st.key === 'expiring' };
  };
  // اسم الملف = رقم لوحة السيارة كما هو في النظام (مثل «ح ك و UKJ 2377.pdf»)
  const plateName = String(p.plate_no || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || reportFileName(p.plate_no).replace(/\.pdf$/, '');
  const name = `${plateName}.pdf`;
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
      <tr><th>#</th><th>الخطوة</th><th>حالة الخطوة</th><th>تاريخ الانتهاء الحالي</th><th>حالة الوثيقة</th><th>بيانات الخطوة</th><th>التأكيد</th></tr>
      ${raw(steps.map((s) => { const c = current(s.step_no); return html`<tr><td>${num(s.step_no)}</td><td>${STEPS.find(([n]) => n === s.step_no)?.[2]}${raw(p.status === 'active' && s.step_no === p.next_step ? ' <b class="nx">⚠ التالية</b>' : '')}</td>
        <td class="st-${s.status}">${s.source === 'skip' ? 'متجاوزة' : ST[s.status]}</td>
        <td class="${c.date === NR ? 'nr' : ''}">${c.date}</td>
        <td class="${c.bad ? 'bad' : c.warn ? 'wrn' : ''}">${c.state}</td>
        <td>${[s.new_expiry ? `الجديد: ${date(s.new_expiry)}` : '', s.result ? `النتيجة: ${RESULT[s.result]}` : '', s.fines_status ? FINES[s.fines_status] : '', s.notes || ''].filter(Boolean).join(' · ') || '—'}</td>
        <td>${s.status === 'done' ? `${s.confirmed_by_name || ''} ${dateTime(s.confirmed_at)} ${SRC[s.source] ? `(${SRC[s.source]})` : ''}` : '—'}</td></tr>`; }).join(''))}
    </table></div>
    ${raw(vm.sections.filter(([k]) => VEH_PARTS.includes(k)).map(([k, t, rows]) => html`<div class="rb"><h2>${k === 'vehicle' ? `معلومات السيارة الكاملة — ${t}` : t}</h2><table>${raw(rows.map(([k, x]) => row(k, x)).join(''))}</table></div>`).join(''))}
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
