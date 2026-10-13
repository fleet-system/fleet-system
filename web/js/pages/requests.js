// طلبات الصيانة: إنشاء ← إرسال لاعتماد المشرف ← اعتماد/رفض ← قيد الصيانة ← مكتمل
// تحل محل شاشة «الصيانة الدورية»؛ سجلات الصيانة والفواتير السابقة تبقى كما هي وتُفتح من صفحة «سجل فواتير الصيانة».
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, toast, $ } from '../ui.js';
import { label, LABELS, num, date, dateTime, todayISO, errorText } from '../fmt.js';
import { openForm, confirmBox, saved, userError } from '../form.js';
import { renderList, archive } from '../listpage.js';
import { attachmentsDialog, mountAttachments } from '../attachments.js';
import { maintForm } from './ops.js';

const STATUS = Object.entries(LABELS.mr_status);
const TAG = { new: 't-no_date', pending_supervisor: 't-expiring', approved: 't-valid', in_progress: 't-mr-progress', completed: 't-mr-done', rejected: 't-expired' };
export const mrTag = (s) => html`<span class="tag ${TAG[s] || ''}">${label('mr_status', s)}</span>`;
const OPEN = ['new', 'pending_supervisor'];
const subjectOf = (r) => {
  const v = data.vehicleById(r.vehicle_id);
  return v ? `${v.vehicle_type || 'سيارة'} ${v.code}` : r.equipment_text || '—';
};
const projectOf = (r) => [r.site_id ? data.siteName(r.site_id) : '', r.project_text].filter(Boolean).join(' — ') || '—';
const meterText = (r) => (r.meter_reading == null ? '—' : `${num(r.meter_reading)} ${r.meter_unit === 'hours' ? 'ساعة' : 'كم'}`);
const short = (t, n = 70) => (!t ? '—' : t.length > n ? `${t.slice(0, n)}…` : t);
const needsSql = (e) => /maintenance_requests|relation .* does not exist|schema cache/i.test(String(e?.message || ''));
const sqlNote = html`<div class="empty"><h1>طلبات الصيانة</h1><p>هذه الشاشة تحتاج تحديث قاعدة البيانات أولاً: شغّل ملف <b>0007_maintenance_requests.sql</b> في Supabase ← SQL Editor ثم حدّث الصفحة.</p></div>`;

function vehicleFill(v) {
  if (!v) return {};
  return {
    plate_no: v.plate_no, model: [v.make, v.model, v.manufacture_year].filter(Boolean).join(' '),
    site_id: v.site_id || '', driver_id: v.current_driver_id || '',
    driver_name: v.current_driver_id ? data.employeeName(v.current_driver_id) : '', meter_reading: v.odometer || '', meter_unit: 'km',
  };
}

