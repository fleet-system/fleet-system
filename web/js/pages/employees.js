// الموظفون: الجدول والبحث، والإضافة، وملف كل موظف
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, toast, $, PAGE_ROWS, moreRows, bindMore } from '../ui.js';
import { label, LABELS, num, date, dateTime, todayISO, km } from '../fmt.js';
import { openForm, saved, userError } from '../form.js';
import { mountAttachments } from '../attachments.js';
import { companyNames, siteNames, resolveCompany, resolveSite } from '../resolve.js';

const iqamaOk = (s) => !s || /^\d{10}$/.test(s);
const mobileOk = (s) => !s || /^\+?\d{9,15}$/.test(s);

function employeeFields(isNew) {
  const sens = api.can('view_sensitive');
  const f = [
    { name: 'full_name', label: 'الاسم الكامل', required: true, full: true },
    { name: 'company_name', label: 'الشركة', type: 'combo', options: companyNames(), help: 'اختر أو اكتب اسم أي شركة؛ الاسم الجديد يُسجَّل' },
    { name: 'site_name', label: 'الموقع / المشروع', type: 'combo', options: siteNames(), help: 'اختر أو اكتب أي موقع أو مشروع أو مزرعة أو فرع' },
    { name: 'job_title', label: 'المسمى الوظيفي' },
    { name: 'status', label: 'حالة الموظف', type: 'select', required: true, placeholder: false, options: Object.entries(LABELS.employee_status) },
  ];
  if (sens) f.push(
    { type: 'section', label: 'بيانات حساسة (تظهر فقط لمن يملك الصلاحية)' },
    { name: 'iqama_no', label: 'رقم الإقامة', inputmode: 'numeric', dir: 'ltr', western: true, help: '10 أرقام' },
    { name: 'mobile', label: 'رقم الجوال', inputmode: 'tel', dir: 'ltr', western: true, help: 'مثل 05xxxxxxxx' },
    { name: 'driving_license_no', label: 'رقم رخصة القيادة', dir: 'ltr', western: true },
  );
  if (isNew) f.push(
    { type: 'section', label: 'تواريخ الانتهاء' },
    { name: 'iqama_expiry', label: 'تاريخ انتهاء الإقامة', type: 'date' },
    { name: 'license_expiry', label: 'تاريخ انتهاء رخصة القيادة', type: 'date' },
  );
  f.push({ type: 'section', label: 'الربط بالسيارة' },
    { name: 'vehicle_id', label: 'تعيينه سائقاً مسؤولاً عن سيارة', type: 'select', options: data.vehicleOptions(), placeholder: '— بدون —', full: true, help: 'يمكن تغيير التعيين لاحقاً من ملف السيارة؛ الفترة السابقة تبقى في السجل' });
  f.push({ name: 'notes', label: 'ملاحظات', type: 'textarea', full: true });
  return f;
}

// الشركة والموقع نص حر ← معرّفات (القيم الجديدة تُسجَّل)
async function resolvePlace(base) {
  const { company_name, site_name, vehicle_id, ...rest } = base;
  rest.company_id = await resolveCompany(company_name);
  if (site_name && !rest.company_id && !(data.cache()?.sites || []).some((s) => s.name === site_name)) throw userError('اكتب اسم الشركة حتى يُسجَّل الموقع الجديد تحتها.');
  rest.site_id = await resolveSite(site_name, rest.company_id);
  if (rest.site_id && !rest.company_id) rest.company_id = data.siteCompany(rest.site_id);
  return { rec: rest, vehicle_id };
}

function splitSensitive(v) {
  const priv = { iqama_no: v.iqama_no ?? null, mobile: v.mobile ?? null, driving_license_no: v.driving_license_no ?? null };
  const base = { ...v }; delete base.iqama_no; delete base.mobile; delete base.driving_license_no; delete base.iqama_expiry; delete base.license_expiry;
  if (!iqamaOk(priv.iqama_no)) throw userError('رقم الإقامة يجب أن يكون 10 أرقام.');
  if (!mobileOk(priv.mobile)) throw userError('رقم الجوال غير صحيح. اكتبه بالأرقام فقط، مثل 0500000000.');
  return { base, priv };
}

