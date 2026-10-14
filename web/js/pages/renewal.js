// خطة تجديد المركبة والمفوض: خمس خطوات بالترتيب لكل سيارة، والمفوّض ملف واحد يُربط بأكثر من سيارة
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, toast } from '../ui.js';
import { date, dateTime, num, saMobile, saMobileLocal } from '../fmt.js';
import { openForm, confirmBox, userError, saved } from '../form.js';
import { PLACES, placeOf, opChip, docState } from './vehicles.js';

export const STEPS = [
  [1, 'delegate_license', 'تجديد رخصة قيادة المفوّض'],
  [2, 'inspection', 'إجراء الفحص الدوري'],
  [3, 'insurance', 'تجديد تأمين السيارة'],
  [4, 'fines', 'سداد المخالفات والرسوم'],
  [5, 'registration', 'تجديد استمارة السيارة'],
];
export const stepName = (n) => STEPS.find(([k]) => k === n)?.[2] || '';
const STEP_DOC = { 1: 'delegate_license', 2: 'periodic_inspection', 3: 'insurance', 5: 'registration' };
const DOC_NAME = { delegate_license: 'رخصة المفوّض', periodic_inspection: 'الفحص الدوري', insurance: 'التأمين', registration: 'الاستمارة' };
const RESULT = { passed: 'اجتاز', failed: 'لم يجتز' };
const FINES = { none: 'لا توجد مخالفات أو رسوم', paid: 'تم السداد' };
const SOURCE = { plan: '', card: 'تم التحديث من بطاقة السيارة', delegate: 'تم التحديث من ملف المفوّض' };
const placeName = (k) => PLACES.find(([x]) => x === k)?.[1] || '';

// نفس مطابقة الأسماء في قاعدة البيانات (الهمزات، الألف المقصورة، التاء المربوطة، المسافات، التشكيل)
export function normName(s) {
  return String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
}
export function licTag(iso) {
  const s = docState(iso);
  const tag = { none: 'no_date', expired: 'expired', expiring: 'expiring', valid: 'valid' }[s.key];
  return html`<span class="tag t-${tag}">${iso ? (s.key === 'expired' ? s.daysText : `${s.text} · ${s.daysText}`) : 'غير محدد'}</span>`;
}
const progress = (p) => html`<div class="rn-bar" role="img" aria-label="${num(p.done_count)} من 5"><span style="width:${(p.done_count / 5) * 100}%"></span></div>`;
const nextText = (p) => (p.status === 'completed' ? html`<b class="ok-text">مكتملة ✓</b>` : html`التالي: <b>${stepName(p.next_step)}</b>${raw(p.next_status === 'entered' ? ' <span class="tag t-expiring">بانتظار التأكيد</span>' : '')}`);

// بطاقة خطة مختصرة (لوحة التحكم، القائمة، ملف المفوّض)
export function planCard(p) {
  const k = placeOf(p);
  return html`<a class="rn-card" href="#/renewal/${p.id}" data-plan="${p.id}">
    <span class="rn-card-top"><b class="plate">${p.plate_no}</b> <small class="muted">${p.code}</small>
      <span class="rn-place"><i class="dot pl-${k}"></i>${placeName(k)}</span></span>
    ${raw(progress(p))}
    <small class="rn-next"><span class="num">${num(p.done_count)} من 5</span> · ${raw(nextText(p))}</small>
    ${raw(p.delegate_name ? html`<small class="muted">المفوّض: ${p.delegate_name}</small>` : '')}
  </a>`;
}

// إنشاء خطة لسيارة (أو فتح خطتها الجارية)
export async function newPlan(vehicleId = null) {
  if (!api.can('create')) { toast('لا تملك صلاحية الإضافة.', 'error'); return null; }
  await data.lookups();
  const r = await openForm({
    title: 'خطة تجديد جديدة', draft: false, submitText: 'إنشاء الخطة',
    intro: 'تُنشأ خمس خطوات بالترتيب: رخصة المفوّض، الفحص الدوري، التأمين، المخالفات والرسوم، الاستمارة. لا تكتمل أي خطوة إلا بتأكيدك.',
    fields: [
      { name: 'vehicle_id', label: 'السيارة', type: 'select', required: true, options: data.vehicleOptions(), full: true },
      { name: 'notes', label: 'ملاحظة (اختياري)', type: 'textarea', full: true },
    ],
    values: { vehicle_id: vehicleId || '' },
    onSubmit: async (val) => {
      const [cur] = await api.get('v_renewal_plans', { select: 'id', vehicle_id: `eq.${val.vehicle_id}`, status: 'eq.active' });
      if (cur) return { id: cur.id, existing: true };
      return { id: await api.rpc('create_renewal_plan', { p_vehicle: val.vehicle_id, p_notes: val.notes || null }) };
    },
  });
  if (!r) return null;
  if (r.existing) toast('لهذه السيارة خطة جارية؛ فُتحت الخطة الحالية.', 'ok'); else saved('أُنشئت خطة التجديد');
  location.hash = `#/renewal/${r.id}`;
  return r;
}

