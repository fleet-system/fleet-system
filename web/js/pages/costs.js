// 1.34: «تكاليف الصيانة»: الصيانة + الزيت + الكفرات + البطاريات من ملف Excel المالك في صفحة واحدة (جدول cost_lines).
// المصدر = ملف Excel (أوراق الصيانة، غيار_الزيت، الكفرات، البطاريات)، يُحدَّث بـ sync_cost_lines (الجديد يُضاف، المعدّل يتحدّث،
// والمحذوف من Excel يُؤرشف ولا يُحذف). كل سجل مربوط بالسيارة بمعرّفها الداخلي.
import * as api from '../api.js';
import { html, raw, icon } from '../ui.js';
import { num, money, date, errorText } from '../fmt.js';
import { readXlsx, serialToDate } from '../xlsx.js';
import { toast } from '../ui.js';

export const COST_CAT = { maintenance: 'الصيانة', oil: 'الزيت', tires: 'الكفرات', batteries: 'البطاريات' };
const CATS = Object.keys(COST_CAT);
const st = { cat: '', site: '', vehicle: '', from: '', to: '', q: '' };

// قراءة أوراق التكاليف من ملف Excel المالك (نفس تحويل tools/excel_costs.py). المفتاح الثابت = اسم الورقة + رقم الصف.
const XL_SHEETS = {
  'الصيانة': ['maintenance', { plate: 1, letters: 2, company: 3, site: 4, brand: 5, user_name: 6, date: 7, invoice_no: 8, order_no: 9, description: 10, amount: 11, payment_status: 14, payment_method: 15, payer: 16, doc_type: 17, attachment_url: 19 }],
  'غيار_الزيت': ['oil', { plate: 1, letters: 2, company: 3, site: 4, brand: 5, user_name: 6, date: 7, odometer: 8, description: 9, invoice_no: 10, amount: 11, notes: 12, payment_status: 13, payment_method: 14, payer: 15, doc_type: 16, attachment_url: 17 }],
  'الكفرات': ['tires', { plate: 1, letters: 2, company: 3, site: 4, brand: 5, user_name: 6, date: 7, description: 8, quantity: 9, supplier: 10, invoice_no: 11, amount: 12, payment_status: 13, payment_method: 14, payer: 15, doc_type: 16, attachment_url: 17, notes: 19 }],
  'البطاريات': ['batteries', { plate: 1, letters: 2, company: 3, site: 4, brand: 5, user_name: 6, date: 7, description: 8, quantity: 9, supplier: 10, invoice_no: 11, amount: 12, payment_status: 13, payment_method: 14, payer: 15, doc_type: 16, attachment_url: 17, notes: 19 }],
};
const txt = (v) => { if (v == null || typeof v === 'boolean') return null; if (typeof v === 'object') v = v.serial; const s = String(v).trim(); return s || null; };
const isoOf = (v) => {
  if (v && typeof v === 'object' && Number.isFinite(v.serial)) return serialToDate(v.serial);
  const s = txt(v); if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
};
export function costRowsFromSheets(sheets) {
  const rows = [], read = [];
  for (const [name, [cat, cols]] of Object.entries(XL_SHEETS)) {
    const sh = sheets.find((x) => x.name === name); if (!sh) continue; read.push(name);
    sh.rows.forEach((arr, i) => {
      if (i === 0) return;
      const g = Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, arr[c - 1] ?? null]));
      if (typeof g.amount !== 'number') return; // صف فارغ أو بدون مبلغ
      const plate = [txt(g.letters), txt(g.plate)].filter(Boolean).join(' ') || null;
      let notes = txt(g.notes);
      if (g.odometer) notes = [`الممشى ${txt(g.odometer)}`, notes].filter(Boolean).join(' | ');
      if (g.order_no) notes = [`رقم الطلب ${txt(g.order_no)}`, notes].filter(Boolean).join(' | ');
      const att = txt(g.attachment_url);
      rows.push({ category: cat, source_sheet: name, source_row: i + 1, plate, company: txt(g.company), site: txt(g.site), brand: txt(g.brand),
        user_name: txt(g.user_name), date: isoOf(g.date), description: txt(g.description), quantity: typeof g.quantity === 'number' ? g.quantity : null,
        supplier: txt(g.supplier), invoice_no: txt(g.invoice_no), amount: Math.round(g.amount * 100) / 100, payment_status: txt(g.payment_status),
        payment_method: txt(g.payment_method), payer: txt(g.payer), doc_type: txt(g.doc_type), attachment_url: att && att.startsWith('http') ? att : null, notes });
    });
  }
  return { rows, sheets: read };
}