// ---------------------------------------------------------------------
// النموذج: إضافة / تعديل
// ---------------------------------------------------------------------
export async function requestForm(vehicleId = null, row = null) {
  await data.lookups(true);
  const isNew = !row;
  const st = row?.status || 'new';
  const v0 = data.vehicleById(vehicleId || row?.vehicle_id);
  const head = { name: 'head', type: 'info' };
  let fields;
  if (OPEN.includes(st)) {
    fields = [
      head,
      { type: 'section', label: 'بيانات الطلب' },
      { name: 'site_id', label: 'المشروع', type: 'select', options: data.siteOptions(false), placeholder: '— اختر المشروع —' },
      { name: 'project_text', label: 'تفاصيل المشروع (اكتب أي شيء)' },
      { type: 'section', label: 'بيانات السيارة أو المعدة' },
      { name: 'vehicle_id', label: 'المعدة / السيارة', type: 'select', options: data.vehicleOptions(), placeholder: '— معدة غير مسجلة في النظام —', full: true, help: 'اختيار السيارة يعبّئ اللوحة والموديل والمستخدم والعداد من ملفها، ويمكنك تعديلها.' },
      { name: 'equipment_text', label: 'اسم المعدة (إن لم تكن مسجلة)' },
      { name: 'plate_no', label: 'رقم اللوحة' },
      { name: 'model', label: 'الموديل' },
      { name: 'driver_id', label: 'المستخدم (من الموظفين)', type: 'select', options: data.employeeOptions(), placeholder: '— غير محدد —' },
      { name: 'driver_name', label: 'اسم المستخدم (أو اكتبه)' },
      { name: 'meter_reading', label: 'كيلو متر / الساعة', type: 'number', min: 0 },
      { name: 'meter_unit', label: 'وحدة القراءة', type: 'select', placeholder: false, options: Object.entries(LABELS.meter_unit) },
      { type: 'section', label: 'تفاصيل طلب الصيانة' },
      { name: 'fault', label: 'العطل', type: 'textarea', rows: 4, required: true, full: true },
      { name: 'fault_cause', label: 'سبب العطل', type: 'textarea', rows: 4, full: true },
      { name: 'technician_opinion', label: 'رأي الفني', type: 'textarea', rows: 4, full: true },
      { name: 'site_notes', label: 'ملاحظات الموقع', type: 'textarea', rows: 4, full: true },
      { name: 'last_change_date', label: 'تاريخ آخر تغيير', type: 'date', help: 'تاريخ آخر تغيير أو صيانة مرتبطة بهذا العطل' },
      ...(st === 'new' ? [{ name: 'send', label: 'إرسال الطلب لاعتماد المشرف بعد الحفظ', type: 'checkbox', full: true }] : []),
    ];
  } else if (['approved', 'in_progress'].includes(st)) {
    fields = [head,
      { name: 'technician_opinion', label: 'رأي الفني', type: 'textarea', rows: 5, full: true },
      { name: 'last_change_date', label: 'تاريخ آخر تغيير', type: 'date' },
      { name: 'notes', label: 'ملاحظات إضافية', type: 'textarea', rows: 3, full: true }];
  } else {
    fields = [head, { name: 'notes', label: 'ملاحظات إضافية', type: 'textarea', rows: 3, full: true }];
  }
  const values = isNew ? { vehicle_id: v0?.id || '', meter_unit: 'km', send: true, ...vehicleFill(v0) } : { ...row };
  const headBox = () => html`<dl class="mr-head"><div><dt>التاريخ</dt><dd class="num">${date(row?.request_date || todayISO())}</dd></div>
    <div><dt>رقم الطلب</dt><dd class="num">${row?.request_no || 'يُنشأ تلقائياً عند الحفظ'}</dd></div>
    <div><dt>الحالة</dt><dd>${mrTag(st)}</dd></div></dl>`;
  return openForm({
    title: isNew ? 'طلب صيانة جديد' : `تعديل طلب الصيانة ${row.request_no}`, wide: true, fields, values,
    intro: isNew ? 'يُسجَّل التاريخ ورقم الطلب تلقائياً. بعد الحفظ يمكنك إرفاق صور العطل والفواتير والتقارير من صفحة الطلب.'
      : OPEN.includes(st) ? '' : 'الطلب معتمد: بياناته الأساسية مقفلة كالنموذج الورقي الموقّع. يمكن إضافة رأي الفني والملاحظات فقط.',
    onChange(ctx, name) {
      ctx.live('head', headBox());
      if (name === 'vehicle_id') { const f = vehicleFill(data.vehicleById(ctx.values.vehicle_id)); for (const [k, x] of Object.entries(f)) ctx.set(k, x); }
      if (name === 'driver_id' && ctx.values.driver_id) ctx.set('driver_name', data.employeeName(ctx.values.driver_id));
    },
    onSubmit: async (v) => {
      const { send, head: _h, ...rec } = v;
      for (const k of ['vehicle_id', 'driver_id', 'site_id']) if (k in rec && !rec[k]) rec[k] = null;
      if (OPEN.includes(st) && !rec.vehicle_id && !rec.equipment_text && !rec.plate_no) throw userError('اختر السيارة من القائمة، أو اكتب اسم المعدة أو رقم اللوحة.');
      if (send) rec.status = 'pending_supervisor';
      if (isNew) { const [r] = await api.insert('maintenance_requests', rec); return r; }
      const [r] = await api.update('maintenance_requests', { id: `eq.${row.id}` }, rec);
      return r;
    },
  });
}