// ---------------------------------------------------------------------
// قائمة الخطط
// ---------------------------------------------------------------------
const st = { place: '', status: 'active', q: '' };
export async function renderRenewalList(el, params) {
  if (params.has('place')) st.place = PLACES.some(([k]) => k === params.get('place')) ? params.get('place') : '';
  if (params.has('status')) st.status = params.get('status');
  const rows = await api.get('v_renewal_plans', { select: '*', order: 'created_at.desc' });
  el.innerHTML = html`
    <a class="back" href="#/dashboard">${icon('back')}<span>لوحة التحكم</span></a>
    <div class="page-head row"><h1>خطة تجديد المركبة والمفوض</h1>
      <div class="btn-row"><a class="btn" href="#/delegates">${icon('people')}<span>المفوّضون</span></a>
      ${raw(api.can('create') ? html`<button class="btn btn-primary" data-act="new">${icon('plus')}<span>خطة جديدة</span></button>` : '')}</div></div>
    <form class="filters" onsubmit="return false">
      <label class="grow"><span>بحث</span><input name="q" type="search" value="${st.q}" placeholder="رقم اللوحة، الرقم الداخلي، المفوّض، رقم الخطة"></label>
      <label><span>الحالة</span><select name="status">${raw([['active', 'جارية'], ['completed', 'مكتملة'], ['', 'الكل']].map(([k, t]) => html`<option value="${k}" ${raw(k === st.status ? 'selected' : '')}>${t}</option>`).join(''))}</select></label>
    </form>
    <div class="rn-chips" role="group" aria-label="حسب حالة السيارة"></div>
    <div class="rn-list" data-list></div>`;
  const draw = () => {
    const q = normName(st.q);
    const base = rows.filter((p) => (!st.status || p.status === st.status) && (!q || [p.plate_no, p.code, p.plan_no, p.delegate_name].some((x) => normName(x).includes(q))));
    el.querySelector('.rn-chips').innerHTML = [['', 'الكل', base.length], ...PLACES.map(([k, t]) => [k, t, base.filter((p) => placeOf(p) === k).length])]
      .map(([k, t, n]) => html`<button type="button" class="rn-chip ${k === st.place ? 'on' : ''}" data-place="${k}">${raw(k ? html`<i class="dot pl-${k}"></i>` : '')}${t} <b class="num">${num(n)}</b></button>`).join('');
    const list = base.filter((p) => !st.place || placeOf(p) === st.place);
    el.querySelector('[data-list]').innerHTML = list.length ? list.map(planCard).join('')
      : html`<div class="empty soft"><p>لا توجد خطط${st.place ? ` لسيارات «${placeName(st.place)}»` : ''}.</p></div>`;
  };
  draw();
  const f = el.querySelector('form.filters');
  f.addEventListener('input', () => { st.q = f.q.value; st.status = f.status.value; draw(); });
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-place]'); if (c) { st.place = c.dataset.place; draw(); return; }
    if (e.target.closest('[data-act=new]')) newPlan();
  });
}

