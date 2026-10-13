// الإعدادات ← إدارة طلبات الصيانة: حذف الطلب إلى السجل (لا يُمسح شيء) واسترجاعه
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, $ } from '../ui.js';
import { date, dateTime, num, parseDate } from '../fmt.js';
import { mrTag, archiveRequest, restoreRequest } from './requests.js';

const st = { q: '', from: '', to: '' };
const day = (x) => { try { return x ? parseDate(x) : ''; } catch (_) { return ''; } };
const subject = (r) => [r.vehicle_code, r.plate_no, r.equipment_text].filter(Boolean).join(' · ') || '—';

export async function renderRequestsAdmin(el, params) {
  await data.lookups();
  const tab = params?.get('tab') === 'archive' ? 'archive' : 'active';
  const canEdit = api.can('edit');
  const rows = await api.get('v_requests_archive', {
    select: '*', deleted_at: tab === 'archive' ? 'not.is.null' : 'is.null',
    order: tab === 'archive' ? 'deleted_at.desc' : 'request_date.desc,request_no.desc',
  });
  el.innerHTML = html`
    <a class="back" href="#/settings">${icon('back')}<span>الإعدادات</span></a>
    <div class="page-head row"><h1>إدارة طلبات الصيانة</h1></div>
    <nav class="tabs" role="tablist">
      <a role="tab" class="tabbtn ${tab === 'active' ? 'on' : ''}" href="#/settings/requests">الطلبات الحالية</a>
      <a role="tab" class="tabbtn ${tab === 'archive' ? 'on' : ''}" href="#/settings/requests?tab=archive">سجل الطلبات المحذوفة</a>
    </nav>
    <p class="muted">${tab === 'archive'
      ? 'طلبات نُقلت من قائمة طلبات الصيانة. كل بياناتها ومرفقاتها وفواتيرها المرتبطة وسجل تعديلاتها محفوظة. افتح الطلب للاطلاع عليه، أو استرجعه بنفس رقمه وحالته.'
      : 'الحذف هنا لا يمسح الطلب: ينقله إلى «سجل الطلبات المحذوفة»، ويُسجَّل في سجل التعديلات، ويمكن استرجاعه في أي وقت.'}</p>
    <form class="filters wide-filters" onsubmit="return false">
      <label class="grow"><span>بحث</span><input name="q" type="search" value="${st.q}" placeholder="رقم الطلب، اللوحة، الرقم الداخلي، المعدة، العطل، المشروع${tab === 'archive' ? '، سبب الحذف' : ''}"></label>
      <label><span>${tab === 'archive' ? 'حُذف من' : 'تاريخ الطلب من'}</span><input name="from" type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" value="${st.from}"></label>
      <label><span>إلى</span><input name="to" type="text" inputmode="numeric" dir="ltr" placeholder="YYYY/MM/DD" value="${st.to}"></label>
    </form>
    <div id="req-list"></div>`;

  const draw = () => {
    const q = st.q.trim().toLowerCase(), from = day(st.from), to = day(st.to);
    const list = rows.filter((r) => {
      const d = tab === 'archive' ? String(r.deleted_at).slice(0, 10) : r.request_date;
      return (!from || d >= from) && (!to || d <= to) && (!q || [r.request_no, r.plate_no, r.vehicle_code, r.equipment_text, r.fault, r.project_text, r.site_name, r.driver_name, r.delete_reason, r.deleted_by_name]
        .some((x) => (x || '').toLowerCase().includes(q)));
    });
    const head = tab === 'archive'
      ? '<th>رقم الطلب</th><th>تاريخ الطلب</th><th>السيارة أو المعدة</th><th>العطل</th><th>الحالة</th><th>تاريخ الحذف</th><th>حذفه</th><th>السبب</th><th></th>'
      : '<th>رقم الطلب</th><th>تاريخ الطلب</th><th>السيارة أو المعدة</th><th>العطل</th><th>الموقع</th><th>الحالة</th><th></th>';
    $('#req-list', el).innerHTML = list.length ? html`<div class="table-wrap"><table class="rtable"><thead><tr>${raw(head)}</tr></thead><tbody>
      ${raw(list.map((r) => html`<tr>
        <td data-l="رقم الطلب"><a class="code strong" href="#/requests/${r.id}">${r.request_no}</a></td>
        <td data-l="تاريخ الطلب" class="num">${date(r.request_date)}</td>
        <td data-l="السيارة أو المعدة">${subject(r)}</td>
        <td data-l="العطل">${(r.fault || '').length > 60 ? r.fault.slice(0, 60) + '…' : r.fault}</td>
        ${raw(tab === 'archive'
          ? html`<td data-l="الحالة">${mrTag(r.status)}</td><td data-l="تاريخ الحذف" class="num">${dateTime(r.deleted_at)}</td><td data-l="حذفه">${r.deleted_by_name || '—'}</td><td data-l="السبب">${r.delete_reason || '—'}</td>`
          : html`<td data-l="الموقع">${r.site_name || r.project_text || '—'}</td><td data-l="الحالة">${mrTag(r.status)}</td>`)}
        <td class="act"><a class="btn btn-sm" href="#/requests/${r.id}">فتح الطلب</a>
          ${raw(!canEdit ? '' : tab === 'archive'
            ? html`<button class="btn btn-sm btn-primary" data-restore="${r.id}">استرجاع الطلب</button>`
            : html`<button class="btn btn-sm" data-archive="${r.id}">${icon('clock')}<span>حذف إلى السجل</span></button>`)}</td></tr>`).join(''))}
      </tbody></table></div>`
      : html`<div class="empty soft"><p>${rows.length ? 'لا توجد طلبات مطابقة.' : tab === 'archive' ? 'لا توجد طلبات محذوفة.' : 'لا توجد طلبات صيانة.'}</p></div>`;
  };
  draw();
  $('form', el).addEventListener('input', (e) => { st[e.target.name] = e.target.value; draw(); });
  el.onclick = async (e) => {
    const a = e.target.closest('[data-archive]'), b = e.target.closest('[data-restore]');
    const id = a?.dataset.archive || b?.dataset.restore; if (!id) return;
    const r = rows.find((x) => x.id === id);
    const ok = a ? await archiveRequest(r) : await restoreRequest(r);
    if (ok) renderRequestsAdmin(el, params);
  };
}
