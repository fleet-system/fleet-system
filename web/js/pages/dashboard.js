import * as api from '../api.js';
import { html, raw, icon, $, PAGE_ROWS, moreRows, bindMore } from '../ui.js';
import { num, money, date, label, todayParts, statusText, toWestern } from '../fmt.js';
import { backupReminder } from './settings.js';

let lookups = null;
async function getLookups() {
  if (!lookups) {
    const [companies, sites] = await Promise.all([
      api.get('companies', { select: 'id,name', order: 'name' }),
      api.get('sites', { select: 'id,name,company_id', order: 'name' }),
    ]);
    lookups = { companies, sites };
  }
  return lookups;
}

// "اسم (EMP-0001)" أو "VEH-0001 — لوحة" => عرض الرمز معزولاً حتى لا يتكسر اتجاه النص
export function subject(lbl) {
  const m = String(lbl || '').match(/^(.*)\s\((EMP-\d+)\)$/) || String(lbl || '').match(/^(VEH-\d+)\s—\s(.*)$/);
  if (!m) return lbl;
  return /^VEH/.test(m[1]) ? raw(html`<span class="code">${m[1]}</span> ${m[2]}`) : raw(html`${m[1]} <span class="code">${m[2]}</span>`);
}

const state = { company: '', site: '', year: null, month: null };

export async function renderDashboard(el) {
  const { y, m } = todayParts();
  state.year ??= y; state.month ??= m;
  const { companies, sites } = await getLookups();
  const opt = (v, t, sel) => html`<option value="${v}" ${raw(String(v) === String(sel) ? 'selected' : '')}>${t}</option>`;

  el.innerHTML = html`
    <div class="page-head">
      <h1>لوحة التحكم</h1>
      <form class="filters" aria-label="تصفية لوحة التحكم">
        <label><span>الشركة</span><select name="company">${raw(opt('', 'كل الشركات', state.company))}${raw(companies.map((c) => opt(c.id, c.name, state.company)).join(''))}</select></label>
        <label><span>الموقع</span><select name="site"></select></label>
        <label class="sm"><span>الشهر</span><select name="month" class="num">${raw(Array.from({ length: 12 }, (_, i) => opt(i + 1, String(i + 1).padStart(2, '0'), state.month)).join(''))}</select></label>
        <label class="sm"><span>السنة</span><span class="stepper">
          <button type="button" class="step" data-step="-1" aria-label="السنة السابقة">−</button>
          <input name="year" class="num" type="number" inputmode="numeric" min="2000" max="2100" value="${state.year}" aria-label="السنة">
          <button type="button" class="step" data-step="1" aria-label="السنة التالية">+</button></span></label>
      </form>
    </div>
    <div id="nudge"></div>
    <div id="dash-body"><div class="loading">جارٍ تحميل الأرقام…</div></div>`;
  backupReminder().then((h) => { const n = el.querySelector('#nudge'); if (n) n.innerHTML = h; });

  const f = $('form.filters', el);
  const fillSites = () => {
    const list = sites.filter((s) => !state.company || s.company_id === state.company);
    if (state.site && !list.some((s) => s.id === state.site)) state.site = '';
    f.site.innerHTML = opt('', 'كل المواقع', state.site) + list.map((s) => opt(s.id, s.name, state.site)).join('');
  };
  fillSites();
  const apply = () => {
    const yr = parseInt(toWestern(f.year.value), 10);
    if (!(yr >= 2000 && yr <= 2100)) { f.year.value = state.year; return; }
    state.company = f.company.value; fillSites();
    state.site = f.site.value; state.month = +f.month.value; state.year = yr;
    loadBody($('#dash-body', el), lookups);
  };
  f.addEventListener('change', apply);
  f.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  f.addEventListener('click', (e) => {
    const b = e.target.closest('.step'); if (!b) return;
    f.year.value = (parseInt(f.year.value, 10) || state.year) + Number(b.dataset.step);
    apply();
  });
  await loadBody($('#dash-body', el), lookups);
}