// ---------------------------------------------------------------------
// خطة سيارة واحدة
// ---------------------------------------------------------------------
export async function renderPlan(el, id) {
  const [[p], steps] = await Promise.all([
    api.get('v_renewal_plans', { select: '*', id: `eq.${id}` }),
    api.get('v_renewal_steps', { select: '*', plan_id: `eq.${id}`, order: 'step_no' }),
  ]);
  if (!p) { el.innerHTML = html`<div class="empty"><h1>الخطة غير موجودة</h1><a class="btn btn-primary" href="#/renewal">قائمة الخطط</a></div>`; return; }
  const [docs, [dl]] = await Promise.all([
    api.get('v_document_status', { select: 'doc_type,expiry_date,days_left,status', owner_type: 'eq.vehicle', owner_id: `eq.${p.vehicle_id}`, doc_type: 'in.(delegate_license,periodic_inspection,insurance,registration)' }),
    p.delegate_id ? api.get('v_delegates', { select: '*', id: `eq.${p.delegate_id}` }) : Promise.resolve([]),
  ]);
  document.title = `خطة تجديد ${p.plate_no} — نظام إدارة الأسطول`;
  const doc = (t) => docs.find((d) => d.doc_type === t);
  const expired = Object.keys(DOC_NAME).filter((t) => doc(t)?.days_left != null && doc(t).days_left < 0);
  const soon = Object.keys(DOC_NAME).filter((t) => doc(t)?.days_left != null && doc(t).days_left >= 0 && doc(t).days_left <= 30);
  const next = p.status === 'active' ? steps.find((s) => s.status !== 'done') : null;
  const canEdit = api.can('edit'), canSave = api.can('edit') || api.can('create');
  const k = placeOf(p);

  const curInfo = (s) => {
    const t = STEP_DOC[s.step_no]; if (!t) return '';
    const d = doc(t);
    return html`<small class="muted">الحالي: ${d?.expiry_date ? raw(html`<span class="num">${date(d.expiry_date)}</span> ${raw(licTag(d.expiry_date))}`) : 'غير مسجل'}</small>`;
  };
  const detail = (s) => [
    s.new_expiry ? html`تاريخ الانتهاء الجديد: <b class="num">${date(s.new_expiry)}</b>` : '',
    s.result ? html`النتيجة: <b>${RESULT[s.result]}</b>` : '',
    s.fines_status ? html`<b>${FINES[s.fines_status]}</b>` : '',
    s.notes ? html`ملاحظة: ${s.notes}` : '',
  ].filter(Boolean).map((x) => html`<span>${raw(x)}</span>`).join('');
  const stepHtml = (s) => {
    // كل الخطوات مفتوحة؛ الخطوة التالية (أول خطوة غير مكتملة بالترتيب) عليها علامة تنبيه
    const isNext = next && s.id === next.id;
    const open = p.status === 'active' && s.status !== 'done';
    const cls = s.status === 'done' ? 'done' : isNext ? 'next' : 'open';
    const badge = s.status === 'done' ? html`<span class="tag t-valid">مكتملة</span>`
      : html`${raw(isNext ? '<span class="tag rn-next-tag" data-next-alert>⚠️ الخطوة التالية</span>' : '')}${raw(s.status === 'entered' ? '<span class="tag t-expiring">بانتظار التأكيد</span>' : !isNext ? '<span class="tag t-no_date">لم تبدأ</span>' : '')}`;
    return html`<li class="rn-step ${cls}" data-step="${s.step_no}">
      <span class="rn-num">${s.status === 'done' ? '✓' : isNext ? '!' : num(s.step_no)}</span>
      <div class="rn-body">
        <div class="rn-head"><b>${num(s.step_no)}. ${stepName(s.step_no)}</b>${raw(badge)}</div>
        ${raw(isNext ? html`<p class="rn-alert" role="note">${icon('alert')}<span>تنبيه: هذه الخطوة التالية حسب الترتيب.</span></p>` : '')}
        ${raw(s.step_no === 1 ? html`<small>المفوّض: ${raw(p.delegate_id ? html`<a href="#/delegates/${p.delegate_id}">${p.delegate_name}</a>` : '<b class="bad-text">لم يُحدد</b>')}</small>` : '')}
        ${raw(s.status !== 'done' ? curInfo(s) : '')}
        ${raw(detail(s) ? html`<div class="rn-detail">${raw(detail(s))}</div>` : '')}
        ${raw(s.status === 'done' ? html`<small class="muted">أكّدها ${s.confirmed_by_name || '—'} في <span class="num">${dateTime(s.confirmed_at)}</span>${SOURCE[s.source] ? ` · ${SOURCE[s.source]}` : ''}</small>`
          : s.status === 'entered' ? html`<small class="muted">سجّلها ${s.entered_by_name || '—'} في <span class="num">${dateTime(s.entered_at)}</span> — لم تُؤكَّد بعد</small>` : '')}
        ${raw(open ? html`<div class="btn-row">
          ${raw(s.step_no === 1 && !p.delegate_id && canEdit ? '<button class="btn btn-sm" data-act="set-delegate">تحديد المفوّض</button>' : '')}
          ${raw(canSave ? `<button class="btn btn-sm" data-act="save" data-step="${s.step_no}">تسجيل البيانات</button>` : '')}
          ${raw(canEdit ? `<button class="btn btn-sm ${isNext ? 'btn-primary' : ''}" data-act="confirm" data-step="${s.step_no}">تأكيد إكمال الخطوة</button>` : '')}</div>` : '')}
      </div></li>`;
  };

  el.innerHTML = html`
    <a class="back" href="#/renewal">${icon('back')}<span>خطط التجديد</span></a>
    <div class="page-head row"><h1>خطة تجديد المركبة والمفوض <small class="code">${p.plan_no}</small></h1>
      <div class="btn-row"><button class="btn" data-act="pdf">${icon('print')}<span>تقرير PDF</span></button>
      ${raw(canEdit ? html`<button class="btn btn-danger-soft" data-act="archive">${icon('close')}<span>حذف الخطة إلى السجل</span></button>` : '')}</div></div>
    <section class="rn-hero">
      <div class="rn-veh"><a class="plate-big plate" href="#/vehicles/${p.vehicle_id}">${p.plate_no}</a>
        <div><a href="#/vehicles/${p.vehicle_id}" class="code">${p.code}</a> ${raw(opChip(p))}
          <div class="muted small"><i class="dot pl-${k}"></i> ${placeName(k)} · المفوّض: ${raw(p.delegate_id ? html`<a href="#/delegates/${p.delegate_id}">${p.delegate_name}</a>` : 'لم يُحدد')}</div></div></div>
      ${raw(p.status === 'completed' ? html`<p class="ok-box rn-banner">${icon('shield')}<span><b>اكتملت خطة التجديد</b> بتاريخ <span class="num">${dateTime(p.completed_at)}</span>.</span></p>`
        : expired.length ? html`<p class="bad-box rn-banner">${icon('alert')}<span><b>${expired.length >= 3 ? 'المركبة غير نظامية' : 'وثائق منتهية'}</b> — منتهية: ${expired.map((t) => DOC_NAME[t]).join(' · ')}${soon.length ? ` · تنتهي قريباً: ${soon.map((t) => DOC_NAME[t]).join(' · ')}` : ''}</span></p>`
          : soon.length ? html`<p class="warn-box rn-banner">${icon('clock')}<span>تنتهي خلال 30 يوماً: ${soon.map((t) => DOC_NAME[t]).join(' · ')}</span></p>` : '')}
      <div class="rn-prog"><div class="rn-prog-h"><span>التقدّم</span><b class="num">${num(p.done_count)} من 5</b></div>${raw(progress(p))}
        ${raw(next ? html`<p class="rn-nextline">الخطوة التالية: <b>${stepName(next.step_no)}</b></p>` : '')}</div>
    </section>
    <ol class="rn-steps">${raw(steps.map(stepHtml).join(''))}</ol>
    <p class="muted small center">النظام للمتابعة والتسجيل فقط، ولا ينفّذ أي إجراء حكومي. تأكيد الخطوة يحدّث التاريخ في بطاقة السيارة وملف المفوّض.</p>`;

  const reload = () => renderPlan(el, id);
  const stepForm = async (s, confirm) => {
    const fields = [];
    if (s.step_no === 2) fields.push({ name: 'result', label: 'نتيجة الفحص', type: 'select', required: confirm, options: Object.entries(RESULT) });
    if (s.step_no === 4) fields.push({ name: 'fines_status', label: 'المخالفات والرسوم وغرامة التأخير', type: 'select', required: confirm, options: Object.entries(FINES) });
    else fields.push({ name: 'new_expiry', label: s.step_no === 1 ? 'تاريخ انتهاء الرخصة الجديد' : 'تاريخ الانتهاء الجديد', type: 'date', help: 'بصيغة YYYY/MM/DD أو من التقويم' });
    fields.push({ name: 'notes', label: 'ملاحظة (اختياري)', type: 'textarea', full: true });
    const d = STEP_DOC[s.step_no] ? doc(STEP_DOC[s.step_no]) : null;
    return openForm({
      title: `${confirm ? 'تأكيد إكمال' : 'تسجيل'}: ${stepName(s.step_no)}`, draft: false,
      submitText: confirm ? 'تأكيد الإكمال' : 'حفظ البيانات',
      intro: confirm
        ? `بعد التأكيد تُعتبر الخطوة مكتملة${STEP_DOC[s.step_no] ? '، ويُحدَّث التاريخ في بطاقة السيارة' + (s.step_no === 1 ? ' وفي ملف المفوّض لكل سياراته' : '') : ''}، وتنتقل الخطة إلى الخطوة التالية.${d?.expiry_date && d.days_left >= 0 && !s.new_expiry ? ' إذا كان التاريخ الحالي ساريًا يمكنك تركه فارغاً.' : ''}`
        : 'تُحفظ البيانات وتبقى الخطوة «بانتظار التأكيد».',
      fields,
      values: { new_expiry: s.new_expiry || '', result: s.result || '', fines_status: s.fines_status || '', notes: s.notes || '' },
      onSubmit: async (val) => {
        if (confirm && s.step_no === 2 && val.result !== 'passed') throw userError('لا تكتمل خطوة الفحص إلا بنتيجة «اجتاز». احفظ النتيجة الحالية بزر «تسجيل البيانات».');
        if (confirm && s.step_no === 1 && val.new_expiry && dl && dl.vehicle_count > 1 && val.new_expiry !== dl.license_expiry
          && !(await confirmBox(`هذا المفوّض مرتبط بـ ${num(dl.vehicle_count)} سيارات، سيتحدث تاريخ رخصته فيها كلها. متابعة؟`, { title: 'تحديث رخصة المفوّض', okText: 'متابعة' }))) throw userError('لم تُؤكَّد الخطوة.');
        const body = { new_expiry: val.new_expiry || null, result: val.result || null, fines_status: val.fines_status || null, notes: val.notes || null };
        return api.rpc('save_renewal_step', { p_plan: p.id, p_step: s.step_no, p_data: body, p_confirm: confirm });
      },
    });
  };
  // onclick (لا addEventListener) حتى لا يتكرر المعالج عند إعادة رسم الصفحة
  el.onclick = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'save' || act === 'confirm') {
      const st = steps.find((x) => x.step_no === Number(b.dataset.step)); if (!st) return;
      const r = await stepForm(st, act === 'confirm');
      if (!r) return;
      if (act === 'confirm') {
        const [after] = await api.get('v_renewal_plans', { select: 'status', id: `eq.${id}` });
        if (after?.status === 'completed') toast(`اكتملت خطة تجديد السيارة ${p.plate_no} ✓`, 'ok');
        else saved(`اكتملت الخطوة: ${stepName(st.step_no)}`);
      } else saved('حُفظت البيانات — بانتظار التأكيد');
      data.invalidate(); reload();
    }
    if (act === 'set-delegate') { if (await setVehicleDelegate(p.vehicle_id, p.delegate_name)) reload(); }
    if (act === 'pdf') {
      const { planReport } = await import('../renewal-plan-report.js');
      try { const r = await planReport(id); toast(r.fallback ? 'افتح نافذة الطباعة واختر «حفظ PDF».' : `تم تنزيل ⁨${r.name}⁩`, 'ok'); } catch (err) { toast(err.message, 'error'); }
    }
    if (act === 'archive') {
      const r = await openForm({
        title: 'حذف الخطة إلى السجل', draft: false, submitText: 'نقل الخطة إلى السجل',
        intro: 'تختفي الخطة من القوائم وتبقى محفوظة مع من حذفها ومتى ولماذا. التواريخ التي أُكّدت في بطاقة السيارة لا تتغير.',
        fields: [{ name: 'reason', label: 'السبب (اختياري)', type: 'textarea', full: true }],
        onSubmit: (val) => api.rpc('archive_renewal_plan', { p_id: id, p_reason: val.reason || null }).then(() => true),
      });
      if (r) { saved('نُقلت الخطة إلى السجل'); location.hash = '#/renewal'; }
    }
  };
}

