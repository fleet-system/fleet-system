// الشركات والمواقع: الإضافة وتعديل الأسماء مع حفظ التاريخ (السجلات مرتبطة بالمعرّف لا بالاسم)
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon } from '../ui.js';
import { label, num } from '../fmt.js';
import { openForm, saved } from '../form.js';

export async function renderSites(el) {
  const { companies, sites } = await data.lookups(true);
  const [vehicles, employees] = await Promise.all([
    api.get('vehicles', { select: 'site_id,owner_company_id', deleted_at: 'is.null' }),
    api.get('employees', { select: 'site_id', deleted_at: 'is.null', status: 'neq.terminated' }),
  ]);
  const count = (arr, k, id) => arr.filter((x) => x[k] === id).length;
  const canEdit = api.can('settings');

  el.innerHTML = html`
    <div class="page-head row">
      <h1>الشركات والمواقع</h1>
      ${raw(canEdit ? html`<div class="head-actions"><button class="btn" data-act="add-company">${icon('plus')}<span>شركة</span></button><button class="btn btn-primary" data-act="add-site">${icon('plus')}<span>موقع</span></button></div>` : '')}
    </div>
    <p class="muted note">تغيير اسم شركة أو موقع لا يؤثر على السجلات السابقة؛ كل السجلات تبقى مرتبطة به ويُحفظ الاسم القديم في التاريخ.</p>
    ${raw(companies.map((c) => html`
      <section class="panel company ${c.is_active ? '' : 'inactive'}">
        <header>
          <div><h2>${c.name}</h2>${raw(c.is_active ? '' : '<span class="pill st-stopped">غير نشطة</span>')}
            <small class="muted">تملك ${num(count(vehicles, 'owner_company_id', c.id))} سيارة</small></div>
          ${raw(canEdit ? html`<button class="btn btn-sm" data-act="edit-company" data-id="${c.id}">${icon('edit')}<span>تعديل</span></button>` : '')}
        </header>
        <ul class="site-list">
          ${raw(sites.filter((s) => s.company_id === c.id).map((s) => html`
            <li class="${s.is_active ? '' : 'inactive'}">
              <div><b>${s.name}</b> <span class="muted small">${label('site_kind', s.kind)}${s.is_active ? '' : ' · غير نشط'}</span></div>
              <div class="muted small">${num(count(vehicles, 'site_id', s.id))} سيارة · ${num(count(employees, 'site_id', s.id))} موظف</div>
              ${raw(canEdit ? html`<button class="btn btn-sm" data-act="edit-site" data-id="${s.id}">${icon('edit')}<span>تعديل</span></button>` : '')}
            </li>`).join('') || html`<li class="muted">لا توجد مواقع لهذه الشركة.</li>`)}
        </ul>
      </section>`).join(''))}`;

  el.onclick = async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'add-company' || act === 'edit-company') {
      const c = companies.find((x) => x.id === id) || { is_active: true };
      const r = await openForm({
        title: id ? 'تعديل الشركة' : 'إضافة شركة',
        fields: [{ name: 'name', label: 'اسم الشركة', required: true, full: true }, { name: 'is_active', label: 'نشطة', type: 'checkbox' }],
        values: c,
        onSubmit: (v) => (id ? api.update('companies', { id: `eq.${id}` }, v) : api.insert('companies', v)),
      });
      if (r) { saved(); data.invalidate(); renderSites(el); }
    }
    if (act === 'add-site' || act === 'edit-site') {
      const s = sites.find((x) => x.id === id) || { is_active: true, kind: 'farm' };
      const r = await openForm({
        title: id ? 'تعديل الموقع' : 'إضافة موقع',
        fields: [
          { name: 'name', label: 'اسم الموقع', required: true, full: true },
          { name: 'company_id', label: 'الشركة التي يتبع لها الموقع', type: 'select', required: true, options: companies.map((x) => [x.id, x.name]) },
          { name: 'kind', label: 'النوع', type: 'select', required: true, placeholder: false, options: Object.entries({ farm: 'مزرعة', nursery: 'مشتل', other: 'أخرى' }) },
          { name: 'is_active', label: 'نشط', type: 'checkbox' },
        ],
        values: s,
        onSubmit: (v) => (id ? api.update('sites', { id: `eq.${id}` }, v) : api.insert('sites', v)),
      });
      if (r) { saved(); data.invalidate(); renderSites(el); }
    }
  };
}
