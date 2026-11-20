// 1.36: صفحة «الصيانة التنبؤية»: توقع موعد الزيت والكفرات والبطارية، الأعطال المتكررة، والمصاريف الزايدة لكل سيارة.
// قراءة فقط (لا كتابة في قاعدة البيانات). الحساب في web/js/predict.js.
import * as api from '../api.js';
import { html, raw, icon } from '../ui.js';
import { num, date, todayISO, errorText } from '../fmt.js';
import { analyze, RULES } from '../predict.js';

export async function loadPredictions() {
  const [vehicles, oil, costs, readings] = await Promise.all([
    api.get('vehicles', { select: 'id,code,plate_no,make,vehicle_type,odometer,odometer_updated_at,oil_interval_km', deleted_at: 'is.null' }),
    api.get('oil_changes', { select: 'vehicle_id,change_date,odometer,interval_km', deleted_at: 'is.null' }).catch(() => []),
    api.get('cost_lines', { select: 'vehicle_id,category,line_date,description,notes,quantity,amount', is_active: 'is.true' }).catch(() => []),
    api.get('odometer_readings', { select: 'vehicle_id,reading,read_at' }).catch(() => []),
  ]);
  return analyze({ vehicles, oil, costs, readings, today: todayISO() });
}

const LV = { bad: 'عاجل', warn: 'قريب', ok: 'سليم' };
const BASIS = {
  km: 'من الممشى ومعدل مشي السيارة',
  'fleet-rate': 'من الممشى ومتوسط مشي سيارات الأسطول',
  'own-gap': 'من متوسط المدة بين غيارات السيارة',
  'fleet-gap': 'تقريبي: آخر غيار + متوسط الأسطول (لا يوجد ممشى)',
  age: 'تقريبي بعمر الكفر (سنتان)',
};
const plate = (r) => html`<a class="plate" href="#/vehicles/${r.v.id}?tab=costs">${r.v.plate_no || r.v.code}</a>`;
const left = (d) => (d == null ? '—' : d < 0 ? html`<b class="pm-bad">متأخر <span class="num">${num(-d)}</span> يوم</b>` : d === 0 ? 'اليوم' : html`بعد <span class="num">${num(d)}</span> يوم`);
const pill = (lv) => html`<span class="pm-pill pm-${lv}">${LV[lv]}</span>`;