// تحديد مفوّض سيارة (اسم جديد أو موجود)
export async function setVehicleDelegate(vehicleId, current = '') {
  const names = (await api.get('v_delegates', { select: 'full_name', order: 'full_name' }).catch(() => [])).map((d) => d.full_name);
  const r = await openForm({
    title: 'مفوّض السيارة', draft: false,
    intro: 'اختر مفوّضاً مسجلاً أو اكتب اسماً جديداً؛ الاسم المكرر بكتابة مختلفة يُربط بنفس الملف.',
    fields: [{ name: 'name', label: 'اسم المفوّض', type: 'combo', options: names, required: true, full: true }],
    values: { name: current || '' },
    onSubmit: async (val) => {
      const did = await api.rpc('ensure_delegate', { p_name: val.name });
      const [row] = await api.update('vehicles', { id: `eq.${vehicleId}` }, { delegate_id: did });
      if (!row) throw userError('لم يُحفظ المفوّض.');
      return row;
    },
  });
  if (r) saved('حُفظ مفوّض السيارة');
  return r;
}

// ---------------------------------------------------------------------
// المفوّضون
// ---------------------------------------------------------------------
async function duplicates() { try { return (await api.rpc('delegate_duplicates')) || []; } catch (_) { return []; } }
const REASON = { name: 'نفس الاسم', license: 'نفس رقم الرخصة', mobile: 'نفس الجوال' };