const norm = (s) => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
const sum = (rows) => rows.reduce((s, r) => s + Number(r.amount || 0), 0);
function group(rows, key) {
  const m = new Map();
  for (const r of rows) { const k = key(r) || 'غير محدد'; m.set(k, (m.get(k) || 0) + Number(r.amount || 0)); }
  return [...m.entries()].map(([k, v]) => ({ k, v }));
}
function bars(items, { cls = '', limit = 12 } = {}) {
  if (!items.length) return '<p class="muted small">لا توجد بيانات.</p>';
  const max = Math.max(...items.map((i) => i.v), 0) || 1;
  return `<ul class="cost-bars ${cls}">${items.slice(0, limit).map((i) => html`<li><span class="cb-k">${i.k}</span><span class="cb-bar"><i style="width:${Math.max(2, (i.v / max) * 100).toFixed(1)}%"></i></span><b class="num">${num(i.v, 2)}</b></li>`).join('')}</ul>`;
}

export async function renderCosts(el, params = {}) {
  if (params.vehicle !== undefined) st.vehicle = params.vehicle || '';
  if (params.cat !== undefined) st.cat = params.cat || '';
  el.innerHTML = '<div class="loading">جارٍ التحميل…</div>';
  let all;
  try { all = await api.get('cost_lines', { select: '*', is_active: 'is.true', order: 'line_date.desc.nullslast,source_row.desc' }); } catch (e) { el.innerHTML = html`<div class="form-error">${errorText(e)}</div>`; return; }
  const sites = [...new Set(all.map((r) => r.site_name).filter(Boolean))].sort();
  const vehicles = [...new Map(all.filter((r) => r.vehicle_id).map((r) => [r.vehicle_id, r.plate_text])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const lastSync = all.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), '');

  const draw = () => {
    const words = norm(st.q).split(/\s+/).filter(Boolean);
    const rows = all.filter((r) => (!st.cat || r.category === st.cat) && (!st.site || r.site_name === st.site) && (!st.vehicle || r.vehicle_id === st.vehicle)
      && (!st.from || (r.line_date || '') >= st.from) && (!st.to || (r.line_date || '') <= st.to)
      && (!words.length || words.every((w) => norm([r.plate_text, r.description, r.supplier, r.invoice_no, r.user_name, r.notes].join(' ')).includes(w))));
    const total = sum(rows);
    const byCat = CATS.map((c) => ({ c, rows: rows.filter((r) => r.category === c) }));
    const byMonth = group(rows, (r) => (r.line_date || '').slice(0, 7).replace('-', '/')).sort((a, b) => b.k.localeCompare(a.k));
    const bySite = group(rows, (r) => r.site_name).sort((a, b) => b.v - a.v);
    const byVeh = group(rows, (r) => r.plate_text).sort((a, b) => b.v - a.v);
    const opt = (v, t, sel) => html`<option value="${v}" ${raw(v === sel ? 'selected' : '')}>${t}</option>`;
    el.innerHTML = html`
      <div class="page-head">
        <div><h1>تكاليف الصيانة</h1>
        ${raw(api.can('import') || api.can('edit') ? '<label class="btn cost-sync"><input type="file" accept=".xlsx" data-cost-file hidden>تحديث من ملف Excel</label>' : '')}
        <p class="muted small cost-sub">الصيانة والزيت والكفرات والبطاريات من ملف Excel${raw(lastSync ? html` · آخر تحديث <span class="num">${date(lastSync)}</span>` : '')}</p></div>
        <form class="filters" data-cost-filters aria-label="تصفية التكاليف">
          <label><span>النوع</span><select name="cat">${raw(opt('', 'الكل', st.cat))}${raw(CATS.map((c) => opt(c, COST_CAT[c], st.cat)).join(''))}</select></label>
          <label><span>الموقع</span><select name="site">${raw(opt('', 'كل المواقع', st.site))}${raw(sites.map((s) => opt(s, s, st.site)).join(''))}</select></label>
          <label><span>السيارة</span><select name="vehicle">${raw(opt('', 'كل السيارات', st.vehicle))}${raw(vehicles.map(([id, p]) => opt(id, p, st.vehicle)).join(''))}</select></label>
          <label class="sm"><span>من</span><input type="date" name="from" value="${st.from}"></label>
          <label class="sm"><span>إلى</span><input type="date" name="to" value="${st.to}"></label>
          <label><span>بحث</span><input type="search" name="q" value="${st.q}" placeholder="لوحة، بيان، مورد، فاتورة"></label>
        </form>
      </div>
      <section class="cost-kpis" data-cost-kpis>
        <button type="button" class="panel cost-kpi total ${raw(st.cat ? '' : 'on')}" data-cat=""><span>الإجمالي</span><b class="num" data-cost-total>${num(total, 2)}</b><small>ر.س · <span class="num">${rows.length}</span> سجل</small></button>
        ${raw(byCat.map(({ c, rows: rr }) => html`<button type="button" class="panel cost-kpi k-${c} ${raw(st.cat === c ? 'on' : '')}" data-cat="${c}"><span>${COST_CAT[c]}</span><b class="num" data-cost-cat="${c}">${num(sum(rr), 2)}</b><small>ر.س · <span class="num">${rr.length}</span> سجل</small></button>`).join(''))}
      </section>
      <div class="panels cost-panels">
        <section class="panel"><header><h2>حسب الشهر</h2></header>${raw(bars(byMonth, { limit: 24 }))}</section>
        <section class="panel"><header><h2>حسب الموقع</h2></header>${raw(bars(bySite))}</section>
        <section class="panel"><header><h2>أعلى السيارات تكلفة</h2></header>${raw(bars(byVeh, { limit: 10 }))}</section>
      </div>
      <section class="panel cost-list">
        <header><h2>كل الفواتير</h2><span class="count num">${rows.length}</span></header>
        ${raw(rows.length ? html`<div class="table-wrap"><table class="log"><thead><tr><th>التاريخ</th><th>النوع</th><th>السيارة</th><th>البيان</th><th>المورد</th><th>رقم الفاتورة</th><th>الدفع</th><th>المبلغ</th></tr></thead><tbody>
          ${raw(rows.map((r) => html`<tr data-cost-row="${r.category}"><td class="num">${date(r.line_date)}</td><td><span class="tag cat-${r.category}">${COST_CAT[r.category]}</span></td>
            <td>${raw(r.vehicle_id ? html`<a href="#/vehicles/${r.vehicle_id}?tab=costs" class="plate">${r.plate_text}</a>` : html`<span class="plate">${r.plate_text || '—'}</span>`)}</td>
            <td>${r.description || '—'}${raw(r.quantity ? html` <span class="muted small">×<span class="num">${num(r.quantity)}</span></span>` : '')}</td><td>${r.supplier || '—'}</td>
            <td class="num">${r.invoice_no || '—'}${raw(r.attachment_url ? html` <a href="${r.attachment_url}" target="_blank" rel="noopener" aria-label="المرفق">${icon('invoice')}</a>` : '')}</td>
            <td>${r.payment_status || '—'}</td><td class="num strong">${num(r.amount, 2)}</td></tr>`).join(''))}
          </tbody><tfoot><tr><td colspan="7">الإجمالي</td><td class="num strong">${money(total)}</td></tr></tfoot></table></div>` : '<p class="muted pad">لا توجد تكاليف بهذه التصفية.</p>')}
      </section>`;
  };
  draw();
  el.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-cost-file]')) return;
    const file = e.target.files[0]; if (!file) return;
    try {
      const { rows, sheets } = costRowsFromSheets(await readXlsx(file));
      if (!sheets.length) { toast('الملف لا يحتوي أوراق الصيانة أو الزيت أو الكفرات أو البطاريات', 'error'); return; }
      const r = await api.rpc('sync_cost_lines', { p_rows: rows, p_sheets: `{${sheets.map((x) => `"${x}"`).join(',')}}` }) // مصفوفة نصوص بصيغة Postgres;
      toast(`تم التحديث من Excel: جديد ${r.new}، معدّل ${r.updated}، بدون تغيير ${r.unchanged}${r.archived ? `، مؤرشف ${r.archived}` : ''}`);
      const fresh = el.cloneNode(false); el.replaceWith(fresh); await renderCosts(fresh); // عنصر جديد حتى لا تتكرر المستمعات
    } catch (err) { toast(errorText(err), 'error'); }
  });
  el.addEventListener('change', (e) => { const f = e.target.closest('[data-cost-filters]'); if (!f) return; st[e.target.name] = e.target.value; draw(); });
  el.addEventListener('input', (e) => { if (e.target.name !== 'q') return; st.q = e.target.value; const pos = e.target.selectionStart; draw(); const q = el.querySelector('input[name=q]'); q.focus(); try { q.setSelectionRange(pos, pos); } catch { /* */ } });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b || !b.closest('[data-cost-kpis]')) return; st.cat = st.cat === b.dataset.cat ? '' : b.dataset.cat; draw(); });
}
