// نماذج استلام وتسليم السيارات: مسودة ← اعتماد (ينقل المسؤولية) ← طباعة رسمية
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon } from '../ui.js';
import { label, km, date, dateTime, todayISO } from '../fmt.js';
import { openForm, confirmBox, saved, userError } from '../form.js';
import { renderList, archive } from '../listpage.js';
import { attachmentsDialog } from '../attachments.js';

const KIND = [['deliver', 'تسليم السيارة إلى موظف'], ['receive', 'استلام السيارة من موظف (إعادتها للشركة)']];
const FUEL = [['empty', 'فارغ'], ['quarter', 'ربع'], ['half', 'نصف'], ['three_quarters', 'ثلاثة أرباع'], ['full', 'ممتلئ']];
const fuelText = (k) => (FUEL.find(([x]) => x === k) || [, '—'])[1];
const kindShort = (k) => (k === 'receive' ? 'استلام' : 'تسليم');
const STATE = { draft: 'مسودة', approved: 'معتمد', cancelled: 'ملغى' };

export async function handoverForm(vehicleId, row = null) {
  await data.lookups(true);
  const isNew = !row;
  const v0 = data.vehicleById(vehicleId || row?.vehicle_id);
  const fields = [
    { name: 'kind', label: 'نوع العملية', type: 'select', required: true, placeholder: false, options: KIND, full: true },
    { name: 'vehicle_id', label: 'السيارة', type: 'select', required: true, options: data.vehicleOptions(), full: true },
    { name: 'from_employee_id', label: 'الموظف المسلِّم', type: 'select', options: data.employeeOptions(), placeholder: '— الشركة —' },
    { name: 'to_employee_id', label: 'الموظف المستلِم', type: 'select', options: data.employeeOptions(), placeholder: '— الشركة —' },
    { name: 'occurred_at', label: 'تاريخ ووقت العملية', type: 'datetime', required: true },
    { name: 'odometer', label: 'قراءة العداد (كم)', type: 'number', required: true, min: 0 },
    { name: 'fuel_level', label: 'مستوى الوقود', type: 'select', options: FUEL },
    { type: 'section', label: 'حالة السيارة' },
    { name: 'body_condition', label: 'حالة الهيكل' },
    { name: 'tires_condition', label: 'حالة الإطارات' },
    { name: 'lights_condition', label: 'حالة الأنوار' },
    { name: 'ac_condition', label: 'حالة المكيف' },
    { name: 'tools_equipment', label: 'الأدوات والمعدات الموجودة', type: 'textarea', full: true },
    { name: 'prior_damages', label: 'الأضرار الموجودة مسبقاً', type: 'textarea', full: true },
    { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
    { name: 'approve', label: 'اعتماد النموذج الآن (ينقل مسؤولية السيارة إلى المستلِم فوراً)', type: 'checkbox', full: true },
  ];
  return openForm({
    title: isNew ? 'نموذج استلام أو تسليم' : `تعديل المسودة ${row.form_no}`, wide: true, fields,
    intro: 'النموذج المعتمد لا يمكن تعديله. اتركه «مسودة» إذا أردت مراجعته قبل الاعتماد. بعد الحفظ أرفق صور السيارة قبل وبعد والنموذج الورقي الموقّع من زر «الصور».',
    values: row ? { ...row, approve: false } : { kind: 'deliver', vehicle_id: vehicleId, from_employee_id: v0?.current_driver_id, occurred_at: new Date().toISOString(), odometer: v0?.odometer || '', approve: true },
    onChange(ctx, name) {
      const v = ctx.values; const veh = data.vehicleById(v.vehicle_id);
      if (name === 'vehicle_id' && veh) { ctx.set('from_employee_id', veh.current_driver_id || ''); ctx.set('odometer', veh.odometer || ''); }
      if (name === 'kind' && v.kind === 'receive') ctx.set('to_employee_id', '');
    },
    onSubmit: async (v) => {
      const { approve, ...rec } = v;
      if (rec.kind === 'deliver' && !rec.to_employee_id) throw userError('اختر الموظف المستلِم في عملية التسليم.');
      if (rec.kind === 'receive' && !rec.from_employee_id) throw userError('اختر الموظف المسلِّم الذي يعيد السيارة.');
      if (rec.from_employee_id && rec.from_employee_id === rec.to_employee_id) throw userError('المسلِّم والمستلِم نفس الشخص.');
      if (rec.kind === 'receive') rec.to_employee_id = null;
      const veh = data.vehicleById(rec.vehicle_id);
      rec.site_id = veh?.site_id || null;
      rec.company_id = data.siteCompany(rec.site_id);
      if (approve) rec.state = 'approved';
      if (isNew) { const [r] = await api.insert('handovers', rec); return r; }
      const [r] = await api.update('handovers', { id: `eq.${row.id}` }, rec);
      return r;
    },
  });
}

export async function approveHandover(row) {
  const ok = await confirmBox(`اعتماد النموذج <b class="num">${row.form_no}</b> ينقل مسؤولية السيارة إلى <b>${row.to_employee_id ? data.employeeName(row.to_employee_id) : 'الشركة'}</b> ويُقفل النموذج نهائياً. هل تريد الاعتماد؟`, { title: 'اعتماد النموذج', okText: 'اعتماد' });
  if (!ok) return false;
  await api.update('handovers', { id: `eq.${row.id}` }, { state: 'approved' });
  saved(`تم اعتماد ${row.form_no}`);
  return true;
}

export async function renderHandovers(el, id, params) {
  await data.lookups(true);
  if (id && params.get('print') === '1') return renderPrint(el, id);
  const rows = await api.get('handovers', { select: '*', deleted_at: 'is.null', order: 'occurred_at.desc' });
  renderList({
    el, rows, title: 'استلام وتسليم السيارات', addLabel: 'نموذج جديد',
    note: 'عند اعتماد نموذج تسليم يصبح المستلِم هو المسؤول الحالي عن السيارة، وتُغلق فترة المسؤول السابق وتبقى في السجل.',
    dateOf: (r) => dateTime(r.occurred_at).replace(/[⁦⁩]/g, '').slice(0, 10).replaceAll('/', '-'), siteOf: (r) => r.site_id,
    searchText: (r) => `${data.vehicleLabel(r.vehicle_id)} ${r.form_no} ${data.employeeName(r.from_employee_id)} ${data.employeeName(r.to_employee_id)}`,
    extraFilter: { label: 'الحالة', options: Object.entries(STATE), test: (r, x) => r.state === x },
    columns: [
      ['رقم النموذج', (r) => raw(html`<span class="code">${r.form_no}</span>`)], ['النوع', (r) => kindShort(r.kind)],
      ['السيارة', (r) => raw(html`<a class="plate strong" href="#/vehicles/${r.vehicle_id}">${data.vehicleById(r.vehicle_id)?.plate_no || '—'}</a>`)],
      ['المسلِّم', (r) => (r.from_employee_id ? data.employeeName(r.from_employee_id) : 'الشركة')], ['المستلِم', (r) => (r.to_employee_id ? data.employeeName(r.to_employee_id) : 'الشركة')],
      ['التاريخ والوقت', (r) => dateTime(r.occurred_at), 'num'], ['العداد', (r) => km(r.odometer), 'num'],
      ['الحالة', (r) => raw(html`<span class="tag t-ho-${r.state}">${STATE[r.state]}</span>`)],
    ],
    actions: (r) => [
      ['طباعة', 'print'], ['الصور', 'att'],
      ...(r.state === 'draft' && api.can('edit') ? [['اعتماد', 'approve', true], ['تعديل', 'edit'], ['إلغاء', 'cancel']] : []),
    ],
    onAdd: async () => { if (await handoverForm(null)) { saved(); renderHandovers(el, null, new URLSearchParams()); } },
    onAction: async (k, r) => {
      if (k === 'att') { await attachmentsDialog({ entity_type: 'handover', entity_id: r.id, title: `صور ${r.form_no} والنموذج الموقّع` }); return; }
      if (k === 'print') { location.hash = `#/handovers/${r.id}?print=1`; return; }
      if (k === 'approve' && await approveHandover(r)) renderHandovers(el, null, new URLSearchParams());
      if (k === 'edit' && await handoverForm(null, r)) { saved(); renderHandovers(el, null, new URLSearchParams()); }
      if (k === 'cancel' && await confirmBox(`إلغاء المسودة ${r.form_no}؟ يبقى النموذج محفوظاً بحالة «ملغى».`, { okText: 'إلغاء المسودة', danger: true })) {
        await api.update('handovers', { id: `eq.${r.id}` }, { state: 'cancelled' }); saved('تم الإلغاء'); renderHandovers(el, null, new URLSearchParams());
      }
    },
    empty: 'لا توجد نماذج استلام أو تسليم بعد.',
  });
}

// ---------------------------------------------------------------------
// النموذج الرسمي للطباعة / الحفظ PDF
// ---------------------------------------------------------------------
async function renderPrint(el, id) {
  const [h] = await api.get('handovers', { select: '*', id: `eq.${id}` });
  if (!h) { el.innerHTML = html`<div class="empty"><h1>النموذج غير موجود</h1></div>`; return; }
  const [v] = await api.get('v_vehicles_overview', { select: '*', id: `eq.${h.vehicle_id}` });
  const row = (k, val) => html`<tr><th>${k}</th><td>${val || '—'}</td></tr>`;
  el.innerHTML = html`
    <div class="no-print print-bar"><a class="back" href="#/handovers">${icon('back')}<span>النماذج</span></a>
      <button class="btn btn-primary" onclick="window.print()">${icon('print')}<span>طباعة / حفظ PDF</span></button></div>
    <article class="official">
      <header class="off-head">
        <div><b class="off-company">${data.companyName(h.company_id)}</b><span>${data.siteName(h.site_id)}</span></div>
        <div class="off-title"><h1>نموذج ${kindShort(h.kind)} سيارة</h1>${raw(h.state !== 'approved' ? html`<span class="off-state">${STATE[h.state]} — غير معتمد</span>` : '')}</div>
        <div class="off-meta"><span>رقم النموذج: <b class="num">${h.form_no}</b></span><span>التاريخ: <b class="num">${dateTime(h.occurred_at)}</b></span></div>
      </header>
      <h2>بيانات السيارة</h2>
      <table class="off-table">
        ${row('رقم اللوحة', v?.plate_no)}${row('الرقم الداخلي', v?.code)}${row('النوع والموديل', [v?.vehicle_type, v?.make, v?.model, v?.manufacture_year].filter(Boolean).join(' '))}
        ${row('الشركة المالكة', v?.owner_company_name)}${row('قراءة العداد', km(h.odometer))}${row('مستوى الوقود', fuelText(h.fuel_level))}
      </table>
      <h2>الأطراف</h2>
      <table class="off-table">
        ${row('نوع العملية', h.kind === 'receive' ? 'استلام السيارة من موظف' : 'تسليم السيارة إلى موظف')}
        ${row('الموظف المسلِّم', h.from_employee_id ? data.employeeName(h.from_employee_id) : 'الشركة')}
        ${row('الموظف المستلِم', h.to_employee_id ? data.employeeName(h.to_employee_id) : 'الشركة')}
      </table>
      <h2>حالة السيارة</h2>
      <table class="off-table">
        ${row('الهيكل', h.body_condition)}${row('الإطارات', h.tires_condition)}${row('الأنوار', h.lights_condition)}${row('المكيف', h.ac_condition)}
        ${row('الأدوات والمعدات', h.tools_equipment)}${row('الأضرار الموجودة مسبقاً', h.prior_damages)}${row('ملاحظات', h.notes)}
      </table>
      <div class="signs">
        <div><span>توقيع المسلِّم</span><b>${h.from_employee_id ? data.employeeName(h.from_employee_id) : ''}</b><i></i></div>
        <div><span>توقيع المستلِم</span><b>${h.to_employee_id ? data.employeeName(h.to_employee_id) : ''}</b><i></i></div>
        <div><span>اعتماد الإدارة</span><b class="num">${h.approved_at ? dateTime(h.approved_at) : ''}</b><i></i></div>
      </div>
      <footer class="off-foot num">طُبع من نظام إدارة الأسطول والمواقع الزراعية — ${date(todayISO())}</footer>
    </article>`;
}