async function delegateForm(d = null) {
  const sens = api.can('view_sensitive');
  const priv = d && sens ? (await api.get('delegate_private', { select: '*', delegate_id: `eq.${d.id}` }).catch(() => []))[0] || {} : {};
  const fields = [
    { name: 'full_name', label: 'اسم المفوّض', required: true, full: true },
    { name: 'license_expiry', label: 'تاريخ انتهاء رخصة القيادة', type: 'date', help: 'بصيغة YYYY/MM/DD أو من التقويم' },
  ];
  if (sens) fields.push({ name: 'license_no', label: 'رقم الرخصة', inputmode: 'numeric', dir: 'ltr', western: true },
    { name: 'mobile', label: 'الجوال', type: 'tel', inputmode: 'tel', dir: 'ltr', western: true, normalize: saMobile, help: 'مثل 0501234567' });
  fields.push({ name: 'notes', label: 'ملاحظة', type: 'textarea', full: true });
  return openForm({
    title: d ? `تعديل ملف المفوّض ${d.code}` : 'مفوّض جديد', draft: false,
    fields, values: d ? { ...d, license_no: priv.license_no || '', mobile: saMobileLocal(priv.mobile) } : {},
    onSubmit: async (val) => {
      const name = val.full_name.replace(/\s+/g, ' ').trim();
      if (!d) {
        const ex = (await api.get('v_delegates', { select: 'id,full_name,code' })).find((x) => normName(x.full_name) === normName(name));
        if (ex && await confirmBox(`يوجد مفوّض بنفس الاسم: ${ex.full_name} (${ex.code}). هل تريد فتح ملفه بدلاً من إنشاء ملف مكرر؟`, { title: 'مفوّض مسجل', okText: 'فتح الملف الموجود', cancelText: 'إنشاء ملف جديد' })) return { id: ex.id };
      }
      if (d && val.license_expiry !== d.license_expiry && d.vehicle_count > 1
        && !(await confirmBox(`هذا المفوّض مرتبط بـ ${num(d.vehicle_count)} سيارات، سيتحدث تاريخ رخصته فيها كلها. متابعة؟`, { title: 'تحديث رخصة المفوّض', okText: 'متابعة' }))) throw userError('لم يُحفظ التعديل.');
      const rec = { full_name: name, license_expiry: val.license_expiry || null, notes: val.notes || null };
      const [row] = d ? await api.update('delegates', { id: `eq.${d.id}` }, rec) : await api.insert('delegates', rec);
      if (!row) throw userError('لم يُحفظ ملف المفوّض.');
      if (sens && (val.license_no || val.mobile || priv.delegate_id)) {
        const pv = { license_no: val.license_no || null, mobile: val.mobile || null };
        if (pv.license_no !== (priv.license_no || null) || pv.mobile !== (priv.mobile || null)) {
          const u = await api.update('delegate_private', { delegate_id: `eq.${row.id}` }, pv);
          if (!u.length) await api.insert('delegate_private', { delegate_id: row.id, ...pv });
        }
      }
      return row;
    },
  });
}

