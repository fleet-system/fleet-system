import * as api from '../api.js';
import * as data from '../data.js';
import { mrTag } from './requests.js';
import { html, raw } from '../ui.js';
import { label, km, num, date } from '../fmt.js';
import { planCard, licTag, normName } from './renewal.js';

// كل كلمات البحث موجودة في النص المجمّع (بعد توحيد الهمزات والمسافات وحالة الأحرف)
function matchAll(q, fields) {
  const hay = normName(fields.filter(Boolean).join(' '));
  const words = normName(q).split(' ').filter(Boolean);
  return words.length > 0 && words.every((w) => hay.includes(w));
}

export async function renderSearch(el, q) {
  const clean = q.replace(/[(),*%\\]/g, ' ').trim();
  const box = document.querySelector('form.search input');
  if (box) box.value = q;
  if (!clean) { el.innerHTML = html`<div class="empty"><p>اكتب كلمة للبحث في الأعلى.</p></div>`; return; }
  const like = `*${clean}*`;
  await data.lookups();
  const siteIds = data.siteOptions(false).filter(([, t]) => t.toLowerCase().includes(clean.toLowerCase())).map(([k]) => k);
  const [vehicles, employees, requests] = await Promise.all([
    // السيارات: كل كلمة من البحث يجب أن تظهر في بيانات السيارة (بأي ترتيب)، فيُطابق «ب ح د 1624» اللوحة «ب ح د DJB 1624»
    api.get('v_vehicles_overview', {
      select: 'id,code,plate_no,vehicle_type,make,model,owner_company_name,site_name,driver_name,current_user_name,authorized_name,vin,op_status,odometer', order: 'code',
    }).then((rows) => rows.filter((v) => matchAll(clean, [v.plate_no, v.code, v.driver_name, v.vehicle_type, v.make, v.model, v.owner_company_name, v.site_name, v.current_user_name, v.authorized_name, v.vin])).slice(0, 50)),
    api.get('employees', {
      select: 'id,code,full_name,job_title,status', deleted_at: 'is.null',
      or: `(full_name.ilike.${like},code.ilike.${like})`, order: 'full_name', limit: 50,
    }),
    api.get('maintenance_requests', {
      select: 'id,request_no,request_date,plate_no,equipment_text,project_text,site_id,status,fault', deleted_at: 'is.null',
      or: `(request_no.ilike.${like},plate_no.ilike.${like},project_text.ilike.${like},equipment_text.ilike.${like}${siteIds.length ? `,site_id.in.(${siteIds.join(',')})` : ''})`,
      order: 'request_date.desc', limit: 50,
    }).catch(() => []),
  ]);
  // خطة تجديد المركبة والمفوض: المفوّضون (بالاسم أو الرقم الداخلي، والرخصة والجوال لصاحب الصلاحية) والخطط
  const digits = clean.replace(/\D/g, '');
  const [dlgs, privIds] = await Promise.all([
    // الأسماء تُطابق بعد توحيد الهمزات والألف المقصورة والتاء المربوطة (أحمد = احمد)
    api.get('v_delegates', { select: '*', order: 'full_name' }).then((r) => r.filter((d) => normName(d.full_name).includes(normName(clean)) || normName(d.code).includes(normName(clean))).slice(0, 50)).catch(() => []),
    api.can('view_sensitive') && digits.length >= 4
      ? api.get('delegate_private', { select: 'delegate_id', or: `(license_no.ilike.*${digits}*,mobile.ilike.*${digits.replace(/^0/, '')}*)` }).then((r) => r.map((x) => x.delegate_id)).catch(() => [])
      : Promise.resolve([]),
  ]);
  const extraIds = privIds.filter((x) => !dlgs.some((d) => d.id === x));
  if (extraIds.length) dlgs.push(...await api.get('v_delegates', { select: '*', id: `in.(${extraIds.join(',')})` }).catch(() => []));
  const dlgIds = new Set(dlgs.map((d) => d.id));
  const plans = await api.get('v_renewal_plans', { select: '*', order: 'created_at.desc' })
    .then((rows) => rows.filter((p) => dlgIds.has(p.delegate_id) || matchAll(clean, [p.plate_no, p.code, p.plan_no, p.delegate_name])).slice(0, 50)).catch(() => []);
  el.innerHTML = html`
    <div class="page-head"><h1>نتائج البحث عن «${q}»</h1></div>
    ${raw(plans.length ? html`<section class="followups" data-search-plans>
      <header class="sec-head"><h2>خطط تجديد المركبة والمفوض</h2><span class="count num">${num(plans.length)}</span></header>
      <div class="rn-list">${raw(plans.map(planCard).join(''))}</div></section>` : '')}
    ${raw(dlgs.length ? html`<section class="followups" data-search-delegates>
      <header class="sec-head"><h2>المفوّضون</h2><span class="count num">${num(dlgs.length)}</span></header>
      <div class="rn-list">${raw(dlgs.map((d) => html`<a class="rn-card" href="#/delegates/${d.id}"><span class="rn-card-top"><b>${d.full_name}</b> <small class="code">${d.code}</small></span>
        <small>الرخصة: ${raw(d.license_expiry ? html`<span class="num">${date(d.license_expiry)}</span> ` : '')}${raw(licTag(d.license_expiry))}</small>
        <small class="muted">السيارات المرتبطة: <b class="num">${num(d.vehicle_count)}</b></small></a>`).join(''))}</div></section>` : '')}
    <section class="followups">
      <header class="sec-head"><h2>السيارات</h2><span class="count num">${num(vehicles.length)}</span></header>
      ${raw(vehicles.length ? html`<div class="table-wrap"><table class="log">
        <thead><tr><th>الرقم الداخلي</th><th>رقم اللوحة</th><th>النوع</th><th>الشركة المالكة</th><th>الموقع</th><th>السائق</th><th>الحالة</th><th>العداد</th><th></th></tr></thead>
        <tbody>${raw(vehicles.map((v) => html`<tr>
          <td data-l="الرقم الداخلي" class="num"><b>${v.code}</b></td><td data-l="رقم اللوحة" class="plate">${v.plate_no}</td>
          <td data-l="النوع">${v.vehicle_type || '—'} ${v.make || ''}</td><td data-l="الشركة المالكة">${v.owner_company_name}</td>
          <td data-l="الموقع">${v.site_name || '—'}</td><td data-l="السائق">${v.driver_name || '—'}</td>
          <td data-l="الحالة"><span class="pill st-${v.op_status}">${label('op_status', v.op_status)}</span></td>
          <td data-l="العداد" class="num">${km(v.odometer)}</td>
          <td class="act"><a class="btn btn-sm" href="#/vehicles/${v.id}">عرض الملف</a></td></tr>`).join(''))}</tbody></table></div>`
        : html`<p class="muted pad">لا توجد سيارات مطابقة.</p>`)}
    </section>
    ${raw(requests.length ? html`<section class="followups">
      <header class="sec-head"><h2>طلبات الصيانة</h2><span class="count num">${num(requests.length)}</span></header>
      <div class="table-wrap"><table class="log">
        <thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>رقم اللوحة / المعدة</th><th>المشروع</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${raw(requests.map((r) => html`<tr>
          <td data-l="رقم الطلب" class="num"><b>${r.request_no}</b></td><td data-l="التاريخ" class="num">${date(r.request_date)}</td>
          <td data-l="رقم اللوحة / المعدة" class="plate">${r.plate_no || r.equipment_text || '—'}</td>
          <td data-l="المشروع">${[r.site_id ? data.siteName(r.site_id) : '', r.project_text].filter(Boolean).join(' — ') || '—'}</td>
          <td data-l="الحالة">${mrTag(r.status)}</td>
          <td class="act"><a class="btn btn-sm" href="#/requests/${r.id}">عرض الطلب</a></td></tr>`).join(''))}</tbody></table></div>
    </section>` : '')}
    <section class="followups">
      <header class="sec-head"><h2>الموظفون</h2><span class="count num">${num(employees.length)}</span></header>
      ${raw(employees.length ? html`<div class="table-wrap"><table class="log">
        <thead><tr><th>الرقم الداخلي</th><th>الاسم</th><th>المسمى الوظيفي</th><th></th></tr></thead>
        <tbody>${raw(employees.map((e) => html`<tr>
          <td data-l="الرقم الداخلي" class="num"><b>${e.code}</b></td><td data-l="الاسم">${e.full_name}</td><td data-l="المسمى">${e.job_title || '—'}</td>
          <td class="act"><a class="btn btn-sm" href="#/employees/${e.id}">عرض الملف</a></td></tr>`).join(''))}</tbody></table></div>`
        : html`<p class="muted pad">لا يوجد موظفون مطابقون.</p>`)}
    </section>`;
}
