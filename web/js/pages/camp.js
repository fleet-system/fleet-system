// صيانة سكن العمال وتوريد الطعام
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw } from '../ui.js';
import { label, LABELS, num, money, date, todayISO } from '../fmt.js';
import { openForm, saved, userError } from '../form.js';
import { renderList, archive } from '../listpage.js';
import { attachmentsDialog } from '../attachments.js';

const PAY = Object.entries(LABELS.payment_status);
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const live = (pairs, total) => html`<dl>${raw(pairs.map(([k, v]) => html`<div><dt>${k}</dt><dd class="num">${v}</dd></div>`).join(''))}<div class="big-total"><dt>الإجمالي</dt><dd class="num">${total}</dd></div></dl>`;
const activeSites = () => data.siteOptions(true);

// ملخص: الإجمالي لكل موقع ولكل شركة وللأشهر (مبني على السجلات المعروضة)
function summary(list) {
  const by = (keyFn) => { const m = new Map(); for (const r of list) { const k = keyFn(r); m.set(k, r2((m.get(k) || 0) + Number(r.total || 0))); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const bySite = by((r) => r.site_id), byCo = by((r) => r.company_id), byMonth = by((r) => String(r._date).slice(0, 7)).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const block = (t, rows, name) => html`<div class="sum-block"><h3>${t}</h3><ul>${raw(rows.map(([k, v]) => html`<li><span>${name(k)}</span><b class="num">${money(v)}</b></li>`).join(''))}</ul></div>`;
  return html`<section class="sums">${block('حسب الموقع', bySite, data.siteName)}${block('حسب الشركة', byCo, data.companyName)}${block('حسب الشهر', byMonth, (k) => k.replace('-', '/'))}</section>`;
}

// =====================================================================
// صيانة سكن العمال
// =====================================================================
export async function housingForm(row = null) {
  await data.lookups(true);
  const isNew = !row;
  const rate = data.rateFor(row);
  return openForm({
    title: isNew ? 'إضافة صيانة سكن' : `تعديل ${row.op_no}`,
    intro: isNew ? 'بعد الحفظ يمكنك إرفاق صور الفواتير والمستندات من زر «المرفقات» في القائمة.' : '',
    fields: [
      { name: 'site_id', label: 'الموقع', type: 'select', required: true, options: activeSites(), full: true },
      { name: 'work_date', label: 'تاريخ الصيانة', type: 'date', required: true },
      { name: 'contractor', label: 'اسم المقاول أو المورد' },
      { name: 'description', label: 'وصف أعمال الصيانة', type: 'textarea', required: true, full: true },
      { name: 'invoice_no', label: 'رقم الفاتورة', dir: 'ltr', western: true },
      { name: 'subtotal', label: 'المبلغ قبل الضريبة (ر.س)', type: 'number', decimal: true, required: true, min: 0 },
      { name: 'with_vat', label: data.vatLabel(rate), type: 'checkbox' },
      { name: 'calc', type: 'info' },
      { name: 'payer_company_id', label: 'الجهة التي دفعت الفاتورة', type: 'select', options: data.companyOptions(false) },
      { name: 'payment_status', label: 'حالة السداد', type: 'select', required: true, placeholder: false, options: PAY },
      { name: 'paid_date', label: 'تاريخ السداد', type: 'date' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
    ],
    values: row ? { ...row, with_vat: Number(row.vat_amount) > 0 } : { work_date: todayISO(), payment_status: 'unpaid' },
    onChange(ctx) {
      const v = ctx.values; const vat = v.with_vat ? r2(r2(v.subtotal) * rate) : 0;
      ctx.live('calc', live([['قبل الضريبة', money(r2(v.subtotal))], ['الضريبة', money(vat)]], money(r2(v.subtotal) + vat)));
    },
    onSubmit: async (v) => {
      const { with_vat, ...rec } = v;
      rec.vat_amount = with_vat ? r2(rec.subtotal * rate) : 0;
      rec.company_id = data.siteCompany(rec.site_id);
      if (rec.payment_status === 'paid' && !rec.paid_date) rec.paid_date = todayISO();
      if (isNew) { const [r] = await api.insert('housing_maintenance', rec); return r; }
      return api.update('housing_maintenance', { id: `eq.${row.id}` }, rec);
    },
  });
}

export async function renderHousing(el) {
  await data.lookups(true);
  const rows = (await api.get('housing_maintenance', { select: '*', deleted_at: 'is.null', order: 'work_date.desc' })).map((r) => ({ ...r, _date: r.work_date }));
  renderList({
    el, rows, title: 'صيانة سكن العمال', addLabel: 'إضافة صيانة سكن',
    dateOf: (r) => r.work_date, siteOf: (r) => r.site_id, totalOf: (r) => r.total, summary,
    searchText: (r) => `${r.op_no} ${r.contractor || ''} ${r.description} ${r.invoice_no || ''} ${data.siteName(r.site_id)}`,
    extraFilter: { label: 'السداد', options: PAY, test: (r, x) => r.payment_status === x },
    columns: [
      ['رقم العملية', (r) => raw(html`<span class="code">${r.op_no}</span>`)], ['التاريخ', (r) => date(r.work_date), 'num'],
      ['الموقع والشركة', (r) => raw(html`${data.siteName(r.site_id)}<small class="muted">${data.companyName(r.company_id)}</small>`)],
      ['الوصف', (r) => r.description], ['المقاول', (r) => r.contractor], ['رقم الفاتورة', (r) => r.invoice_no, 'num'],
      ['قبل الضريبة', (r) => money(r.subtotal), 'num'], ['الضريبة', (r) => money(r.vat_amount), 'num'], ['الإجمالي', (r) => money(r.total), 'num'],
      ['السداد', (r) => raw(html`<span class="tag t-pay-${r.payment_status}">${label('payment_status', r.payment_status)}</span>${r.paid_date ? raw(html`<small class="muted num">${date(r.paid_date)}</small>`) : ''}`)],
    ],
    actions: () => [['المرفقات', 'att'], ...(api.can('edit') ? [['تعديل', 'edit'], ['أرشفة', 'archive']] : [])],
    onAdd: async () => { const r = await housingForm(); if (r) { saved(); renderHousing(el); } },
    onAction: async (k, r) => {
      if (k === 'att') await attachmentsDialog({ entity_type: 'housing_maintenance', entity_id: r.id, title: `مرفقات ${r.op_no}` });
      if (k === 'edit' && await housingForm(r)) { saved(); renderHousing(el); }
      if (k === 'archive' && await archive('housing_maintenance', r, `العملية ${r.op_no}`)) renderHousing(el);
    },
    empty: 'لم تُسجَّل أي صيانة سكن بعد.',
  });
}

// =====================================================================
// توريد الطعام
// =====================================================================
export async function foodForm(row = null) {
  await data.lookups(true);
  const isNew = !row;
  const rate = data.rateFor(row);
  return openForm({
    title: isNew ? 'إضافة توريد طعام' : `تعديل ${row.op_no}`,
    intro: isNew ? 'التكلفة تُحسب تلقائياً من الكمية وسعر الوحدة. بعد الحفظ أرفق صورة الفاتورة من زر «المرفقات».' : '',
    fields: [
      { name: 'site_id', label: 'الموقع', type: 'select', required: true, options: activeSites(), full: true },
      { name: 'supply_date', label: 'تاريخ التوريد', type: 'date', required: true },
      { name: 'supplier', label: 'اسم المورد', required: true },
      { name: 'description', label: 'وصف المواد الغذائية', type: 'textarea', required: true, full: true },
      { name: 'quantity', label: 'الكمية', type: 'number', decimal: true, required: true, min: 0.001 },
      { name: 'unit', label: 'وحدة القياس', required: true, help: 'مثل: كرتون، كيس، كيلو، لتر' },
      { name: 'unit_price', label: 'سعر الوحدة (ر.س)', type: 'number', decimal: true, required: true, min: 0 },
      { name: 'with_vat', label: data.vatLabel(rate), type: 'checkbox' },
      { name: 'calc', type: 'info' },
      { name: 'invoice_no', label: 'رقم الفاتورة', dir: 'ltr', western: true },
      { name: 'payer_company_id', label: 'الجهة التي دفعت الفاتورة', type: 'select', options: data.companyOptions(false) },
      { name: 'payment_status', label: 'حالة السداد', type: 'select', required: true, placeholder: false, options: PAY },
      { name: 'paid_date', label: 'تاريخ السداد', type: 'date' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
    ],
    values: row ? { ...row, with_vat: Number(row.vat_amount) > 0 } : { supply_date: todayISO(), payment_status: 'unpaid' },
    onChange(ctx) {
      const v = ctx.values; const sub = r2(Number(v.quantity || 0) * Number(v.unit_price || 0)); const vat = v.with_vat ? r2(sub * rate) : 0;
      ctx.live('calc', live([['الكمية × سعر الوحدة', money(sub)], ['الضريبة', money(vat)]], money(sub + vat)));
    },
    onSubmit: async (v) => {
      const { with_vat, ...rec } = v;
      rec.vat_amount = with_vat ? r2(r2(rec.quantity * rec.unit_price) * rate) : 0;
      rec.company_id = data.siteCompany(rec.site_id);
      if (rec.payment_status === 'paid' && !rec.paid_date) rec.paid_date = todayISO();
      if (isNew) { const [r] = await api.insert('food_supplies', rec); return r; }
      return api.update('food_supplies', { id: `eq.${row.id}` }, rec);
    },
  });
}

export async function renderFood(el) {
  await data.lookups(true);
  const rows = (await api.get('food_supplies', { select: '*', deleted_at: 'is.null', order: 'supply_date.desc' })).map((r) => ({ ...r, _date: r.supply_date }));
  renderList({
    el, rows, title: 'توريد الطعام', addLabel: 'إضافة توريد',
    dateOf: (r) => r.supply_date, siteOf: (r) => r.site_id, totalOf: (r) => r.total, summary,
    searchText: (r) => `${r.op_no} ${r.supplier} ${r.description} ${r.invoice_no || ''} ${data.siteName(r.site_id)}`,
    extraFilter: { label: 'السداد', options: PAY, test: (r, x) => r.payment_status === x },
    columns: [
      ['رقم العملية', (r) => raw(html`<span class="code">${r.op_no}</span>`)], ['التاريخ', (r) => date(r.supply_date), 'num'],
      ['الموقع والشركة', (r) => raw(html`${data.siteName(r.site_id)}<small class="muted">${data.companyName(r.company_id)}</small>`)],
      ['المورد', (r) => r.supplier], ['الوصف', (r) => r.description],
      ['الكمية', (r) => `${num(r.quantity, Number(r.quantity) % 1 ? 2 : 0)} ${r.unit}`, 'num'], ['سعر الوحدة', (r) => money(r.unit_price), 'num'],
      ['الضريبة', (r) => money(r.vat_amount), 'num'], ['الإجمالي', (r) => money(r.total), 'num'],
      ['السداد', (r) => raw(html`<span class="tag t-pay-${r.payment_status}">${label('payment_status', r.payment_status)}</span>`)],
    ],
    actions: () => [['المرفقات', 'att'], ...(api.can('edit') ? [['تعديل', 'edit'], ['أرشفة', 'archive']] : [])],
    onAdd: async () => { const r = await foodForm(); if (r) { saved(); renderFood(el); } },
    onAction: async (k, r) => {
      if (k === 'att') await attachmentsDialog({ entity_type: 'food_supply', entity_id: r.id, title: `مرفقات ${r.op_no}` });
      if (k === 'edit' && await foodForm(r)) { saved(); renderFood(el); }
      if (k === 'archive' && await archive('food_supplies', r, `العملية ${r.op_no}`)) renderFood(el);
    },
    empty: 'لم يُسجَّل أي توريد طعام بعد.',
  });
}