export async function renderDelegates(el, id) {
  if (id) return renderDelegate(el, id);
  const [rows, dups] = await Promise.all([api.get('v_delegates', { select: '*', order: 'full_name' }), duplicates()]);
  const dupIds = new Set(dups.map((x) => x.delegate_id));
  el.innerHTML = html`
    <a class="back" href="#/renewal">${icon('back')}<span>خطط التجديد</span></a>
    <div class="page-head row"><h1>المفوّضون <span class="count num">${num(rows.length)}</span></h1>
      ${raw(api.can('create') ? html`<button class="btn btn-primary" data-act="new">${icon('plus')}<span>مفوّض جديد</span></button>` : '')}</div>
    ${raw(dupIds.size ? html`<p class="warn-box">${icon('alert')}<span><b>يوجد مفوّضون مكررون محتملون (${num(dupIds.size)})</b> — مميّزون بعلامة ⚠️. افتح الملف واختر «دمج».</span></p>` : '')}
    <form class="filters" onsubmit="return false"><label class="grow"><span>بحث</span><input name="q" type="search" placeholder="اسم المفوّض أو رقمه الداخلي"></label></form>
    <div class="rn-list" data-list></div>`;
  const draw = (q = '') => {
    const n = normName(q);
    const list = rows.filter((d) => !n || normName(d.full_name).includes(n) || normName(d.code).includes(n));
    el.querySelector('[data-list]').innerHTML = list.length ? list.map((d) => html`<a class="rn-card" href="#/delegates/${d.id}">
      <span class="rn-card-top"><b>${dupIds.has(d.id) ? '⚠️ ' : ''}${d.full_name}</b> <small class="code">${d.code}</small></span>
      <small>الرخصة: ${raw(d.license_expiry ? html`<span class="num">${date(d.license_expiry)}</span> ` : '')}${raw(licTag(d.license_expiry))}</small>
      <small class="muted">السيارات المرتبطة: <b class="num">${num(d.vehicle_count)}</b></small></a>`).join('') : html`<div class="empty soft"><p>لا يوجد مفوّضون.</p></div>`;
  };
  draw();
  el.querySelector('form.filters').addEventListener('input', (e) => draw(e.target.value));
  // onclick (لا addEventListener) حتى لا يتكرر المعالج عند إعادة رسم الصفحة
  el.onclick = async (e) => {
    if (!e.target.closest('[data-act=new]')) return;
    const r = await delegateForm();
    if (r) { saved(); location.hash = `#/delegates/${r.id}`; }
  };
}