// اعتماد أو رفض (مشرف الصيانة + المسؤول المعتمد)
async function decide(row) {
  const me = api.currentUser();
  return openForm({
    title: `اعتماد طلب الصيانة ${row.request_no}`,
    intro: 'يُسجَّل اسم مشرف الصيانة والمعتمد ووقت القرار في الطلب وفي سجل التعديلات. بعد الاعتماد تُقفل بيانات الطلب الأساسية.',
    fields: [
      { name: 'decision', label: 'القرار', type: 'select', required: true, placeholder: false, options: [['approved', 'اعتماد الطلب'], ['rejected', 'رفض الطلب']], full: true },
      { name: 'supervisor_name', label: 'مشرف الصيانة (الاسم والتوقيع)', required: true },
      { name: 'approver_name', label: 'المسؤول المعتمد', required: true },
      { name: 'approval_notes', label: 'ملاحظات الاعتماد / سبب الرفض', type: 'textarea', rows: 3, full: true },
    ],
    values: { decision: 'approved', supervisor_name: row.supervisor_name || me?.full_name || '', approver_name: row.approver_name || me?.full_name || '' },
    submitText: 'تأكيد القرار',
    onSubmit: async (v) => {
      if (v.decision === 'rejected' && !v.approval_notes) throw userError('اكتب سبب رفض الطلب.');
      const [r] = await api.update('maintenance_requests', { id: `eq.${row.id}` }, { status: v.decision, supervisor_name: v.supervisor_name, approver_name: v.approver_name, approval_notes: v.approval_notes || null });
      return r;
    },
  });
}

// ---------------------------------------------------------------------
// القائمة
// ---------------------------------------------------------------------
export async function renderRequests(el, id, params) {
  await data.lookups(true);
  if (id) return renderRequest(el, id, params);
  let rows;
  try { rows = await api.get('maintenance_requests', { select: '*', deleted_at: 'is.null', order: 'request_date.desc,request_no.desc' }); }
  catch (e) { if (needsSql(e)) { el.innerHTML = String(sqlNote); return; } throw e; }
  const open = (r) => { location.hash = `#/requests/${r.id}`; };
  renderList({
    el, rows, title: 'طلبات الصيانة', addLabel: 'طلب صيانة جديد',
    dateOf: (r) => r.request_date, siteOf: (r) => r.site_id,
    searchText: (r) => `${r.request_no} ${r.plate_no || ''} ${r.equipment_text || ''} ${r.model || ''} ${r.project_text || ''} ${r.site_id ? data.siteName(r.site_id) : ''} ${r.driver_name || ''} ${r.fault || ''} ${data.vehicleById(r.vehicle_id)?.code || ''}`,
    extraFilter: { label: 'الحالة', options: STATUS, test: (r, x) => r.status === x },
    summary: (list) => {
      const c = (s) => list.filter((r) => r.status === s).length;
      const waiting = c('new') + c('pending_supervisor'), working = c('approved') + c('in_progress');
      return html`${raw(waiting ? html`<div class="warn-box"><span>${icon('alert')}</span><span><b class="num">${num(waiting)}</b> طلب لم يُعتمد بعد، و<b class="num">${num(working)}</b> طلب معتمد لم يُنجز.</span></div>` : '')}
        <div class="chips">${raw(STATUS.map(([k, t]) => html`<span class="chip ${TAG[k]}">${t} <b class="num">${num(c(k))}</b></span>`).join(''))}</div>
        <p class="muted small"><a href="#/maintenance">سجل فواتير الصيانة السابقة (التكاليف والبنود) ←</a></p>`;
    },
    columns: [
      ['رقم الطلب', (r) => raw(html`<a href="#/requests/${r.id}" class="code strong">${r.request_no}</a>`)],
      ['التاريخ', (r) => date(r.request_date), 'num'],
      ['المشروع', projectOf],
      ['المعدة / السيارة', (r) => raw(html`<b class="plate">${r.plate_no || '—'}</b><small>${subjectOf(r)}</small>`)],
      ['المستخدم', (r) => r.driver_name || '—'],
      ['العطل', (r) => short(r.fault)],
      ['تاريخ آخر تغيير', (r) => date(r.last_change_date), 'num'],
      ['الحالة', (r) => raw(mrTag(r.status))],
    ],
    actions: (r) => [['عرض', 'view', true], ['طباعة', 'print'], ['المرفقات', 'att'], ...(api.can('edit') && r.status !== 'completed' && r.status !== 'rejected' ? [['تعديل', 'edit']] : [])],
    onAdd: async () => { const r = await requestForm(); if (r) { saved(`تم حفظ الطلب ${r.request_no}`); open(r); } },
    onAction: async (k, r) => {
      if (k === 'view') open(r);
      if (k === 'print') location.hash = `#/requests/${r.id}?print=1`;
      if (k === 'att') await attachmentsDialog({ entity_type: 'maintenance_request', entity_id: r.id, title: `مرفقات ${r.request_no}` });
      if (k === 'edit' && await requestForm(null, r)) { saved(); renderRequests(el, null, new URLSearchParams()); }
    },
    empty: 'لا توجد طلبات صيانة بعد. اضغط «طلب صيانة جديد».',
  });
  if (params?.get('new') === '1') {
    history.replaceState(null, '', '#/requests');
    const r = await requestForm(params.get('vehicle') || null);
    if (r) { saved(`تم حفظ الطلب ${r.request_no}`); open(r); }
  }
}