export async function addEmployee() {
  await data.lookups();
  return openForm({
    title: 'إضافة موظف', fields: employeeFields(true), values: { status: 'active' }, submitText: 'إضافة الموظف',
    onSubmit: async (v) => {
      const { base: b0, priv } = splitSensitive(v);
      const { rec: base, vehicle_id } = await resolvePlace(b0);
      const [row] = await api.insert('employees', base);
      if (vehicle_id) await api.update('vehicles', { id: `eq.${vehicle_id}` }, { current_driver_id: row.id });
      if (api.can('view_sensitive') && Object.values(priv).some(Boolean)) await api.insert('employee_private', { employee_id: row.id, ...priv });
      if (v.iqama_expiry) await api.insert('documents', { doc_type: 'iqama', employee_id: row.id, expiry_date: v.iqama_expiry });
      if (v.license_expiry) await api.insert('documents', { doc_type: 'driving_license', employee_id: row.id, expiry_date: v.license_expiry });
      data.invalidate();
      return row;
    },
  });
}

const st = { q: '', site: '', status: 'active' };

export async function renderEmployees(el) {
  await data.lookups(true);
  const sens = api.can('view_sensitive');
  const [emps, docs, vehicles, priv] = await Promise.all([
    api.get('employees', { select: '*', deleted_at: 'is.null', order: 'full_name' }),
    api.get('v_document_status', { select: 'owner_id,doc_type,expiry_date,status', owner_type: 'eq.employee' }),
    api.get('vehicles', { select: 'id,code,plate_no,current_driver_id', deleted_at: 'is.null' }),
    sens ? api.get('employee_private', { select: '*' }) : Promise.resolve([]),
  ]);
  const P = Object.fromEntries(priv.map((p) => [p.employee_id, p]));
  const doc = (id, t) => docs.find((d) => d.owner_id === id && d.doc_type === t);
  const opt = (v, t, cur) => html`<option value="${v}" ${raw(v === cur ? 'selected' : '')}>${t}</option>`;

  el.innerHTML = html`
    <div class="page-head row">
      <h1>الموظفون <span class="count num">${num(emps.length)}</span></h1>
      ${raw(api.can('create') ? html`<button class="btn btn-primary" data-act="new">${icon('plus')}<span>إضافة موظف</span></button>` : '')}
    </div>
    <form class="filters wide-filters" onsubmit="return false">
      <label class="grow"><span>بحث</span><input name="q" type="search" value="${st.q}" placeholder="${sens ? 'الاسم، الرقم الداخلي، رقم الإقامة، الجوال' : 'الاسم أو الرقم الداخلي'}"></label>
      <label><span>الموقع</span><select name="site">${raw(opt('', 'الكل', st.site))}${raw(data.siteOptions(false).map(([k, t]) => opt(k, t, st.site)).join(''))}</select></label>
      <label><span>الحالة</span><select name="status">${raw(opt('', 'الكل', st.status))}${raw(Object.entries(LABELS.employee_status).map(([k, t]) => opt(k, t, st.status)).join(''))}</select></label>
    </form>
    <div id="et"></div>`;

  const cell = (d) => (d?.expiry_date ? html`<span class="num">${date(d.expiry_date)}</span><small class="tag t-${d.status}">${label('doc_status', d.status)}</small>` : html`<span class="tag t-${d?.status || 'missing'}">${label('doc_status', d?.status || 'missing')}</span>`);
  const pager = { limit: PAGE_ROWS };
  const draw = (keep) => {
    if (!keep) pager.limit = PAGE_ROWS;
    const q = st.q.trim().toLowerCase();
    const list = emps.filter((e) => (!st.site || e.site_id === st.site) && (!st.status || e.status === st.status) &&
      (!q || [e.full_name, e.code, P[e.id]?.iqama_no, P[e.id]?.mobile, data.siteName(e.site_id)].some((x) => (x || '').toLowerCase().includes(q))));
    $('#et', el).innerHTML = list.length ? html`<div class="table-wrap"><table class="rtable">
      <thead><tr><th>الرقم الداخلي</th><th>الاسم</th><th>المسمى الوظيفي</th><th>الموقع</th><th>الحالة</th><th>السيارة الحالية</th><th>انتهاء الإقامة</th><th>انتهاء الرخصة</th>${raw(sens ? '<th>رقم الإقامة</th><th>الجوال</th>' : '')}<th></th></tr></thead>
      <tbody>${raw(list.slice(0, pager.limit).map((e) => {
        const cars = vehicles.filter((v) => v.current_driver_id === e.id);
        return html`<tr>
          <td data-l="الرقم الداخلي"><a class="code strong" href="#/employees/${e.id}">${e.code}</a></td>
          <td data-l="الاسم"><b>${e.full_name}</b></td>
          <td data-l="المسمى الوظيفي">${e.job_title || '—'}</td>
          <td data-l="الموقع">${data.siteName(e.site_id)}<small class="muted">${data.companyName(e.company_id)}</small></td>
          <td data-l="الحالة"><span class="tag t-emp-${e.status}">${label('employee_status', e.status)}</span></td>
          <td data-l="السيارة الحالية">${cars.length ? raw(cars.map((v) => html`<a href="#/vehicles/${v.id}" class="plate">${v.plate_no}</a>`).join('، ')) : '—'}</td>
          <td data-l="انتهاء الإقامة">${cell(doc(e.id, 'iqama'))}</td>
          <td data-l="انتهاء الرخصة">${doc(e.id, 'driving_license') ? cell(doc(e.id, 'driving_license')) : '—'}</td>
          ${raw(sens ? html`<td data-l="رقم الإقامة" class="num">${P[e.id]?.iqama_no || '—'}</td><td data-l="الجوال" class="num">${P[e.id]?.mobile || '—'}</td>` : '')}
          <td class="act"><a class="btn btn-sm" href="#/employees/${e.id}">عرض الملف</a></td></tr>`;
      }).join(''))}</tbody></table>${moreRows(Math.min(pager.limit, list.length), list.length)}</div>`
      : html`<div class="empty soft"><p>${emps.length ? 'لا يوجد موظفون مطابقون.' : 'لم يُسجَّل أي موظف بعد.'}</p></div>`;
  };
  draw();
  bindMore($('#et', el), pager, draw);
  const f = $('form', el);
  f.addEventListener('input', () => { st.q = f.q.value; st.site = f.site.value; st.status = f.status.value; draw(); });
  el.onclick = async (e) => {
    if (e.target.closest('[data-act=new]')) {
      const row = await addEmployee();
      if (row) { saved(`تمت إضافة الموظف ${row.code}`); location.hash = `#/employees/${row.id}`; }
    }
  };
}

