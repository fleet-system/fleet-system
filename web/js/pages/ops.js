// تغيير الزيت، الصيانة، الحوادث: النماذج والقوائم
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, toast } from '../ui.js';
import { label, LABELS, km, num, money, date, dateTime, todayISO } from '../fmt.js';
import { openForm, saved, userError } from '../form.js';
import { renderList, archive } from '../listpage.js';
import { attachmentsDialog, uploadOne } from '../attachments.js';
import { companyNames, siteNames } from '../resolve.js';

const PAY = Object.entries(LABELS.payment_status);
const OPST = Object.entries(LABELS.op_status);
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const payerField = { name: 'payer_company_id', label: 'الجهة التي دفعت الفاتورة', type: 'select', options: () => data.companyOptions(false) };
const fld = (f) => ({ ...f, options: typeof f.options === 'function' ? f.options() : f.options });
const vehicleText = (r) => { const v = data.vehicleById(r.vehicle_id); return v ? `${v.plate_no} ${v.code} ${v.vehicle_type || ''}` : ''; };
const vehCell = (r) => raw(html`<a href="#/vehicles/${r.vehicle_id}" class="plate strong">${data.vehicleById(r.vehicle_id)?.plate_no || '—'}</a><small class="code">${data.vehicleById(r.vehicle_id)?.code || ''}</small>`);
const live = (pairs, total) => html`<dl>${raw(pairs.map(([k, v]) => html`<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join(''))}${raw(total ? html`<div class="big-total"><dt>الإجمالي</dt><dd class="num">${total}</dd></div>` : '')}</dl>`;
const payerDefault = (vid) => { const v = data.vehicleById(vid); return v ? (data.siteCompany(v.site_id) || v.owner_company_id) : null; };

// =====================================================================
// تغيير الزيت
// =====================================================================
export async function oilForm(vehicleId, row = null) {
  await data.lookups(true);
  const isNew = !row;
  const fields = [
    { name: 'vehicle_id', label: 'السيارة', type: 'select', required: true, options: data.vehicleOptions(), full: true, readonly: !isNew },
    { name: 'change_date', label: 'تاريخ تغيير الزيت', type: 'date', required: true },
    { name: 'odometer', label: 'قراءة العداد عند التغيير (كم)', type: 'number', required: true, min: 0 },
    { name: 'interval_km', label: 'فترة التغيير (كم)', type: 'number', required: true, min: 500, max: 100000 },
    { name: 'workshop', label: 'اسم الورشة' },
    { name: 'oil_type', label: 'نوع الزيت' },
    { name: 'filter_type', label: 'نوع الفلتر' },
    { type: 'section', label: 'التكاليف (ر.س)' },
    { name: 'oil_cost', label: 'تكلفة الزيت', type: 'number', decimal: true, min: 0 },
    { name: 'filter_cost', label: 'تكلفة الفلتر', type: 'number', decimal: true, min: 0 },
    { name: 'extra_cost', label: 'تكاليف إضافية', type: 'number', decimal: true, min: 0 },
    { name: 'invoice_no', label: 'رقم الفاتورة', dir: 'ltr', western: true },
    { name: 'payer', label: 'الجهة التي دفعت الفاتورة', type: 'combo', options: [...companyNames(), ...siteNames(), 'العهدة'], help: 'اختر أو اكتب أي جهة: شركة، مشروع، مزرعة، عهدة، موظف…' },
    { name: 'payment_status', label: 'حالة السداد', type: 'select', required: true, placeholder: false, options: PAY },
    { name: 'calc', type: 'info' },
    ...(api.can('invoices') ? [{ name: 'invoice_file', label: 'إرفاق صورة الفاتورة', type: 'file', help: 'صورة JPG أو PNG أو ملف PDF حتى 20 ميجابايت. تُحفظ مع هذه العملية وتظهر في زر «الفاتورة».' },
      ...(isNew ? [] : [{ name: 'replace_invoice', label: 'استبدال الفاتورة السابقة (تُؤرشف القديمة ولا تُحذف)', type: 'checkbox', full: true }])] : []),
    { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
  ];
  const v0 = data.vehicleById(vehicleId || row?.vehicle_id);
  return openForm({
    title: isNew ? 'إضافة تغيير زيت' : `تعديل تغيير الزيت ${row.oil_no}`,
    intro: isNew ? 'كل تغيير زيت يُحفظ كسجل جديد ولا تُحذف السجلات السابقة. بعد الحفظ أرفق صورة الفاتورة من زر «المرفقات».' : '',
    fields,
    values: row ? { ...row, payer: row.payer_text || (row.payer_company_id ? data.companyName(row.payer_company_id) : '') }
      : { vehicle_id: vehicleId, change_date: todayISO(), odometer: v0?.odometer || '', interval_km: v0?.oil_interval_km || 10000, payment_status: 'paid', payer: payerDefault(vehicleId) ? data.companyName(payerDefault(vehicleId)) : '' },
    onChange(ctx, name) {
      const v = ctx.values;
      const veh = data.vehicleById(v.vehicle_id);
      if (name === 'vehicle_id' && veh) { ctx.set('odometer', veh.odometer || ''); ctx.set('interval_km', veh.oil_interval_km); if (!v.payer && payerDefault(veh.id)) ctx.set('payer', data.companyName(payerDefault(veh.id))); }
      const next = Number(v.odometer || 0) + Number(v.interval_km || 0);
      const total = r2(v.oil_cost) + r2(v.filter_cost) + r2(v.extra_cost);
      const remain = veh && v.odometer != null ? next - Math.max(veh.odometer || 0, Number(v.odometer)) : null;
      ctx.live('calc', live([
        ['قراءة العداد القادمة', v.odometer != null ? km(next) : '—'],
        ['العداد الحالي للسيارة', veh ? km(veh.odometer) : '—'],
        ['المسافة المتبقية', remain != null ? km(remain) : '—'],
        ['ملاحظة', veh && v.odometer != null && v.odometer < veh.odometer ? 'قراءة أقدم من العداد الحالي: يُسجَّل كسجل سابق' : '—'],
      ], money(total)));
    },
    onSubmit: async (v0) => {
      const { payer, invoice_file: file, replace_invoice: replace, calc, ...v } = v0;
      for (const k of ['oil_cost', 'filter_cost', 'extra_cost']) v[k] = v[k] ?? 0;
      // الجهة الدافعة: شركة مسجلة تُربط بمعرّفها، وأي جهة أخرى تُحفظ نصاً كما كُتبت
      const co = payer ? data.companyOptions(false).find(([, n]) => n.trim() === payer.trim()) : null;
      v.payer_company_id = co ? co[0] : null; v.payer_text = co ? null : payer || null;
      let saved_;
      if (isNew) [saved_] = await api.insert('oil_changes', v);
      else { delete v.vehicle_id; [saved_] = await api.update('oil_changes', { id: `eq.${row.id}` }, v); }
      if (file) {
        try {
          if (replace) {
            const old = await api.get('attachments', { select: 'id', entity_type: 'eq.oil_change', entity_id: `eq.${saved_.id}`, category: 'eq.oil_invoice', deleted_at: 'is.null' });
            for (const a of old) await api.update('attachments', { id: `eq.${a.id}` }, { deleted_at: new Date().toISOString() });
          }
          await uploadOne({ entity_type: 'oil_change', entity_id: saved_.id, file, category: 'oil_invoice', doc_date: v.change_date });
        } catch (e) { toast(`حُفظت العملية لكن تعذر رفع صورة الفاتورة. ارفعها من زر «الفاتورة». (${e.message || e})`, 'error'); }
      }
      return saved_;
    },
  });
}

export async function renderOil(el) {
  await data.lookups(true);
  const [rows, status, inv] = await Promise.all([
    api.get('oil_changes', { select: '*', deleted_at: 'is.null', order: 'change_date.desc' }),
    api.get('v_vehicle_oil_status', { select: '*' }),
    api.get('attachments', { select: 'entity_id', entity_type: 'eq.oil_change', deleted_at: 'is.null' }).catch(() => []),
  ]);
  const invCount = inv.reduce((m, a) => m.set(a.entity_id, (m.get(a.entity_id) || 0) + 1), new Map());
  const st = Object.fromEntries(status.map((s) => [s.vehicle_id, s]));
  const latest = new Set(status.map((s) => s.last_oil_change_id));
  renderList({
    el, rows, title: 'تغيير الزيت', addLabel: 'إضافة تغيير زيت',
    note: 'المسافة المتبقية = القراءة القادمة − العداد الحالي للسيارة. التنبيه عند بقاء 1,000 كم أو أقل.',
    dateOf: (r) => r.change_date, siteOf: (r) => r.site_id, totalOf: (r) => r.total,
    searchText: (r) => `${vehicleText(r)} ${r.oil_no} ${r.workshop || ''} ${r.oil_type || ''} ${r.payer_text || ''} ${r.invoice_no || ''}`,
    extraFilter: { label: 'الحالة', options: Object.entries(LABELS.oil_status).filter(([k]) => k !== 'no_record'), test: (r, x) => latest.has(r.id) && st[r.vehicle_id]?.status === x },
    columns: [
      ['السيارة', vehCell], ['التاريخ', (r) => date(r.change_date), 'num'], ['العداد عند التغيير', (r) => km(r.odometer), 'num'],
      ['القراءة القادمة', (r) => km(r.next_odometer), 'num'],
      ['المتبقي والحالة', (r) => (latest.has(r.id) && st[r.vehicle_id] ? raw(html`<span class="num">${km(st[r.vehicle_id].remaining_km)}</span><small class="tag t-${st[r.vehicle_id].status}">${label('oil_status', st[r.vehicle_id].status)}</small>`) : raw('<small class="muted">سجل سابق</small>'))],
      ['الموقع', (r) => data.siteName(r.site_id)], ['الورشة', (r) => r.workshop], ['الزيت / الفلتر', (r) => [r.oil_type, r.filter_type].filter(Boolean).join(' / ') || '—'],
      ['الإجمالي', (r) => money(r.total), 'num'], ['السداد', (r) => label('payment_status', r.payment_status)],
      ['الجهة الدافعة', (r) => r.payer_text || (r.payer_company_id ? data.companyName(r.payer_company_id) : '—')],
      ['الفاتورة', (r) => (invCount.get(r.id) ? raw(html`<span class="tag t-valid">مرفقة (${invCount.get(r.id)})</span>`) : raw('<span class="muted">—</span>'))],
    ],
    actions: () => [['الفاتورة والمرفقات', 'att'], ...(api.can('edit') ? [['تعديل', 'edit'], ['أرشفة', 'archive']] : [])],
    onAdd: async () => { if (await oilForm(null)) { saved(); renderOil(el); } },
    onAction: async (k, r) => {
      if (k === 'att') await attachmentsDialog({ entity_type: 'oil_change', entity_id: r.id, title: `مرفقات ${r.oil_no}` });
      if (k === 'edit' && await oilForm(null, r)) { saved(); renderOil(el); }
      if (k === 'archive' && await archive('oil_changes', r, `تغيير الزيت ${r.oil_no}`)) renderOil(el);
    },
    empty: 'لم يُسجَّل أي تغيير زيت بعد.',
  });
}

// =====================================================================
// الصيانة
// =====================================================================
export async function maintForm(vehicleId, row = null) {
  await data.lookups(true);
  const isNew = !row;
  const rate = data.rateFor(row);
  let items = [];
  if (!isNew) items = await api.get('maintenance_items', { select: '*', maintenance_id: `eq.${row.id}`, deleted_at: 'is.null', order: 'sort_order' });
  const v0 = data.vehicleById(vehicleId || row?.vehicle_id);
  const fields = [
    { name: 'vehicle_id', label: 'السيارة', type: 'select', required: true, options: data.vehicleOptions(), full: true },
    { name: 'maint_date', label: 'تاريخ الصيانة', type: 'date', required: true },
    { name: 'odometer', label: 'قراءة العداد (كم)', type: 'number', min: 0 },
    { name: 'maint_type', label: 'نوع الصيانة', required: true, help: 'مثل: دورية، فرامل، كهرباء، تكييف، إطارات، محرك' },
    { name: 'workshop', label: 'اسم الورشة' },
    { name: 'fault_description', label: 'وصف العطل', type: 'textarea', full: true },
    { name: 'items', label: 'بنود التكلفة (قطع الغيار وأجور العمل)', type: 'items', required: true },
    { name: 'with_vat', label: data.vatLabel(rate), type: 'checkbox', full: true },
    { name: 'calc', type: 'info' },
    { name: 'invoice_no', label: 'رقم الفاتورة', dir: 'ltr', western: true },
    fld(payerField),
    { name: 'payment_status', label: 'حالة السداد', type: 'select', required: true, placeholder: false, options: PAY },
    { name: 'status_before', label: 'حالة السيارة قبل الصيانة', type: 'select', options: OPST },
    { name: 'status_after', label: 'حالة السيارة بعد الصيانة', type: 'select', options: OPST },
    { name: 'apply_status', label: 'تحديث الحالة التشغيلية للسيارة إلى «الحالة بعد الصيانة»', type: 'checkbox', full: true },
    { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
  ];
  return openForm({
    title: isNew ? 'إضافة صيانة' : `تعديل الصيانة ${row.maint_no}`, wide: true, fields,
    intro: isNew ? 'يمكن إضافة أكثر من بند في العملية نفسها. بعد الحفظ أرفق صور الفاتورة والإصلاح من زر «المرفقات».' : 'تعديل البنود يستبدلها بالبنود الجديدة، والبنود القديمة تبقى في سجل التدقيق.',
    values: row ? { ...row, items, with_vat: Number(row.vat_amount) > 0 } : { vehicle_id: vehicleId, maint_date: todayISO(), odometer: v0?.odometer || '', payment_status: 'unpaid', status_before: v0?.op_status, status_after: 'working', payer_company_id: payerDefault(vehicleId) },
    onChange(ctx, name) {
      const v = ctx.values;
      const veh = data.vehicleById(v.vehicle_id);
      if (name === 'vehicle_id' && veh) { ctx.set('odometer', veh.odometer || ''); ctx.set('status_before', veh.op_status); if (!v.payer_company_id) ctx.set('payer_company_id', payerDefault(veh.id)); }
      const sum = (k) => r2((v.items || []).filter((i) => i.kind === k).reduce((s, i) => s + r2(i.quantity * i.unit_price), 0));
      const sub = sum('part') + sum('labor') + sum('other');
      const vat = v.with_vat ? r2(sub * rate) : 0;
      ctx.live('calc', live([['قطع الغيار', money(sum('part'))], ['أجور العمل', money(sum('labor'))], ['أخرى', money(sum('other'))], ['المبلغ قبل الضريبة', money(sub)], ['الضريبة', money(vat)]], money(sub + vat)));
    },
    onSubmit: async (v) => {
      const { items: its, with_vat, apply_status, calc, ...head } = v;
      const sub = r2(its.reduce((s, i) => s + r2(i.quantity * i.unit_price), 0));
      head.vat_amount = with_vat ? r2(sub * rate) : 0;
      let id;
      if (isNew) { const [r] = await api.insert('maintenance', head); id = r.id; }
      else {
        id = row.id;
        await api.update('maintenance', { id: `eq.${id}` }, head);
        await api.update('maintenance_items', { maintenance_id: `eq.${id}`, deleted_at: 'is.null' }, { deleted_at: new Date().toISOString() });
      }
      for (const it of its) await api.insert('maintenance_items', { ...it, maintenance_id: id });
      if (apply_status && head.status_after) await api.update('vehicles', { id: `eq.${head.vehicle_id}` }, { op_status: head.status_after });
      return { id };
    },
  });
}

export async function renderMaintenance(el) {
  await data.lookups(true);
  const rows = await api.get('maintenance', { select: '*', deleted_at: 'is.null', order: 'maint_date.desc' });
  renderList({
    el, rows, title: 'سجل فواتير الصيانة', addLabel: 'إضافة فاتورة صيانة',
    note: 'تكاليف الصيانة وبنودها. طلبات الصيانة الجديدة واعتمادها من شاشة «طلب صيانة».',
    dateOf: (r) => r.maint_date, siteOf: (r) => r.site_id, totalOf: (r) => r.total,
    searchText: (r) => `${vehicleText(r)} ${r.maint_no} ${r.workshop || ''} ${r.maint_type || ''} ${r.fault_description || ''}`,
    extraFilter: { label: 'السداد', options: PAY, test: (r, x) => r.payment_status === x },
    columns: [
      ['رقم الصيانة', (r) => raw(html`<span class="code">${r.maint_no}</span>`)], ['السيارة', vehCell], ['التاريخ', (r) => date(r.maint_date), 'num'],
      ['النوع', (r) => r.maint_type], ['الورشة', (r) => r.workshop], ['الموقع', (r) => data.siteName(r.site_id)],
      ['قبل الضريبة', (r) => money(r.subtotal), 'num'], ['الضريبة', (r) => money(r.vat_amount), 'num'], ['الإجمالي', (r) => money(r.total), 'num'],
      ['السداد', (r) => raw(html`<span class="tag t-pay-${r.payment_status}">${label('payment_status', r.payment_status)}</span>`)],
    ],
    actions: () => [['المرفقات', 'att'], ...(api.can('edit') ? [['تعديل', 'edit'], ['أرشفة', 'archive']] : [])],
    onAdd: async () => { if (await maintForm(null)) { saved(); renderMaintenance(el); } },
    onAction: async (k, r) => {
      if (k === 'att') await attachmentsDialog({ entity_type: 'maintenance', entity_id: r.id, title: `مرفقات ${r.maint_no}` });
      if (k === 'edit' && await maintForm(null, r)) { saved(); renderMaintenance(el); }
      if (k === 'archive' && await archive('maintenance', r, `الصيانة ${r.maint_no}`)) renderMaintenance(el);
    },
    empty: 'لم تُسجَّل أي صيانة بعد.',
  });
}

// =====================================================================
// الحوادث
// =====================================================================
const ACC = Object.entries(LABELS.accident_status);
export async function accidentForm(vehicleId, row = null) {
  await data.lookups(true);
  const isNew = !row;
  const v0 = data.vehicleById(vehicleId || row?.vehicle_id);
  const fields = [
    { name: 'vehicle_id', label: 'السيارة', type: 'select', required: true, options: data.vehicleOptions(), full: true },
    { name: 'occurred_at', label: 'تاريخ ووقت الحادث', type: 'datetime', required: true },
    { name: 'driver_id', label: 'السائق وقت الحادث', type: 'select', options: data.employeeOptions() },
    { name: 'odometer', label: 'قراءة العداد (كم)', type: 'number', min: 0 },
    { name: 'status', label: 'حالة الحادث', type: 'select', required: true, placeholder: false, options: ACC },
    { name: 'description', label: 'وصف الحادث', type: 'textarea', full: true, required: true },
    { name: 'damages', label: 'الأضرار', type: 'textarea', full: true },
    { type: 'section', label: 'الإصلاح والتكاليف (ر.س)' },
    { name: 'workshop', label: 'اسم الورشة' },
    { name: 'parts_cost', label: 'تكلفة قطع الغيار', type: 'number', decimal: true, min: 0 },
    { name: 'labor_cost', label: 'أجور الإصلاح', type: 'number', decimal: true, min: 0 },
    { name: 'extra_cost', label: 'تكاليف إضافية', type: 'number', decimal: true, min: 0 },
    { name: 'calc', type: 'info' },
    { name: 'repair_start_date', label: 'تاريخ بدء الإصلاح', type: 'date' },
    { name: 'repair_end_date', label: 'تاريخ انتهاء الإصلاح', type: 'date' },
    { name: 'back_to_work_date', label: 'تاريخ عودة السيارة إلى العمل', type: 'date' },
    fld(payerField),
    { name: 'payment_status', label: 'حالة السداد', type: 'select', required: true, placeholder: false, options: PAY },
    { name: 'vehicle_status', label: 'تحديث الحالة التشغيلية للسيارة', type: 'select', placeholder: '— بدون تغيير —', options: OPST },
    { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
  ];
  return openForm({
    title: isNew ? 'تسجيل حادث' : `تحديث الحادث ${row.accident_no}`, wide: true, fields,
    intro: isNew ? 'لا يُحذف الحادث من تاريخ السيارة. بعد الحفظ أرفق صور الأضرار من زوايا متعددة والفواتير من زر «الصور والفواتير».' : 'عند اكتمال الإصلاح اختر الحالة «مكتمل» وحدّث حالة السيارة إلى «تعمل». يبقى سجل الحادث وتكاليفه محفوظاً.',
    values: row ? { ...row } : { vehicle_id: vehicleId, occurred_at: new Date().toISOString(), driver_id: v0?.current_driver_id, odometer: v0?.odometer || '', status: 'new', payment_status: 'unpaid', vehicle_status: 'accident_damaged', payer_company_id: payerDefault(vehicleId) },
    onChange(ctx, name) {
      const v = ctx.values;
      const veh = data.vehicleById(v.vehicle_id);
      if (name === 'vehicle_id' && veh) { ctx.set('driver_id', veh.current_driver_id || ''); ctx.set('odometer', veh.odometer || ''); }
      if (name === 'status' && v.status === 'completed' && !isNew) ctx.set('vehicle_status', 'working');
      ctx.live('calc', live([['قطع الغيار', money(r2(v.parts_cost))], ['أجور الإصلاح', money(r2(v.labor_cost))], ['تكاليف إضافية', money(r2(v.extra_cost))]], money(r2(v.parts_cost) + r2(v.labor_cost) + r2(v.extra_cost))));
    },
    onSubmit: async (v) => {
      const { vehicle_status, calc, ...rec } = v;
      for (const k of ['parts_cost', 'labor_cost', 'extra_cost']) rec[k] = rec[k] ?? 0;
      if (rec.repair_start_date && rec.repair_end_date && rec.repair_end_date < rec.repair_start_date) throw userError('تاريخ انتهاء الإصلاح قبل تاريخ بدئه.');
      let res;
      if (isNew) [res] = await api.insert('accidents', rec);
      else res = await api.update('accidents', { id: `eq.${row.id}` }, rec);
      if (vehicle_status) await api.update('vehicles', { id: `eq.${rec.vehicle_id}` }, { op_status: vehicle_status });
      return res;
    },
  });
}

export async function renderAccidents(el) {
  await data.lookups(true);
  const rows = await api.get('accidents', { select: '*', deleted_at: 'is.null', order: 'occurred_at.desc' });
  renderList({
    el, rows, title: 'الحوادث', addLabel: 'تسجيل حادث',
    dateOf: (r) => dateTime(r.occurred_at).replace(/[⁦⁩]/g, '').slice(0, 10).replaceAll('/', '-'), siteOf: (r) => r.site_id, totalOf: (r) => r.total,
    searchText: (r) => `${vehicleText(r)} ${r.accident_no} ${r.workshop || ''} ${r.description || ''} ${data.employeeName(r.driver_id)}`,
    extraFilter: { label: 'حالة الحادث', options: ACC, test: (r, x) => r.status === x },
    columns: [
      ['رقم الحادث', (r) => raw(html`<span class="code">${r.accident_no}</span>`)], ['السيارة', vehCell], ['التاريخ والوقت', (r) => dateTime(r.occurred_at), 'num'],
      ['السائق', (r) => data.employeeName(r.driver_id)], ['الموقع', (r) => data.siteName(r.site_id)],
      ['الحالة', (r) => raw(html`<span class="tag t-acc-${r.status}">${label('accident_status', r.status)}</span>`)],
      ['الإصلاح', (r) => (r.repair_start_date ? `${date(r.repair_start_date)} ← ${date(r.repair_end_date)}` : '—'), 'num'],
      ['الإجمالي', (r) => money(r.total), 'num'],
    ],
    actions: () => [['الصور والفواتير', 'att'], ...(api.can('edit') ? [['تحديث', 'edit', true], ['أرشفة', 'archive']] : [])],
    onAdd: async () => { if (await accidentForm(null)) { saved(); renderAccidents(el); } },
    onAction: async (k, r) => {
      if (k === 'att') await attachmentsDialog({ entity_type: 'accident', entity_id: r.id, title: `صور وفواتير الحادث ${r.accident_no}` });
      if (k === 'edit' && await accidentForm(null, r)) { saved(); renderAccidents(el); }
      if (k === 'archive' && await archive('accidents', r, `الحادث ${r.accident_no}`)) renderAccidents(el);
    },
    empty: 'لم يُسجَّل أي حادث.',
  });
}
