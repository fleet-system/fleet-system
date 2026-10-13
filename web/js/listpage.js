// صفحة قائمة عامة: فلاتر (بحث، موقع، شهر، سنة)، جدول، إجمالي، أزرار للسجلات
import * as api from './api.js';
import * as data from './data.js';
import { html, raw, icon, $, PAGE_ROWS, moreRows, bindMore } from './ui.js';
import { num, money, todayParts } from './fmt.js';
import { confirmBox, saved } from './form.js';

/**
 * opts: { el, title, rows, dateOf(row)->'YYYY-MM-DD', searchText(row), siteOf(row), columns:[[label, fn(row), cls?]],
 *         totalOf(row)?, addLabel?, onAdd?, actions(row)->[[label, key, primary?]], onAction(key,row), extraFilter?{label,options,test}, empty }
 */
export function renderList(opts) {
  const { el } = opts;
  const st = (renderList.state[opts.title] ||= { q: '', site: '', year: '', month: '', extra: '' });
  const { y } = todayParts();
  const years = [...new Set([y, ...opts.rows.map((r) => Number(String(opts.dateOf(r) || '').slice(0, 4))).filter(Boolean)])].sort((a, b) => b - a);
  const opt = (v, t, cur) => html`<option value="${v}" ${raw(String(v) === String(cur) ? 'selected' : '')}>${t}</option>`;
  el.innerHTML = html`
    <div class="page-head row"><h1>${opts.title} <span class="count num">${num(opts.rows.length)}</span></h1>
      ${raw(opts.onAdd && api.can('create') ? html`<button class="btn btn-primary" data-list-add>${icon('plus')}<span>${opts.addLabel}</span></button>` : '')}</div>
    ${raw(opts.note ? html`<p class="muted note">${opts.note}</p>` : '')}
    <form class="filters wide-filters" onsubmit="return false">
      <label class="grow"><span>بحث</span><input name="q" type="search" value="${st.q}" placeholder="رقم اللوحة، الرقم الداخلي، الورشة، الوصف"></label>
      <label><span>الموقع</span><select name="site">${raw(opt('', 'الكل', st.site))}${raw(data.siteOptions(false).map(([k, t]) => opt(k, t, st.site)).join(''))}</select></label>
      <label><span>الشهر</span><select name="month" class="num">${raw(opt('', 'الكل', st.month))}${raw(Array.from({ length: 12 }, (_, i) => opt(i + 1, String(i + 1).padStart(2, '0'), st.month)).join(''))}</select></label>
      <label><span>السنة</span><select name="year" class="num">${raw(opt('', 'الكل', st.year))}${raw(years.map((v) => opt(v, v, st.year)).join(''))}</select></label>
      ${raw(opts.extraFilter ? html`<label><span>${opts.extraFilter.label}</span><select name="extra">${raw(opt('', 'الكل', st.extra))}${raw(opts.extraFilter.options.map(([k, t]) => opt(k, t, st.extra)).join(''))}</select></label>` : '')}
    </form>
    <div class="list-total" hidden></div>
    <div class="list-summary"></div>
    <div class="list-body"></div>`;

  const pager = { limit: PAGE_ROWS };
  const draw = (keep) => {
    if (!keep) pager.limit = PAGE_ROWS;
    const q = st.q.trim().toLowerCase();
    const list = opts.rows.filter((r) => {
      const d = String(opts.dateOf(r) || '');
      return (!st.site || opts.siteOf(r) === st.site) &&
        (!st.year || d.slice(0, 4) === String(st.year)) &&
        (!st.month || Number(d.slice(5, 7)) === Number(st.month)) &&
        (!st.extra || opts.extraFilter.test(r, st.extra)) &&
        (!q || opts.searchText(r).toLowerCase().includes(q));
    });
    const tot = $('.list-total', el);
    if (opts.totalOf) {
      tot.hidden = false;
      tot.innerHTML = html`<span>${num(list.length)} سجل</span><b class="num">الإجمالي: ${money(list.reduce((s, r) => s + Number(opts.totalOf(r) || 0), 0))}</b>`;
    }
    if (opts.summary) $('.list-summary', el).innerHTML = list.length ? String(opts.summary(list)) : '';
    $('.list-body', el).innerHTML = list.length ? html`<div class="table-wrap"><table class="rtable">
      <thead><tr>${raw(opts.columns.map(([t]) => html`<th>${t}</th>`).join(''))}<th><span class="sr">إجراءات</span></th></tr></thead>
      <tbody>${raw(list.slice(0, pager.limit).map((r) => html`<tr>${raw(opts.columns.map(([t, fn, cls]) => html`<td data-l="${t}" class="${cls || ''}">${fn(r) ?? '—'}</td>`).join(''))}
        <td class="act">${raw((opts.actions ? opts.actions(r) : []).map(([t, k, primary]) => html`<button class="btn btn-sm ${primary ? 'btn-primary' : ''}" data-row-act="${k}" data-id="${r.id}">${t}</button>`).join(''))}</td></tr>`).join(''))}</tbody></table>${moreRows(Math.min(pager.limit, list.length), list.length)}</div>`
      : html`<div class="empty soft"><p>${opts.rows.length ? 'لا توجد سجلات مطابقة للفلاتر.' : opts.empty}</p></div>`;
  };
  draw();
  bindMore($('.list-body', el), pager, draw);
  const f = $('form', el);
  f.addEventListener('input', () => { st.q = f.q.value; st.site = f.site.value; st.month = f.month.value; st.year = f.year.value; st.extra = f.extra ? f.extra.value : ''; draw(); });
  el.onclick = async (e) => {
    if (e.target.closest('[data-list-add]')) { await opts.onAdd(); return; }
    const b = e.target.closest('[data-row-act]'); if (!b) return;
    const row = opts.rows.find((r) => r.id === b.dataset.id);
    await opts.onAction(b.dataset.rowAct, row);
  };
}
renderList.state = {};

// أرشفة سجل (بدل الحذف) مع تأكيد
export async function archive(table, row, what) {
  const ok = await confirmBox(`سيُخفى ${what} من القوائم والتقارير، لكنه يبقى محفوظاً في سجل التدقيق ويمكن للمسؤول استعادته. هل تريد المتابعة؟`, { title: 'أرشفة السجل', okText: 'أرشفة', danger: true });
  if (!ok) return false;
  await api.update(table, { id: `eq.${row.id}` }, { deleted_at: new Date().toISOString() });
  saved('تمت الأرشفة');
  return true;
}