// ---------------------------------------------------------------------
// ملف الموظف
// ---------------------------------------------------------------------
export async function renderEmployee(el, id, params) {
  await data.lookups();
  const sens = api.can('view_sensitive');
  const [[e], docs, cars, assigns, privRows, auths] = await Promise.all([
    api.get('employees', { select: '*', id: `eq.${id}` }),
    api.get('documents', { select: '*', employee_id: `eq.${id}`, deleted_at: 'is.null', order: 'expiry_date.desc.nullslast' }),
    api.get('v_vehicles_overview', { select: 'id,code,plate_no,vehicle_type,make,authorization_status', current_driver_id: `eq.${id}` }),
    api.get('vehicle_assignments', { select: '*', employee_id: `eq.${id}`, order: 'start_at.desc' }),
    sens ? api.get('employee_private', { select: '*', employee_id: `eq.${id}` }) : Promise.resolve([]),
    api.get('authorizations', { select: '*', employee_id: `eq.${id}`, deleted_at: 'is.null', order: 'expiry_date.desc.nullslast' }),
  ]);
  if (!e) { el.innerHTML = html`<div class="empty"><h1>الموظف غير موجود</h1><a class="btn btn-primary" href="#/employees">قائمة الموظفين</a></div>`; return; }
  document.title = `${e.full_name} — نظام إدارة الأسطول`;
  const p = privRows[0] || {};
  const allV = assigns.length ? await api.get('vehicles', { select: 'id,code,plate_no', id: `in.(${[...new Set(assigns.map((a) => a.vehicle_id))].join(',')})` }) : [];
  const vName = (vid) => { const v = allV.find((x) => x.id === vid); return v ? `${v.plate_no} (${v.code})` : '—'; };
  const today = todayISO();
  const st = (d) => (!d ? 'missing' : !d.expiry_date ? 'no_date' : d.expiry_date < today ? 'expired' : (new Date(d.expiry_date) - new Date(today)) / 864e5 <= 90 ? 'expiring' : 'valid');
  const cur = (t) => docs.find((d) => d.doc_type === t);
  const canEdit = api.can('edit'), canAdd = api.can('create');
  const kv = (pairs) => html`<dl class="dl">${raw(pairs.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v ?? '—'}</dd></div>`).join(''))}</dl>`;

  const card = (t) => { const d = cur(t), s = st(d); return html`<div class="doc-card s-${s}"><div><b>${label('doc_type', t)}</b><span class="tag t-${s}">${label('doc_status', s)}</span></div>
    <div class="num">${d?.expiry_date ? `ينتهي ${date(d.expiry_date)}` : 'لا يوجد تاريخ انتهاء مسجل'}</div>
    <div class="btn-row">${raw(canAdd ? html`<button class="btn btn-sm" data-act="doc" data-type="${t}">${d ? 'تجديد' : 'إضافة'}</button>` : '')}${raw(d && canEdit ? html`<button class="btn btn-sm" data-act="doc-edit" data-type="${t}">تعديل</button>` : '')}</div></div>`; };

  el.innerHTML = html`
    <a class="back" href="#/employees">${icon('back')}<span>الموظفون</span></a>
    <header class="vhead">
      <div class="vhead-main"><div class="avatar">${e.full_name.trim().slice(0, 1)}</div>
        <div><h1>${e.full_name} <span class="code">${e.code}</span></h1><p class="muted">${e.job_title || ''}${e.job_title ? ' · ' : ''}${data.siteName(e.site_id)} · ${data.companyName(e.company_id)}</p></div>
        <span class="tag t-emp-${e.status}">${label('employee_status', e.status)}</span></div>
      <div class="vactions no-print">${raw(canEdit ? html`<button class="btn btn-primary" data-act="edit">${icon('edit')}<span>تعديل البيانات</span></button>` : '')}
        <button class="btn" data-act="print">${icon('print')}<span>طباعة</span></button></div>
    </header>
    <section class="panel"><div class="tab-head"><h2>البيانات</h2></div>
      ${kv([['الرقم الداخلي', raw(html`<span class="code">${e.code}</span>`)], ['الاسم الكامل', e.full_name], ['الشركة', data.companyName(e.company_id)], ['الموقع', data.siteName(e.site_id)],
        ['المسمى الوظيفي', e.job_title], ['الحالة', label('employee_status', e.status)], ['ملاحظات', e.notes]])}
      <h3 class="sub">البيانات الحساسة</h3>
      ${sens ? kv([['رقم الإقامة', raw(html`<span class="num">${p.iqama_no || '—'}</span>`)], ['رقم الجوال', raw(html`<span class="num">${p.mobile || '—'}</span>`)], ['رقم رخصة القيادة', raw(html`<span class="num">${p.driving_license_no || '—'}</span>`)]])
        : html`<p class="muted">مخفية — الاطلاع على أرقام الإقامة والجوال يتطلب صلاحية «البيانات الحساسة».</p>`}
    </section>
    <section class="panel"><div class="tab-head"><h2>الوثائق</h2></div>
      <div class="doc-cards">${card('iqama')}${card('driving_license')}</div>
    </section>
    <section class="panel"><div class="att-box"></div></section>
    <section class="panel"><div class="tab-head"><h2>السيارات</h2></div>
      ${cars.length ? raw(cars.map((v) => html`<div class="person"><a class="plate strong" href="#/vehicles/${v.id}">${v.plate_no}</a> <span class="code">${v.code}</span>
          <span class="muted">${[v.vehicle_type, v.make].filter(Boolean).join(' ')}</span><span class="tag t-${v.authorization_status}">التفويض: ${label('auth_status', v.authorization_status)}</span></div>`).join(''))
        : html`<p class="muted">لا توجد سيارة مسؤول عنها حالياً.</p>`}
      <h3 class="sub">سجل المسؤولية عن السيارات</h3>
      ${assigns.length ? html`<div class="table-wrap"><table class="rtable"><thead><tr><th>السيارة</th><th>من</th><th>إلى</th></tr></thead><tbody>
        ${raw(assigns.map((a) => html`<tr><td data-l="السيارة"><a href="#/vehicles/${a.vehicle_id}">${vName(a.vehicle_id)}</a></td><td data-l="من" class="num">${dateTime(a.start_at)}</td><td data-l="إلى" class="num">${a.end_at ? dateTime(a.end_at) : 'حالياً'}</td></tr>`).join(''))}</tbody></table></div>`
        : html`<p class="muted">لا يوجد سجل.</p>`}
      <h3 class="sub">التفويضات</h3>
      ${auths.length ? html`<div class="table-wrap"><table class="rtable"><thead><tr><th>السيارة</th><th>مفوّض</th><th>الانتهاء</th></tr></thead><tbody>
        ${raw(auths.map((a) => html`<tr><td data-l="السيارة"><a href="#/vehicles/${a.vehicle_id}?tab=auth">${vName(a.vehicle_id) !== '—' ? vName(a.vehicle_id) : 'عرض السيارة'}</a></td><td data-l="مفوّض">${a.is_authorized ? 'نعم' : 'لا'}</td><td data-l="الانتهاء" class="num">${date(a.expiry_date)}</td></tr>`).join(''))}</tbody></table></div>`
        : html`<p class="muted">لا توجد تفويضات مسجلة لهذا الموظف.</p>`}
    </section>`;

  mountAttachments(el.querySelector('.att-box'), { entity_type: 'employee', entity_id: id, title: 'صور الوثائق والمرفقات' }).catch(() => {});

  el.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'print') { window.print(); return; }
    if (b.dataset.act === 'edit') {
      const r = await openForm({
        title: `تعديل بيانات ${e.code}`, fields: employeeFields(false), values: { ...e, ...p, company_name: e.company_id ? data.companyName(e.company_id) : '', site_name: e.site_id ? data.siteName(e.site_id) : '', vehicle_id: cars[0]?.id || '' },
        onSubmit: async (v) => {
          const { base: b0, priv } = splitSensitive(v);
          const { rec: base, vehicle_id } = await resolvePlace(b0);
          await api.update('employees', { id: `eq.${id}` }, base);
          if (vehicle_id && !cars.some((c) => c.id === vehicle_id)) await api.update('vehicles', { id: `eq.${vehicle_id}` }, { current_driver_id: id });
          if (sens) {
            const changed = ['iqama_no', 'mobile', 'driving_license_no'].some((k) => (priv[k] ?? null) !== (p[k] ?? null));
            if (changed) await (privRows.length ? api.update('employee_private', { employee_id: `eq.${id}` }, priv) : api.insert('employee_private', { employee_id: id, ...priv }));
          }
          data.invalidate();
          return true;
        },
      });
      if (r) { saved(); location.hash = `#/employees/${id}?r=${Date.now()}`; }
    }
    if (b.dataset.act === 'doc') {
      const t = b.dataset.type;
      const r = await openForm({
        title: `${cur(t) ? 'تجديد' : 'إضافة'} ${label('doc_type', t)}`,
        intro: 'يُحفظ كسجل جديد وتبقى الوثيقة السابقة. رقم الإقامة ورقم الرخصة يُحفظان في البيانات الحساسة للموظف.',
        fields: [{ name: 'issue_date', label: 'تاريخ الإصدار', type: 'date' }, { name: 'expiry_date', label: 'تاريخ الانتهاء', type: 'date' }, { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true }],
        onSubmit: (v) => api.insert('documents', { ...v, doc_type: t, employee_id: id }),
      });
      if (r) { saved(); location.hash = `#/employees/${id}?r=${Date.now()}`; }
    }
    if (b.dataset.act === 'doc-edit') {
      const t = b.dataset.type, d = cur(t);
      const r = await openForm({
        title: `تعديل ${label('doc_type', t)}`,
        intro: 'لتصحيح خطأ في الوثيقة الحالية. للتجديد استخدم زر «تجديد» حتى تبقى الوثيقة السابقة في السجل.',
        fields: [{ name: 'issue_date', label: 'تاريخ الإصدار', type: 'date' }, { name: 'expiry_date', label: 'تاريخ الانتهاء', type: 'date' }, { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true }],
        values: d,
        onSubmit: (v) => api.update('documents', { id: `eq.${d.id}` }, v),
      });
      if (r) { saved(); location.hash = `#/employees/${id}?r=${Date.now()}`; }
    }
  };
}