async function renderDelegate(el, id) {
  const [[d], vehicles, plans, dups] = await Promise.all([
    api.get('v_delegates', { select: '*', id: `eq.${id}` }),
    api.get('vehicles', { select: 'id,code,plate_no,op_status,location_status,op_state,op_state_text', delegate_id: `eq.${id}`, deleted_at: 'is.null', order: 'code' }),
    api.get('v_renewal_plans', { select: '*', delegate_id: `eq.${id}`, status: 'eq.active' }),
    duplicates(),
  ]);
  if (!d) { el.innerHTML = html`<div class="empty"><h1>المفوّض غير موجود</h1><a class="btn btn-primary" href="#/delegates">المفوّضون</a></div>`; return; }
  const sens = api.can('view_sensitive');
  const priv = sens ? (await api.get('delegate_private', { select: '*', delegate_id: `eq.${id}` }).catch(() => []))[0] || {} : null;
  const mine = dups.filter((x) => x.delegate_id === id);
  const twins = mine.length ? await api.get('v_delegates', { select: 'id,code,full_name,vehicle_count', id: `in.(${[...new Set(mine.map((x) => x.other_id))].join(',')})` }) : [];
  const canEdit = api.can('edit');
  document.title = `${d.full_name} — المفوّضون`;
  el.innerHTML = html`
    <a class="back" href="#/delegates">${icon('back')}<span>المفوّضون</span></a>
    <div class="page-head row"><h1>${d.full_name} <small class="code">${d.code}</small></h1>
      ${raw(canEdit ? html`<div class="btn-row"><button class="btn" data-act="edit">${icon('edit')}<span>تعديل الملف</span></button>
        ${raw(d.vehicle_count === 0 ? html`<button class="btn btn-danger-soft" data-act="archive">${icon('close')}<span>حذف إلى السجل</span></button>` : '')}</div>` : '')}</div>
    ${raw(twins.length ? html`<div class="warn-box rn-dup">${icon('alert')}<div><b>تنبيه تكرار:</b> يوجد مفوّض مشابه مسجّل أكثر من مرة.
      <ul>${raw(twins.map((t) => html`<li><a href="#/delegates/${t.id}">${t.full_name}</a> <small class="code">${t.code}</small> — ${mine.filter((x) => x.other_id === t.id).map((x) => REASON[x.reason]).join('، ')} · ${num(t.vehicle_count)} سيارة
        ${raw(canEdit ? html`<button class="btn btn-sm" data-merge="${t.id}">دمج في هذا الملف</button>` : '')}</li>`).join(''))}</ul></div></div>` : '')}
    <section class="vcard-sec"><h3>بيانات المفوّض</h3><dl class="dl">
      <div><dt>تاريخ انتهاء رخصة القيادة</dt><dd>${raw(d.license_expiry ? html`<span class="num">${date(d.license_expiry)}</span> ` : '')}${raw(licTag(d.license_expiry))}</dd></div>
      <div><dt>رقم الرخصة</dt><dd>${sens ? raw(html`<span class="num" dir="ltr">${priv.license_no || '—'}</span>`) : raw('<span class="muted">مخفي (يتطلب صلاحية البيانات الحساسة)</span>')}</dd></div>
      <div><dt>الجوال</dt><dd>${sens ? raw(html`<bdi class="num" dir="ltr">${saMobileLocal(priv.mobile) || '—'}</bdi>`) : raw('<span class="muted">مخفي (يتطلب صلاحية البيانات الحساسة)</span>')}</dd></div>
      <div><dt>ملاحظة</dt><dd>${d.notes || '—'}</dd></div></dl>
      <p class="muted small">بيانات المفوّض محفوظة مرة واحدة وتُستخدم في كل سياراته. تجديد الرخصة هنا يكمل الخطوة الأولى في خطط سياراته.</p></section>
    <section class="vcard-sec"><div class="tab-head"><h3>السيارات المرتبطة (${num(vehicles.length)})</h3>
      ${raw(canEdit ? '<button class="btn btn-sm" data-act="link">+ ربط سيارة</button>' : '')}</div>
      ${raw(vehicles.length ? html`<ul class="rn-vlist">${raw(vehicles.map((v) => { const pl = plans.find((x) => x.vehicle_id === v.id); const k = placeOf(v); return html`<li>
        <a href="#/vehicles/${v.id}"><b class="plate">${v.plate_no}</b> <small class="muted">${v.code}</small></a>
        <span class="rn-place"><i class="dot pl-${k}"></i>${placeName(k)}</span>
        ${raw(pl ? html`<a class="rn-mini" href="#/renewal/${pl.id}"><span class="num">${num(pl.done_count)}/5</span> · ${raw(nextText(pl))}</a>`
          : api.can('create') ? html`<button class="btn btn-sm" data-newplan="${v.id}">إنشاء خطة</button>` : '')}
        ${raw(canEdit ? html`<button class="btn btn-sm btn-ghost" data-unlink="${v.id}" aria-label="إلغاء ربط ${v.plate_no}">إلغاء الربط</button>` : '')}</li>`; }).join(''))}</ul>`
        : '<p class="muted pad">لا توجد سيارات مرتبطة بهذا المفوّض.</p>')}</section>`;

  const reload = () => renderDelegate(el, id);
  // onclick (لا addEventListener) حتى لا يتكرر المعالج عند إعادة رسم الصفحة
  el.onclick = async (e) => {
    const m = e.target.closest('[data-merge]');
    if (m) {
      const t = twins.find((x) => x.id === m.dataset.merge);
      if (!(await confirmBox(`سيُدمج «${t.full_name}» (${t.code}) في هذا الملف: تنتقل سياراته (${num(t.vehicle_count)}) إلى «${d.full_name}»، ويُنقل الملف المكرر إلى السجل ولا يُحذف. متابعة؟`, { title: 'دمج المفوّض المكرر', okText: 'دمج' }))) return;
      await api.rpc('merge_delegates', { p_keep: id, p_dup: t.id }); saved('تم الدمج'); data.invalidate(); reload(); return;
    }
    const u = e.target.closest('[data-unlink]');
    if (u) {
      if (!(await confirmBox('سيُلغى ربط هذا المفوّض بالسيارة. بياناته وسجلاته تبقى محفوظة. متابعة؟', { title: 'إلغاء الربط', okText: 'إلغاء الربط' }))) return;
      await api.update('vehicles', { id: `eq.${u.dataset.unlink}` }, { delegate_id: null }); saved(); reload(); return;
    }
    const np = e.target.closest('[data-newplan]'); if (np) { newPlan(np.dataset.newplan); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'edit') { if (await delegateForm(d)) { saved(); reload(); } }
    if (b.dataset.act === 'archive') {
      const r = await openForm({ title: 'حذف المفوّض إلى السجل', draft: false, submitText: 'نقل إلى السجل', intro: 'يختفي من القوائم ويبقى محفوظاً مع السبب.',
        fields: [{ name: 'reason', label: 'السبب (اختياري)', type: 'textarea', full: true }],
        onSubmit: async (val) => (await api.update('delegates', { id: `eq.${id}` }, { deleted_at: new Date().toISOString(), archive_reason: val.reason || null }))[0] });
      if (r) { saved(); location.hash = '#/delegates'; }
    }
    if (b.dataset.act === 'link') {
      await data.lookups();
      const r = await openForm({
        title: `ربط سيارة بالمفوّض ${d.full_name}`, draft: false,
        fields: [{ name: 'vehicle_id', label: 'السيارة', type: 'select', required: true, options: data.vehicleOptions(), full: true }],
        onSubmit: async (val) => {
          const [cur] = await api.get('vehicles', { select: 'delegate_id,authorized_name', id: `eq.${val.vehicle_id}` });
          if (cur?.delegate_id && cur.delegate_id !== id && !(await confirmBox(`هذه السيارة مربوطة بمفوّض آخر (${cur.authorized_name || '—'}). استبداله بـ «${d.full_name}»؟`, { title: 'استبدال المفوّض', okText: 'استبدال' }))) throw userError('لم يُغيَّر الربط.');
          return (await api.update('vehicles', { id: `eq.${val.vehicle_id}` }, { delegate_id: id }))[0];
        },
      });
      if (r) { saved('رُبطت السيارة'); reload(); }
    }
  };
}

