// الوثائق والتنبيهات: كل الوثائق المنتهية والقريبة من الانتهاء وغير المسجلة، مع الفلاتر
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, $, PAGE_ROWS, moreRows, bindMore } from '../ui.js';
import { label, LABELS, num, date, statusText } from '../fmt.js';
import { subject } from './dashboard.js';

const ATTN = ['expired', 'expiring', 'no_date', 'missing', 'not_authorized'];
const st = { company: '', site: '', type: '', show: 'attn' };

export async function renderDocuments(el) {
  await data.lookups();
  const rows = await api.get('v_document_status', { select: '*' });
  const opt = (v, t, cur) => html`<option value="${v}" ${raw(v === cur ? 'selected' : '')}>${t}</option>`;
  const days = await api.get('app_settings', { select: 'value', key: 'eq.doc_alert_days' }).then((r) => r[0]?.value).catch(() => null);

  el.innerHTML = html`
    <div class="page-head"><h1>الوثائق والتنبيهات</h1></div>
    <p class="muted note">التنبيه يبدأ قبل الانتهاء بـ <span class="num">${(days || [90, 60, 30, 7]).join(' و ')}</span> يوماً. الحساب بتاريخ اليوم في السعودية. الوثيقة بلا تاريخ لا تُعدّ سارية.</p>
    <form class="filters wide-filters" onsubmit="return false">
      <label><span>العرض</span><select name="show">${raw(opt('attn', 'ما يحتاج متابعة', st.show))}${raw(opt('all', 'كل الوثائق', st.show))}</select></label>
      <label><span>الشركة</span><select name="company">${raw(opt('', 'الكل', st.company))}${raw(data.companyOptions(false).map(([k, t]) => opt(k, t, st.company)).join(''))}</select></label>
      <label><span>الموقع</span><select name="site">${raw(opt('', 'الكل', st.site))}${raw(data.siteOptions(false).map(([k, t]) => opt(k, t, st.site)).join(''))}</select></label>
      <label><span>نوع الوثيقة</span><select name="type">${raw(opt('', 'الكل', st.type))}${raw(Object.entries(LABELS.doc_type).map(([k, t]) => opt(k, t, st.type)).join(''))}</select></label>
    </form>
    <div class="chips" id="chips"></div>
    <div id="dt"></div>`;

  const pager = { limit: PAGE_ROWS };
  const draw = (keep) => {
    if (!keep) pager.limit = PAGE_ROWS;
    const base = rows.filter((r) => (!st.company || r.company_id === st.company) && (!st.site || r.site_id === st.site) && (!st.type || r.doc_type === st.type));
    const counts = Object.fromEntries(Object.keys(LABELS.doc_status).map((k) => [k, base.filter((r) => r.status === k).length]));
    $('#chips', el).innerHTML = html`${raw(Object.entries(counts).filter(([, n]) => n).map(([k, n]) => html`<span class="chip t-${k}">${label('doc_status', k)} <b class="num">${num(n)}</b></span>`).join(''))}`;
    const list = base.filter((r) => st.show === 'all' || ATTN.includes(r.status))
      .sort((a, b) => ATTN.indexOf(a.status) - ATTN.indexOf(b.status) || (a.days_left ?? 1e9) - (b.days_left ?? 1e9));
    $('#dt', el).innerHTML = list.length ? html`<div class="table-wrap"><table class="rtable">
      <thead><tr><th>السيارة أو الموظف</th><th>الوثيقة</th><th>رقم الوثيقة</th><th>الموقع والشركة</th><th>تاريخ الانتهاء</th><th>المتبقي</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${raw(list.slice(0, pager.limit).map((r) => html`<tr>
        <td data-l="السيارة أو الموظف"><b>${subject(r.subject_label)}</b></td>
        <td data-l="الوثيقة">${label('doc_type', r.doc_type)}</td>
        <td data-l="رقم الوثيقة" class="num">${r.doc_no || '—'}</td>
        <td data-l="الموقع والشركة">${data.siteName(r.site_id)}<small class="muted">${data.companyName(r.company_id)}</small></td>
        <td data-l="تاريخ الانتهاء" class="num">${date(r.expiry_date)}</td>
        <td data-l="المتبقي">${r.days_left == null ? '—' : statusText({ ...r, alert_type: r.doc_type })}${r.alert_level ? raw(html`<small class="muted">تنبيه ${r.alert_level} يوماً</small>`) : ''}</td>
        <td data-l="الحالة"><span class="tag t-${r.status}">${r.doc_type === 'authorization' ? label('auth_status', r.status) : label('doc_status', r.status)}</span></td>
        <td class="act"><a class="btn btn-sm" href="#/${r.owner_type === 'vehicle' ? 'vehicles' : 'employees'}/${r.owner_id}${r.owner_type === 'vehicle' ? (r.doc_type === 'authorization' ? '?tab=auth' : '?tab=docs') : ''}">فتح السجل</a></td>
      </tr>`).join(''))}</tbody></table>${moreRows(Math.min(pager.limit, list.length), list.length)}</div>`
      : html`<div class="empty soft"><p>${st.show === 'attn' ? 'لا توجد وثائق تحتاج متابعة لهذا الاختيار.' : 'لا توجد وثائق.'}</p></div>`;
  };
  draw();
  bindMore($('#dt', el), pager, draw);
  const f = $('form', el);
  f.addEventListener('input', () => { st.show = f.show.value; st.company = f.company.value; st.site = f.site.value; st.type = f.type.value; draw(); });
}