export async function renderPredict(el) {
  el.innerHTML = '<div class="loading">جارٍ حساب التوقعات…</div>';
  let res;
  try { res = await loadPredictions(); } catch (e) { el.innerHTML = html`<div class="form-error">${errorText(e)}</div>`; return; }
  const rows = res.rows;
  const alerts = rows.flatMap((r) => r.alerts.map((a) => ({ ...a, r }))).sort((a, b) => (a.level === 'bad' ? 0 : 1) - (b.level === 'bad' ? 0 : 1));
  const oilRows = rows.filter((r) => r.oil).sort((a, b) => (a.oil.daysLeft ?? 9e9) - (b.oil.daysLeft ?? 9e9));
  const tireRows = rows.filter((r) => (r.tires && (r.tires.lastDate || r.tires.punctures)) || r.battery);
  const faultRows = rows.filter((r) => r.faults.length);
  const costRows = rows.filter((r) => r.cost.last90 || r.cost.prev90).sort((a, b) => b.cost.last90 - a.cost.last90);
  const noData = rows.filter((r) => !r.oil);
  const count = (lv) => alerts.filter((a) => a.level === lv).length;

  el.innerHTML = html`
    <div class="page-head">
      <div><h1>الصيانة التنبؤية</h1>
      <p class="muted small">توقعات من سجلات الزيت والكفرات والصيانة الموجودة (بدون حساسات). كل رقم تقديري ويدق أكثر كل ما زادت البيانات والممشى المسجل.</p></div>
    </div>
    <section class="cost-kpis pm-kpis" data-pm-kpis>
      <div class="panel cost-kpi pm-k-bad"><span>تنبيهات عاجلة</span><b class="num" data-pm-bad>${num(count('bad'))}</b><small>متأخر أو تكرر كثير</small></div>
      <div class="panel cost-kpi pm-k-warn"><span>تنبيهات قريبة</span><b class="num" data-pm-warn>${num(count('warn'))}</b><small>خلال أسبوعين أو تحتاج متابعة</small></div>
      <div class="panel cost-kpi"><span>أعطال متكررة</span><b class="num" data-pm-faults>${num(faultRows.length)}</b><small>سيارة</small></div>
      <div class="panel cost-kpi"><span>مصاريف زايدة</span><b class="num" data-pm-cost>${num(rows.filter((r) => r.cost.flag === 'rising' || r.cost.flag === 'high').length)}</b><small>سيارة · آخر 3 أشهر</small></div>
    </section>

    <section class="panel pm-sec" data-pm-alerts>
      <header><h2>${icon('bell')} التنبيهات</h2><span class="count num">${alerts.length}</span></header>
      ${raw(alerts.length ? html`<ul class="pm-alerts">${raw(alerts.map((a) => html`<li class="pm-${a.level}" data-pm-alert="${a.kind}">${raw(pill(a.level))}${raw(plate(a.r))}<span>${a.text}</span></li>`).join(''))}</ul>` : '<p class="muted pad">لا توجد تنبيهات الآن.</p>')}
    </section>

    <section class="panel pm-sec" data-pm-oil>
      <header><h2>${icon('oil')} موعد تغيير الزيت المتوقع</h2><span class="count num">${oilRows.length}</span></header>
      ${raw(oilRows.length ? html`<div class="table-wrap"><table class="rtable pm-table"><thead><tr><th>السيارة</th><th>آخر غيار</th><th>الممشى الحالي (تقريبي)</th><th>الغيار القادم</th><th>المتبقي</th><th>طريقة التوقع</th></tr></thead><tbody>
        ${raw(oilRows.map((r) => { const o = r.oil; return html`<tr class="pm-row-${o.level}" data-pm-oil-row="${r.v.id}"><td data-l="السيارة">${raw(plate(r))}</td>
          <td data-l="آخر غيار"><span class="num">${date(o.lastDate)}</span>${raw(o.lastKm ? html`<br><small class="muted num">${num(o.lastKm)} كم</small>` : '')}</td>
          <td data-l="الممشى الحالي (تقريبي)" class="num">${r.curKm ? num(r.curKm) : '—'}${raw(r.rate ? html`<br><small class="muted">≈ <span class="num">${num(r.rate)}</span> كم/يوم</small>` : '')}</td>
          <td data-l="الغيار القادم"><span class="num">${date(o.dueDate)}</span>${raw(o.dueKm ? html`<br><small class="muted"><span class="num">${num(o.dueKm)}</span> كم${raw(o.ownInterval ? html` (عادتكم كل <span class="num">${num(o.interval)}</span>)` : '')}</small>` : '')}</td>
          <td data-l="المتبقي">${raw(left(o.daysLeft))}${raw(o.leftKm != null ? html`<br><small class="muted">${o.leftKm < 0 ? 'تعدّى بـ' : 'باقي'} <span class="num">${num(Math.abs(o.leftKm))}</span> كم</small>` : '')}</td>
          <td data-l="طريقة التوقع" class="small muted">${BASIS[o.basis] || '—'}</td></tr>`; }).join(''))}
      </tbody></table></div>` : '<p class="muted pad">لا توجد سجلات تغيير زيت.</p>')}
    </section>

    <section class="panel pm-sec" data-pm-tires>
      <header><h2>${icon('gauge')} الكفرات والبطاريات</h2><span class="count num">${tireRows.length}</span></header>
      ${raw(tireRows.length ? html`<div class="table-wrap"><table class="rtable pm-table"><thead><tr><th>السيارة</th><th>آخر شراء كفرات</th><th>التغيير المتوقع</th><th>بنشر آخر 3 أشهر</th><th>البطارية</th></tr></thead><tbody>
        ${raw(tireRows.map((r) => { const t = r.tires || {}; const b = r.battery; return html`<tr data-pm-tire-row="${r.v.id}"><td data-l="السيارة">${raw(plate(r))}</td>
          <td data-l="آخر شراء كفرات">${raw(t.lastDate ? html`<span class="num">${date(t.lastDate)}</span><br><small class="muted"><span class="num">${num(t.qty)}</span> ${t.qty > 1 ? 'كفرات' : 'كفر'}${t.used ? ' مستعملة' : ''}${t.partial ? ' (تغيير جزئي)' : ''}</small>` : '<span class="muted">لا يوجد شراء مسجل</span>')}</td>
          <td data-l="التغيير المتوقع">${raw(t.dueDate ? html`<span class="num">${date(t.dueDate)}</span><br><small class="muted">${BASIS[t.basis]}</small>` : '—')}</td>
          <td data-l="بنشر آخر 3 أشهر">${raw(t.punctures ? html`<b class="num ${t.punctures >= RULES.punctureMin ? 'pm-warn-t' : ''}">${num(t.punctures)}</b>` : '<span class="muted">0</span>')}</td>
          <td data-l="البطارية">${raw(b ? html`آخر تغيير <span class="num">${date(b.lastDate)}</span><br><small class="muted">المتوقع <span class="num">${date(b.dueDate)}</span></small>` : '—')}</td></tr>`; }).join(''))}
      </tbody></table></div>` : '<p class="muted pad">لا توجد سجلات كفرات أو بطاريات.</p>')}
    </section>

    <section class="panel pm-sec" data-pm-faults-list>
      <header><h2>${icon('wrench')} الأعطال المتكررة (آخر 6 أشهر)</h2><span class="count num">${faultRows.length}</span></header>
      <p class="muted small pad-x">نفس العطل رجع بعد أكثر من ${RULES.episodeGap} يوم. شراء القطع وتركيبها لنفس العطل يُحسب مرة وحدة.</p>
      ${raw(faultRows.length ? html`<ul class="pm-faults">${raw(faultRows.map((r) => html`<li data-pm-fault-row="${r.v.id}">${raw(plate(r))}<div>${raw(r.faults.map((f) => html`<p><b>${f.name}</b>: <span class="num">${f.times}</span> مرات (${raw(f.dates.map((d) => html`<span class="num">${date(d)}</span>`).join('، '))}) · <span class="num">${num(f.cost, 2)}</span> ر.س</p>`).join(''))}</div></li>`).join(''))}</ul>` : '<p class="muted pad">ما فيه أعطال متكررة واضحة من البيانات الحالية.</p>')}
    </section>

    <section class="panel pm-sec" data-pm-costs>
      <header><h2>${icon('chart')} المصاريف: آخر 3 أشهر مقابل الـ3 اللي قبلها</h2><span class="count num">${costRows.length}</span></header>
      <p class="muted small pad-x">الصيانة والكفرات والبطاريات (بدون الزيت). متوسط السيارة في الأسطول آخر 3 أشهر: <span class="num">${num(res.fleetLast || 0, 2)}</span> ر.س.</p>
      ${raw(costRows.length ? html`<div class="table-wrap"><table class="rtable pm-table"><thead><tr><th>السيارة</th><th>آخر 3 أشهر</th><th>الـ3 أشهر السابقة</th><th>التغير</th><th>ملاحظة</th></tr></thead><tbody>
        ${raw(costRows.map((r) => { const c = r.cost; return html`<tr data-pm-cost-row="${r.v.id}" class="${c.flag === 'rising' || c.flag === 'high' ? 'pm-row-warn' : ''}"><td data-l="السيارة">${raw(plate(r))}</td>
          <td data-l="آخر 3 أشهر" class="num strong">${num(c.last90, 2)}</td><td data-l="الـ3 أشهر السابقة" class="num">${num(c.prev90, 2)}</td>
          <td data-l="التغير" class="num">${c.change == null ? '—' : `${c.change > 0 ? '+' : ''}${Math.round(c.change * 100)}%`}</td>
          <td data-l="ملاحظة" class="small">${c.flag === 'rising' ? 'زادت المصاريف' : c.flag === 'high' ? 'أعلى بكثير من باقي السيارات' : c.flag === 'accident' ? html`<span class="muted">أغلبها إصلاح حادث</span>` : ''}</td></tr>`; }).join(''))}
      </tbody></table></div>` : '<p class="muted pad">لا توجد مصاريف مسجلة.</p>')}
    </section>

    ${raw(noData.length ? html`<details class="panel pm-sec pm-nodata" data-pm-nodata><summary>سيارات بدون سجل تغيير زيت (<span class="num">${noData.length}</span>) — ما نقدر نتوقع لها</summary>
      <p class="muted small">سجّل لها تغيير الزيت مع الممشى في ملف Excel (ورقة غيار_الزيت) أو من صفحة «تغيير الزيت» وتطلع توقعاتها هنا.</p>
      <p class="pm-plates">${raw(noData.map((r) => plate(r)).join(' '))}</p></details>` : '')}`;
}