// ---------------------------------------------------------------------
// صفحة الطلب = النموذج الرسمي (نفسه يُطبع) + الإجراءات + المرفقات + سجل السيارة
// ---------------------------------------------------------------------
export function requestSheet(r, company, history = []) {
  const box = (t, v, cls = '') => html`<section class="mr-box ${cls}"><h3>${t}</h3><p>${v || ''}</p></section>`;
  const decided = r.status === 'approved' || r.status === 'in_progress' || r.status === 'completed' || r.status === 'rejected';
  return html`<article class="official mr-sheet">
    <header class="off-head">
      <div><b class="off-company">${company || 'نظام إدارة الأسطول والمواقع الزراعية'}</b><span>${r.site_id ? data.siteName(r.site_id) : ''}</span></div>
      <div class="off-title"><h1>طلب صيانة</h1><span class="off-state mr-state">${label('mr_status', r.status)}</span></div>
      <div class="off-meta"><span>التاريخ: <b class="num">${date(r.request_date)}</b></span><span>رقم الطلب: <b class="num">${r.request_no}</b></span></div>
    </header>
    <table class="off-grid">
      <tbody>
        <tr><th>المشروع</th><td colspan="3">${projectOf(r)}</td></tr>
        <tr><th>المعدة / السيارة</th><td>${subjectOf(r)}</td><th>رقم اللوحة</th><td class="plate">${r.plate_no || '—'}</td></tr>
        <tr><th>الموديل</th><td>${r.model || '—'}</td><th>المستخدم</th><td>${r.driver_name || '—'}</td></tr>
        <tr><th>كيلو متر / الساعة</th><td class="num">${meterText(r)}</td><th>تاريخ آخر تغيير</th><td class="num">${date(r.last_change_date)}</td></tr>
      </tbody>
    </table>
    ${box('العطل', r.fault)}
    ${box('سبب العطل', r.fault_cause)}
    ${box('رأي الفني', r.technician_opinion)}
    ${box('ملاحظات الموقع', r.site_notes)}
    ${raw(r.approval_notes ? String(box(r.status === 'rejected' ? 'سبب الرفض' : 'ملاحظات الاعتماد', r.approval_notes, 'small-box')) : '')}
    <div class="signs mr-signs">
      <div><span>مشرف الصيانة</span><b>${r.supervisor_name || ' '}</b><em> </em><small> </small><i></i><small>الاسم والتوقيع</small></div>
      <div><span>الاعتماد</span><b>${r.approver_name || ' '}</b><em>${decided ? label('mr_status', r.status === 'rejected' ? 'rejected' : 'approved') : 'لم يُعتمد بعد'}</em>
        <small class="num">${r.decided_at ? dateTime(r.decided_at) : ' '}</small><i></i><small>التوقيع والختم</small></div>
    </div>
    ${raw(history.length ? html`<p class="mr-hist num">طلبات سابقة لهذه السيارة: ${raw(history.slice(0, 5).map((h) => html`${h.request_no} (${date(h.request_date)} · ${label('mr_status', h.status)})`).join('، '))}</p>` : '')}
    <footer class="off-foot num">طُبع من نظام إدارة الأسطول والمواقع الزراعية — ${date(todayISO())}</footer>
  </article>`;
}

