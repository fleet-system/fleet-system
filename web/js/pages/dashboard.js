import * as api from '../api.js';
import { html, raw, icon, $, PAGE_ROWS, moreRows, bindMore } from '../ui.js';
import { num, money, date, label, todayParts, statusText, toWestern } from '../fmt.js';
import { backupReminder } from './settings.js';
import { PLACES, placeOf } from './vehicles.js';

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
  // تحديث مباشر: عند الرجوع إلى التطبيق أو الصفحة تُعاد قراءة الأرقام من قاعدة البيانات
  liveRefresh = () => { const b = $('#dash-body', el); if (b && document.contains(b) && !document.hidden) loadBody(b, lookups); };
}
let liveRefresh = null;
document.addEventListener('visibilitychange', () => { if (!document.hidden && liveRefresh && location.hash.replace(/\?.*/, '') in { '': 1, '#/': 1, '#/dashboard': 1 }) liveRefresh(); });

async function loadBody(body, { companies, sites }) {
  body.setAttribute('aria-busy', 'true');
  const filt = {};
  if (state.company) filt.company_id = `eq.${state.company}`;
  if (state.site) filt.site_id = `eq.${state.site}`;
  const vfilt = {};
  if (state.company) vfilt.site_company_id = `eq.${state.company}`;
  if (state.site) vfilt.site_id = `eq.${state.site}`;
  const [s, follow, vrows, vdocRows] = await Promise.all([
    api.rpc('dashboard_stats', { p_company: state.company || null, p_site: state.site || null, p_year: state.year, p_month: state.month }),
    api.get('v_followups', { select: '*', ...filt }),
    api.get('v_vehicles_overview', { select: 'id,code,plate_no,op_status,location_status', ...vfilt }).catch(() => null),
    api.get('v_document_status', { select: 'owner_id,doc_type,expiry_date,days_left', owner_type: 'eq.vehicle', doc_type: `in.(${VDOC_TYPES.join(',')})` }).catch(() => null),
  ]);
  const vdocs = vehicleDocs(vrows, vdocRows);
  // توزيع السيارات: داخل/خارج المواقع للسيارات التي تعمل فقط، والمتوقفة والمتضررة والتي في الورشة كلٌّ في خانته (المجموع = إجمالي السيارات)
  const place = vrows ? Object.fromEntries(PLACES.map(([k]) => [k, vrows.filter((v) => placeOf(v) === k).length])) : { inside: s.vehicles_inside, outside: s.vehicles_outside, stopped: s.vehicles_stopped, maintenance: s.vehicles_maintenance, accident: s.vehicles_accident, workshop: s.vehicles_in_workshop };
  const siteName = (id) => sites.find((x) => x.id === id)?.name || '—';
  const compName = (id) => companies.find((x) => x.id === id)?.name || '—';
  follow.sort((a, b) => a.severity - b.severity || (a.days_left ?? a.km_left ?? 0) - (b.days_left ?? b.km_left ?? 0));

  const total = s.vehicles_total || 0;
  const placeTotal = PLACES.reduce((t, [k]) => t + (place[k] || 0), 0);
  const pct = (n) => (placeTotal ? `${Math.round((n / placeTotal) * 100)}%` : '0%');
  const period = `${state.year}/${String(state.month).padStart(2, '0')}`;
  const monthTotal = (+s.cost_maintenance_month) + (+s.cost_oil_month) + (+s.cost_accidents_month) + (+s.cost_housing_food_month);

  body.innerHTML = html`
    <section class="panels">
      <article class="panel fleet" aria-labelledby="p-fleet">
        <header><h2 id="p-fleet">السيارات</h2><a href="#/vehicles" class="link">عرض السيارات</a></header>
        <div class="big"><span class="num">${num(total)}</span><small>إجمالي السيارات</small></div>
        <div class="segbar fleet-bar" role="group" aria-label="توزيع السيارات (اضغط على لون لعرض تفاصيله)">
          ${raw(PLACES.map(([k, t]) => (place[k] ? html`<button type="button" class="seg pl-${k}" data-pick="${k}" style="flex:${place[k]}" title="${t}: ${num(place[k])} (${pct(place[k])})" aria-label="${t}: ${num(place[k])}"></button>` : '')).join('') || '<span class="seg empty-seg" style="flex:1"></span>')}
        </div>
        <p class="pick-info muted small" data-pick-info aria-live="polite">اضغط على أي لون أو خانة لعرض تفاصيلها.</p>
        <ul class="kv three five" data-fleet-place>
          ${raw(PLACES.map(([k, t]) => html`<li data-k="${k}"><button type="button" class="place-btn" data-pick="${k}"><span><i class="dot pl-${k}"></i>${t}</span><b class="num">${num(place[k])}</b><small class="muted num">${pct(place[k])}</small></button></li>`).join(''))}
        </ul>
      </article>
${raw(vdocs ? vdocsPanel(vdocs) : '')}

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
  // اختيار لون/خانة: يبرز الجزء نفسه في الشريط والخانة ويعرض العدد والنسبة، والضغط مرة ثانية يلغي الاختيار
  const fleet = body.querySelector('.panel.fleet');
  fleet.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    const k = b.dataset.pick; const again = fleet.dataset.picked === k;
    fleet.dataset.picked = again ? '' : k; fleet.classList.toggle('has-pick', !again);
    fleet.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('on', !again && x.dataset.pick === k));
    const name = PLACES.find(([x]) => x === k)[1];
    fleet.querySelector('[data-pick-info]').innerHTML = again ? 'اضغط على أي لون أو خانة لعرض تفاصيلها.'
      : html`<i class="dot pl-${k}"></i> <b>${name}</b>: <span class="num">${num(place[k])}</span> من <span class="num">${num(placeTotal)}</span> سيارة (<span class="num">${pct(place[k])}</span>)
        ${raw(place[k] ? html`<a class="link" data-place-link href="#/vehicles?${new URLSearchParams({ place: k, ...(state.site ? { site: state.site } : {}), ...(state.company ? { company: state.company } : {}) })}">عرض بطاقات هذه السيارات ←</a>` : '')}`;
  });
  if (vdocs) bindVdocs(body.querySelector('[data-vdocs]'), vdocs);
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

// ---------------------------------------------------------------------
// بطاقة «وثائق السيارات»: رخصة السير والفحص الدوري والتأمين من بطاقات السيارات (تتحدث مع أي تعديل للتاريخ)
// ---------------------------------------------------------------------
const VDOC_TYPES = ['registration', 'periodic_inspection', 'insurance'];
const VDOC_NAME = { registration: 'رخصة السير', periodic_inspection: 'الفحص الدوري', insurance: 'التأمين' };
const SOON_DAYS = 30;
function vehicleDocs(vrows, docRows) {
  if (!vrows || !docRows) return null;
  const byId = new Map(vrows.map((v) => [v.id, { ...v, place: placeOf(v), docs: [] }]));
  for (const d of docRows) { const v = byId.get(d.owner_id); if (v && d.expiry_date && d.days_left != null) v.docs.push(d); }
  const items = [...byId.values()].flatMap((v) => v.docs.map((d) => ({ v, d })));
  const box = Object.fromEntries(PLACES.map(([k]) => [k, {
    expired: items.filter((x) => x.v.place === k && x.d.days_left < 0),
    soon: items.filter((x) => x.v.place === k && x.d.days_left >= 0 && x.d.days_left <= SOON_DAYS),
  }]));
  // أقرب وثيقة لكل سيارة خلال 30 يوماً (قبل أن تنتهي)، مرتبة: الأقرب أولاً
  const nearest = [...byId.values()].map((v) => ({ v, d: v.docs.filter((d) => d.days_left >= 0 && d.days_left <= SOON_DAYS).sort((a, b) => a.days_left - b.days_left)[0] }))
    .filter((x) => x.d).sort((a, b) => a.d.days_left - b.d.days_left || String(a.v.code).localeCompare(String(b.v.code)));
  // الرسم: لكل نوع وثيقة عدد المنتهية / خلال 30 يوماً / السارية / غير المحددة (سيارة بلا تاريخ)
  const nVeh = byId.size;
  const chart = VDOC_TYPES.map((t) => {
    const ds = items.filter((x) => x.d.doc_type === t).map((x) => x.d.days_left);
    const withDate = new Set(items.filter((x) => x.d.doc_type === t).map((x) => x.v.id)).size;
    return { t, expired: ds.filter((n) => n < 0).length, soon: ds.filter((n) => n >= 0 && n <= SOON_DAYS).length, valid: ds.filter((n) => n > SOON_DAYS).length, none: Math.max(0, nVeh - withDate) };
  });
  return { box, nearest, chart, expiredAll: items.filter((x) => x.d.days_left < 0).length };
}
const docRow = ({ v, d }) => html`<li><a href="#/vehicles/${v.id}?tab=docs" class="vdoc-row">
  <i class="dot pl-${v.place}" title="${PLACES.find(([k]) => k === v.place)[1]}"></i>
  <span class="vdoc-car"><b class="plate">${v.plate_no}</b> <small class="muted">${v.code}</small></span>
  <span class="vdoc-type">${VDOC_NAME[d.doc_type]}</span>
  <span class="num vdoc-date">${date(d.expiry_date)}</span>
  <span class="tag ${d.days_left < 0 ? 't-expired' : 't-expiring'} num">${d.days_left < 0 ? `منتهية منذ ${num(-d.days_left)} يوم` : d.days_left === 0 ? 'تنتهي اليوم' : `باقي ${num(d.days_left)} يوم`}</span></a></li>`;
function vdocsList(vd, k) {
  if (!k) {
    return html`<h3 class="vdoc-h">أقرب الوثائق انتهاءً — خلال ${num(SOON_DAYS)} يوماً <small class="muted">(سيارة واحدة = أقرب وثيقة لها)</small></h3>
      ${raw(vd.nearest.length ? html`<ul class="vdoc-list" data-vdoc-soon>${raw(vd.nearest.map(docRow).join(''))}</ul>` : html`<p class="muted small">لا توجد وثيقة تنتهي خلال ${num(SOON_DAYS)} يوماً.</p>`)}`;
  }
  const name = PLACES.find(([x]) => x === k)[1]; const b = vd.box[k];
  const sort = (arr) => [...arr].sort((x, y) => x.d.days_left - y.d.days_left);
  return html`<h3 class="vdoc-h"><i class="dot pl-${k}"></i> ${name}: الوثائق المنتهية (${num(b.expired.length)})</h3>
    ${raw(b.expired.length ? html`<ul class="vdoc-list" data-vdoc-expired>${raw(sort(b.expired).map(docRow).join(''))}</ul>` : '<p class="muted small">لا توجد وثائق منتهية.</p>')}
    <h3 class="vdoc-h">${name}: تنتهي خلال ${num(SOON_DAYS)} يوماً (${num(b.soon.length)})</h3>
    ${raw(b.soon.length ? html`<ul class="vdoc-list">${raw(sort(b.soon).map(docRow).join(''))}</ul>` : '<p class="muted small">لا توجد.</p>')}`;
}
const VDOC_PARTS = [['expired', 'منتهية'], ['soon', `تنتهي خلال ${SOON_DAYS} يوماً`], ['valid', 'سارية'], ['none', 'غير محددة']];
function vdocsChart(rows) {
  return html`<div class="vdoc-chart" data-vdoc-chart role="img" aria-label="حالة وثائق السيارات حسب النوع">
    ${raw(rows.map((r) => { const tot = VDOC_PARTS.reduce((a, [k]) => a + r[k], 0) || 1; return html`<div class="vc-row" data-type="${r.t}">
      <span class="vc-label">${VDOC_NAME[r.t]}</span>
      <div class="vc-bar">${raw(VDOC_PARTS.map(([k, t]) => (r[k] ? html`<span class="vc-seg vc-${k}" data-part="${k}" style="flex:${r[k]}" title="${VDOC_NAME[r.t]} — ${t}: ${num(r[k])}">${r[k] / tot >= 0.12 ? num(r[k]) : ''}</span>` : '')).join(''))}</div>
      <b class="vc-bad num ${r.expired ? 'bad-text' : 'muted'}" title="منتهية">${num(r.expired)}</b></div>`; }).join(''))}
    <ul class="vc-legend">${raw(VDOC_PARTS.map(([k, t]) => html`<li><i class="dot vc-${k}"></i>${t}</li>`).join(''))}</ul>
  </div>`;
}
function vdocsPanel(vd) {
  return html`<article class="panel vdocs" data-vdocs aria-labelledby="p-vdocs">
    <header><h2 id="p-vdocs">وثائق السيارات</h2><a href="#/documents" class="link">كل الوثائق</a></header>
    <p class="muted small vdoc-sub">رخصة السير · الفحص الدوري · التأمين — من بطاقات السيارات مباشرة. اضغط على خانة لعرض سياراتها.</p>
    ${raw(vdocsChart(vd.chart))}
    <ul class="kv three five vdoc-boxes">${raw(PLACES.map(([k, t]) => html`<li data-k="${k}"><button type="button" class="place-btn" data-dpick="${k}">
      <span><i class="dot pl-${k}"></i>${t}</span>
      <b class="num ${vd.box[k].expired.length ? 'bad-text' : ''}">${num(vd.box[k].expired.length)}</b><small class="muted">وثائق منتهية</small>
      ${raw(vd.box[k].soon.length ? html`<small class="tag t-expiring num">${num(vd.box[k].soon.length)} خلال ${num(SOON_DAYS)} يوماً</small>` : '')}</button></li>`).join(''))}</ul>
    <div data-vdocs-list>${raw(vdocsList(vd, ''))}</div>
  </article>`;
}
function bindVdocs(panel, vd) {
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dpick]'); if (!b) return;
    const k = b.dataset.dpick; const again = panel.dataset.picked === k;
    panel.dataset.picked = again ? '' : k; panel.classList.toggle('has-pick', !again);
    panel.querySelectorAll('[data-dpick]').forEach((x) => x.classList.toggle('on', !again && x.dataset.dpick === k));
    panel.querySelector('[data-vdocs-list]').innerHTML = vdocsList(vd, again ? '' : k);
  });
}