// ---------------------------------------------------------------------
// بطاقة السيارة: المفوّض ورخصته (عرض + تعديل من نموذج البطاقة، يتحدث في كل سيارات المفوّض)
// ---------------------------------------------------------------------
// قراءة بيانات المفوّض والخطة لسيارة واحدة؛ null إذا لم تُحدَّث قاعدة البيانات بعد
export async function vehicleRenewalInfo(id) {
  try {
    const [row] = await api.get('vehicles', { select: 'delegate_id', id: `eq.${id}` });
    const did = row?.delegate_id || null;
    const [dl, plans, dups] = await Promise.all([
      did ? api.get('v_delegates', { select: '*', id: `eq.${did}` }).then((r) => r[0] || null) : null,
      api.get('v_renewal_plans', { select: '*', vehicle_id: `eq.${id}`, order: 'created_at.desc' }),
      did ? duplicates() : [],
    ]);
    return { delegate: dl, plan: plans.find((p) => p.status === 'active') || plans[0] || null, dups: dups.filter((x) => x.delegate_id === did) };
  } catch (_) { return null; }
}
// قائمة المفوّضين لاقتراحات نموذج البطاقة؛ null إذا لم تُحدَّث قاعدة البيانات بعد
export const delegateList = () => api.get('v_delegates', { select: 'id,full_name,license_expiry,vehicle_count', order: 'full_name' }).catch(() => null);
export const findDelegate = (list, name) => (list || []).find((d) => normName(d.full_name) === normName(name)) || null;

// قبل حفظ البطاقة: يُسأل المستخدم إذا كان تحديث الرخصة سيشمل سيارات أخرى (إلغاء = لا يُحفظ شيء)
export async function delegateChange(val, v, list) {
  const name = String(val.delegate_name || '').replace(/\s+/g, ' ').trim();
  const exp = val.delegate_license_expiry || null;
  if (!name) return { name: '', exp: null, existing: null };
  const existing = findDelegate(list, name);
  if (existing && exp && exp !== existing.license_expiry) {
    const others = existing.vehicle_count - (v && v.delegate_id === existing.id ? 1 : 0);
    if (others > 0 && !(await confirmBox(`هذا المفوّض مرتبط بـ ${num(existing.vehicle_count + (v && v.delegate_id === existing.id ? 0 : 1))} سيارات، سيتحدث تاريخ رخصته فيها كلها. متابعة؟`, { title: 'تحديث رخصة المفوّض', okText: 'متابعة' }))) {
      throw userError('لم يُحفظ التعديل.');
    }
  }
  return { name, exp, existing };
}
// بعد حفظ البطاقة: ربط المفوّض بالسيارة وتحديث تاريخ رخصته في ملفه
export async function applyDelegateChange(vehicleId, ch, v) {
  if (!ch) return;
  if (!ch.name) { if (v?.delegate_id) await api.update('vehicles', { id: `eq.${vehicleId}` }, { delegate_id: null }); return; }
  const did = ch.existing?.id || await api.rpc('ensure_delegate', { p_name: ch.name });
  if (ch.exp && ch.exp !== (ch.existing?.license_expiry || null)) await api.update('delegates', { id: `eq.${did}` }, { license_expiry: ch.exp });
  if (did !== (v?.delegate_id || null)) await api.update('vehicles', { id: `eq.${vehicleId}` }, { delegate_id: did });
}