async function renderRequest(el, id, params) {
  let r;
  try { [r] = await api.get('maintenance_requests', { select: '*', id: `eq.${id}` }); }
  catch (e) { if (needsSql(e)) { el.innerHTML = String(sqlNote); return; } throw e; }
  if (!r) { el.innerHTML = html`<div class="empty"><h1>الطلب غير موجود</h1><a class="btn btn-primary" href="#/requests">طلبات الصيانة</a></div>`; return; }
  const history = r.vehicle_id ? (await api.get('maintenance_requests', { select: 'id,request_no,request_date,status,fault,last_change_date', vehicle_id: `eq.${r.vehicle_id}`, deleted_at: 'is.null', order: 'request_date.desc,request_no.desc' })).filter((h) => h.id !== r.id) : [];
  const company = r.company_id ? data.companyName(r.company_id) : '';
  const canEdit = api.can('edit'), canApprove = api.can('approve_maintenance');
  const btn = (act, t, ic, primary = false) => html`<button class="btn ${primary ? 'btn-primary' : ''}" data-act="${act}">${ic ? icon(ic) : ''}<span>${t}</span></button>`;
  const acts = [];
  if (canEdit && OPEN.includes(r.status)) acts.push(btn('edit', 'تعديل الطلب', 'edit'));
  if (canEdit && r.status === 'new') acts.push(btn('send', 'إرسال للاعتماد', 'shield', true));
  if (canApprove && OPEN.includes(r.status)) acts.push(btn('decide', 'اعتماد أو رفض', 'shield', true));
  if (canEdit && r.status === 'approved') acts.push(btn('start', 'بدء الصيانة', 'wrench', true));
  if (canEdit && ['approved', 'in_progress'].includes(r.status)) acts.push(btn('done', 'تم إنجاز الصيانة', 'wrench', r.status === 'in_progress'), btn('edit', 'رأي الفني والملاحظات', 'edit'));
  if (api.can('create') && r.vehicle_id && ['approved', 'in_progress', 'completed'].includes(r.status) && !r.maintenance_id) acts.push(btn('invoice', 'تسجيل فاتورة الصيانة', 'invoice'));
  el.innerHTML = html`
    <div class="no-print print-bar mr-bar">
      <a class="back" href="#/requests">${icon('back')}<span>طلبات الصيانة</span></a>
      <div class="btn-row">
        ${raw(acts.join(''))}
        ${btn('print', 'طباعة', 'print')}${btn('pdf', 'تصدير PDF', 'doc')}
        ${raw(api.can('create') ? String(btn('new', 'طلب صيانة جديد', 'plus')) : '')}
        ${raw(canEdit && ['new', 'rejected'].includes(r.status) ? String(btn('archive', 'أرشفة', '')) : '')}
      </div>
    </div>
    ${requestSheet(r, company, history)}
    <section class="panel no-print mr-track">
      <div class="tab-head"><h2>متابعة الطلب</h2>${mrTag(r.status)}</div>
      <ol class="mr-steps">
        <li class="done"><b>إنشاء الطلب</b><span class="num">${dateTime(r.created_at)}</span></li>
        <li class="${r.status !== 'new' ? 'done' : ''}"><b>إرسال لاعتماد المشرف</b></li>
        <li class="${r.decided_at ? 'done' : ''} ${r.status === 'rejected' ? 'bad' : ''}"><b>${r.status === 'rejected' ? 'مرفوض' : 'الاعتماد'}</b><span class="num">${r.decided_at ? dateTime(r.decided_at) : ''}</span></li>
        <li class="${r.started_at ? 'done' : ''}"><b>قيد الصيانة</b><span class="num">${r.started_at ? dateTime(r.started_at) : ''}</span></li>
        <li class="${r.completed_at ? 'done' : ''}"><b>مكتمل</b><span class="num">${r.completed_at ? dateTime(r.completed_at) : ''}</span></li>
      </ol>
      ${raw(r.maintenance_id ? html`<p>فاتورة الصيانة المرتبطة: <a href="#/maintenance">عرض في سجل فواتير الصيانة</a></p>` : '')}
      ${raw(r.vehicle_id ? html`<p><a href="#/vehicles/${r.vehicle_id}?tab=maint">فتح ملف السيارة ←</a></p>` : '')}
    </section>
    <section class="panel no-print">
      <div class="tab-head"><h2>صور العطل والفواتير والتقارير</h2></div>
      <div class="att-box"></div>
    </section>
    <section class="panel no-print">
      <div class="tab-head"><h2>سجل طلبات الصيانة السابقة لهذه السيارة</h2><span class="count num">${num(history.length)}</span></div>
      ${raw(!r.vehicle_id ? '<p class="muted pad">الطلب لمعدة غير مسجلة كسيارة في النظام.</p>' : history.length ? html`<div class="table-wrap"><table class="rtable"><thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>العطل</th><th>تاريخ آخر تغيير</th><th>الحالة</th></tr></thead><tbody>
        ${raw(history.map((h) => html`<tr><td data-l="رقم الطلب"><a class="code strong" href="#/requests/${h.id}">${h.request_no}</a></td><td data-l="التاريخ" class="num">${date(h.request_date)}</td><td data-l="العطل">${short(h.fault)}</td><td data-l="تاريخ آخر تغيير" class="num">${date(h.last_change_date)}</td><td data-l="الحالة">${mrTag(h.status)}</td></tr>`).join(''))}
        </tbody></table></div>` : '<p class="muted pad">لا توجد طلبات سابقة لهذه السيارة.</p>')}
    </section>`;

  const reload = () => renderRequest(el, id, new URLSearchParams());
  const setStatus = async (status, msg) => {
    try { await api.update('maintenance_requests', { id: `eq.${r.id}` }, { status }); saved(msg); reload(); }
    catch (e) { toast(errorText(e), 'error'); }
  };
  el.onclick = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'print') window.print();
    if (a === 'pdf') { toast('في نافذة الطباعة اختر «حفظ كـ PDF» (على الآيفون: مشاركة ← حفظ في الملفات).', 'ok'); setTimeout(() => window.print(), 400); }
    if (a === 'edit' && await requestForm(null, r)) { saved(); reload(); }
    if (a === 'send') await setStatus('pending_supervisor', 'أُرسل الطلب لاعتماد المشرف');
    if (a === 'decide' && await decide(r)) { saved('تم تسجيل القرار'); reload(); }
    if (a === 'start') await setStatus('in_progress', 'الطلب الآن قيد الصيانة');
    if (a === 'done' && await confirmBox('تأكيد إنجاز الصيانة؟ بعد الإكمال تُقفل بيانات الطلب، ويمكن تسجيل فاتورة الصيانة وإرفاق صورها.', { title: 'إنجاز الصيانة', okText: 'تم الإنجاز' })) await setStatus('completed', 'اكتملت الصيانة');
    if (a === 'invoice') {
      const m = await maintForm(r.vehicle_id);
      if (m?.id) { await api.update('maintenance_requests', { id: `eq.${r.id}` }, { maintenance_id: m.id }); saved('تم تسجيل الفاتورة وربطها بالطلب'); reload(); }
    }
    if (a === 'new') { const n = await requestForm(r.vehicle_id); if (n) { saved(`تم حفظ الطلب ${n.request_no}`); location.hash = `#/requests/${n.id}`; } }
    if (a === 'archive' && await archive('maintenance_requests', r, `طلب الصيانة ${r.request_no}`)) location.hash = '#/requests';
  };
  // المرفقات تُحمَّل بعد ربط الأزرار حتى لا تعمل الأزرار ببيانات قديمة أثناء التحميل
  await mountAttachments($('.att-box', el), { entity_type: 'maintenance_request', entity_id: r.id, title: `مرفقات ${r.request_no}` });
  if (params?.get('print') === '1') setTimeout(() => window.print(), 300);
}