async function loadBody(body, { companies, sites }) {
  body.setAttribute('aria-busy', 'true');
  const filt = {};
  if (state.company) filt.company_id = `eq.${state.company}`;
  if (state.site) filt.site_id = `eq.${state.site}`;
  const [s, follow] = await Promise.all([
    api.rpc('dashboard_stats', { p_company: state.company || null, p_site: state.site || null, p_year: state.year, p_month: state.month }),
    api.get('v_followups', { select: '*', ...filt }),
  ]);
  const siteName = (id) => sites.find((x) => x.id === id)?.name || '—';
  const compName = (id) => companies.find((x) => x.id === id)?.name || '—';
  follow.sort((a, b) => a.severity - b.severity || (a.days_left ?? a.km_left ?? 0) - (b.days_left ?? b.km_left ?? 0));

  const total = s.vehicles_total || 0;
  const seg = [
    ['working', 'تعمل', s.vehicles_working], ['stopped', 'متوقفة', s.vehicles_stopped],
    ['under_maintenance', 'تحت الصيانة', s.vehicles_maintenance], ['accident_damaged', 'متضررة بحادث', s.vehicles_accident],
  ];
  const period = `${state.year}/${String(state.month).padStart(2, '0')}`;
  const monthTotal = (+s.cost_maintenance_month) + (+s.cost_oil_month) + (+s.cost_accidents_month) + (+s.cost_housing_food_month);

  body.innerHTML = html`
    <section class="panels">
      <article class="panel fleet" aria-labelledby="p-fleet">
        <header><h2 id="p-fleet">السيارات</h2><a href="#/vehicles" class="link">عرض السيارات</a></header>
        <div class="big"><span class="num">${num(total)}</span><small>إجمالي السيارات</small></div>
        <div class="segbar" role="img" aria-label="توزيع السيارات حسب الحالة التشغيلية">
          ${raw(seg.map(([k, , v]) => (v ? html`<span class="seg st-${k}" style="flex:${v}"></span>` : '')).join('') || '<span class="seg empty-seg" style="flex:1"></span>')}
        </div>
        <ul class="legend">${raw(seg.map(([k, t, v]) => html`<li><i class="dot st-${k}"></i>${t}<b class="num">${num(v)}</b></li>`).join(''))}</ul>
        <ul class="kv three">
          <li><span>داخل المواقع</span><b class="num">${num(s.vehicles_inside)}</b></li>
          <li><span>خارج المواقع</span><b class="num">${num(s.vehicles_outside)}</b></li>
          <li><span>في الورشة</span><b class="num">${num(s.vehicles_in_workshop)}</b></li>
        </ul>
      </article>

      <article class="panel watch" aria-labelledby="p-watch">
        <header><h2 id="p-watch">ما يحتاج انتباهك</h2></header>
        <ul class="kv list">
          <li class="${s.docs_expired ? 'is-bad' : ''}"><span>وثائق منتهية</span><b class="num">${num(s.docs_expired)}</b></li>
          <li class="${s.docs_expiring_30 ? 'is-warn' : ''}"><span>وثائق تنتهي خلال 30 يوماً</span><b class="num">${num(s.docs_expiring_30)}</b></li>
          <li class="${s.oil_due_soon ? 'is-warn' : ''}"><span>سيارات اقترب أو حان تغيير زيتها</span><b class="num">${num(s.oil_due_soon)}</b></li>
          <li class="${s.accidents_open ? 'is-bad' : ''}"><span>حوادث مفتوحة</span><b class="num">${num(s.accidents_open)}</b></li>
          <li><span>الموظفون على رأس العمل</span><b class="num">${num(s.employees_total)}</b></li>
        </ul>
      </article>

      <article class="panel costs" aria-labelledby="p-costs">
        <header><h2 id="p-costs">مصروفات الشهر <span class="num muted">${period}</span></h2></header>
        <div class="big"><span class="num">${num(monthTotal, 2)}</span><small>ر.س إجمالي المصروفات المسجلة</small></div>
        <ul class="kv list">
          <li><span>الصيانة</span><b class="num">${money(s.cost_maintenance_month)}</b></li>
          <li><span>تغيير الزيت</span><b class="num">${money(s.cost_oil_month)}</b></li>
          <li><span>إصلاح الحوادث</span><b class="num">${money(s.cost_accidents_month)}</b></li>
          <li><span>السكن والطعام</span><b class="num">${money(s.cost_housing_food_month)}</b></li>
        </ul>
      </article>
    </section>

    <section class="followups" aria-labelledby="p-follow">
      <header class="sec-head"><h2 id="p-follow">المهام التي تحتاج إلى متابعة</h2><span class="count num">${num(follow.length)}</span></header>
      ${raw(follow.length ? html`
      <div class="table-wrap">
        <table class="log">
          <thead><tr><th>السيارة أو الموظف</th><th>نوع التنبيه</th><th>الموقع والشركة</th><th>تاريخ الاستحقاق</th><th>المتبقي</th><th><span class="sr">فتح</span></th></tr></thead>
          <tbody>${raw(followRows(follow.slice(0, PAGE_ROWS), siteName, compName))}</tbody>
        </table>
        <div class="fmore">${moreRows(Math.min(PAGE_ROWS, follow.length), follow.length)}</div>
      </div>` : html`<div class="empty soft"><p>لا توجد مهام متابعة لهذا الاختيار. كل الوثائق سارية والزيت في موعده.</p></div>`)}
    </section>`;
  body.removeAttribute('aria-busy');
  const pager = { limit: PAGE_ROWS }, tb = $('.followups tbody', body), more = $('.followups .fmore', body);
  if (tb) bindMore(more, pager, () => { tb.innerHTML = followRows(follow.slice(0, pager.limit), siteName, compName); more.innerHTML = String(moreRows(Math.min(pager.limit, follow.length), follow.length)); });
}

// صفوف جدول المتابعة
function followRows(list, siteName, compName) {
  return list.map((r) => html`
            <tr class="sev-${r.severity}">
              <td data-l="السيارة أو الموظف"><b>${subject(r.subject_label)}</b></td>
              <td data-l="نوع التنبيه">${label('alert_type', r.alert_type)}</td>
              <td data-l="الموقع والشركة">${siteName(r.site_id)}<small>${compName(r.company_id)}</small></td>
              <td data-l="تاريخ الاستحقاق" class="num ${r.due_date ? '' : 'nodate'}">${date(r.due_date)}</td>
              <td data-l="المتبقي" class="remain">${statusText(r)}</td>
              <td class="act"><a class="btn btn-sm" href="#/${{ vehicle: 'vehicles', employee: 'employees', maintenance_request: 'requests' }[r.subject_type]}/${r.subject_id}">فتح السجل</a></td>
            </tr>`).join('');
}
