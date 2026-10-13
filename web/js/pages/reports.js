// التقارير: 15 تقريراً بفلاتر، رسوم بيانية، جدول، تصدير Excel، وطباعة
import * as api from '../api.js';
import * as data from '../data.js';
import { html, raw, icon, toast, $, esc } from '../ui.js';
import { label, LABELS, num, money, date, dateTime, todayISO, todayParts, parseDate, errorText } from '../fmt.js';
import { writeXlsx, saveBlob } from '../xlsx.js';

// فئات المصروفات بترتيب ثابت (اللون يتبع الفئة، لا ترتيبها) — لوحة ألوان مُتحقق منها لعمى الألوان
const CATS = [['oil_change', 'تغيير الزيت'], ['maintenance', 'الصيانة'], ['accident', 'الحوادث'], ['housing_maintenance', 'صيانة السكن'], ['food_supply', 'توريد الطعام']];
const CAT_LABEL = Object.fromEntries(CATS);

const REPORTS = [
  ['vehicles_status', 'السيارات حسب الحالة', 'fleet'], ['vehicles_owner', 'السيارات حسب الشركة المالكة', 'fleet'], ['vehicles_site', 'السيارات حسب الموقع', 'fleet'],
  ['documents', 'الوثائق المنتهية والقريبة من الانتهاء', 'fleet'], ['authorizations', 'التفويضات (سارية، منتهية، غير متوفرة)', 'fleet'],
  ['oil', 'تغيير الزيت وتكاليفه', 'ops'], ['maintenance', 'الصيانة الدورية وتكاليفها', 'ops'], ['accidents', 'الحوادث وتكاليف إصلاحها', 'ops'], ['handovers', 'نماذج استلام وتسليم السيارات', 'ops'],
  ['housing', 'صيانة سكن العمال', 'camp'], ['food', 'توريد الطعام', 'camp'],
  ['expenses', 'المصروفات الشهرية والسنوية', 'cost'], ['cost_vehicle', 'إجمالي تكاليف كل سيارة', 'cost'], ['cost_site', 'إجمالي تكاليف كل موقع', 'cost'], ['cost_company', 'إجمالي تكاليف كل شركة', 'cost'],
];
const GROUPS = { fleet: 'السيارات والوثائق', ops: 'العمليات', camp: 'السكن والطعام', cost: 'التكاليف' };

const { y: Y, m: M } = todayParts();
const st = { report: 'expenses', company: '', site: '', vehicle: '', employee: '', from: `${Y}-01-01`, to: todayISO() };

// ---------------------------------------------------------------------
// رسوم بيانية SVG
// ---------------------------------------------------------------------
function hbars(items, { fmt = (v) => num(v), title }) {
  // أعمدة أفقية لسلسلة واحدة (أسماء طويلة بالعربي)
  if (!items.length) return '';
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  const rowH = 30, w = 100;
  return html`<figure class="chart" role="img" aria-label="${title}">
    <div class="hbars">${raw(items.map((i) => html`<div class="hb" data-tip="${i.label}: ${fmt(i.value)}" tabindex="0">
      <span class="hb-l">${i.label}</span><span class="hb-track"><span class="hb-bar" style="width:${Math.max(0.5, (i.value / max) * w)}%"></span></span><span class="hb-v num">${fmt(i.value)}</span></div>`).join(''))}</div>
  </figure>`;
}

function stacked(months, series, { title }) {
  // أعمدة عمودية مكدّسة: شهر × فئة
  const totals = months.map((m) => series.reduce((s, sr) => s + (sr.values[m] || 0), 0));
  const max = Math.max(...totals, 0) || 1;
  const H = 180, bw = Math.max(14, Math.min(40, 560 / Math.max(months.length, 1) - 10)), gap = 10;
  const W = months.length * (bw + gap) + gap;
  const bars = months.map((m, i) => {
    let y = H; const x = W - (gap + i * (bw + gap)) - bw; // من اليمين لليسار
    const segs = series.map((sr, si) => {
      const v = sr.values[m] || 0; if (!v) return '';
      const h = Math.max(1, (v / max) * (H - 10)); y -= h;
      return `<rect x="${x}" y="${y + 1}" width="${bw}" height="${Math.max(0, h - 2)}" rx="2" class="s${si + 1}"></rect>`;
    }).join('');
    return `<g class="col" data-tip="${esc(`${m.replace('-', '/')}: ${money(totals[i])}` + series.map((sr) => (sr.values[m] ? ` | ${sr.name}: ${money(sr.values[m])}` : '')).join(''))}">${segs}<rect x="${x - gap / 2}" y="0" width="${bw + gap}" height="${H}" class="hit"></rect><text x="${x + bw / 2}" y="${H + 14}" text-anchor="middle" class="ax">${m.slice(5)}/${m.slice(2, 4)}</text></g>`;
  }).join('');
  return html`<figure class="chart" role="img" aria-label="${title}">
    <div class="legend-row">${raw(series.map((sr, i) => html`<span><i class="sw s${i + 1}"></i>${sr.name}</span>`).join(''))}</div>
    <div class="svg-scroll"><svg viewBox="0 0 ${W} ${H + 20}" width="${W}" height="${H + 20}" class="stack">${raw(`<line x1="0" x2="${W}" y1="${H}" y2="${H}" class="base"></line>`)}${raw(bars)}</svg></div>
  </figure>`;
}

// ---------------------------------------------------------------------
// تحميل البيانات حسب الفلاتر
// ---------------------------------------------------------------------
const inRange = (d) => d && d >= st.from && d <= st.to;
const ridDate = (ts) => dateTime(ts).replace(/[⁦⁩]/g, '').slice(0, 10).replaceAll('/', '-');
const siteOk = (siteId, companyId) => (!st.site || siteId === st.site) && (!st.company || (companyId ?? data.siteCompany(siteId)) === st.company);
const vehOk = (vid) => !st.vehicle || vid === st.vehicle;

async function build(key) {
  const T = (columns, rows) => ({ columns, rows });
  const V = () => api.get('v_vehicles_overview', { select: '*', order: 'code' }).then((rs) => rs.filter((v) => siteOk(v.site_id, v.site_company_id) && vehOk(v.id) && (!st.employee || v.current_driver_id === st.employee)));
  const vcols = [
    { header: 'الرقم الداخلي', type: 'text', value: (r) => r.code }, { header: 'رقم اللوحة', type: 'text', value: (r) => r.plate_no },
    { header: 'النوع', type: 'text', value: (r) => [r.vehicle_type, r.make, r.model].filter(Boolean).join(' ') }, { header: 'الشركة المالكة', type: 'text', value: (r) => r.owner_company_name },
    { header: 'الموقع', type: 'text', value: (r) => r.site_name }, { header: 'السائق', type: 'text', value: (r) => r.driver_name },
    { header: 'الحالة التشغيلية', type: 'text', value: (r) => label('op_status', r.op_status) }, { header: 'موقع السيارة', type: 'text', value: (r) => label('location_status', r.location_status) },
    { header: 'العداد', type: 'int', value: (r) => r.odometer },
  ];
  const groupCount = (rows, keyFn, labelFn) => { const m = new Map(); rows.forEach((r) => { const k = keyFn(r); m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].map(([k, v]) => ({ label: labelFn(k), value: v })).sort((a, b) => b.value - a.value); };
  const groupSum = (rows, keyFn, labelFn, valFn = (r) => Number(r.total || 0)) => { const m = new Map(); rows.forEach((r) => { const k = keyFn(r); m.set(k, Math.round(((m.get(k) || 0) + valFn(r)) * 100) / 100); }); return [...m.entries()].map(([k, v]) => ({ key: k, label: labelFn(k), value: v })).sort((a, b) => b.value - a.value); };
  const sum = (rows, f = (r) => r.total) => rows.reduce((s, r) => s + Number(f(r) || 0), 0);

  switch (key) {
    case 'vehicles_status': { const r = await V(); return { chart: hbars(groupCount(r, (x) => x.op_status, (k) => label('op_status', k)), { title: 'السيارات حسب الحالة' }), stats: [['إجمالي السيارات', num(r.length)]], ...T(vcols, r.sort((a, b) => a.op_status.localeCompare(b.op_status))) }; }
    case 'vehicles_owner': { const r = await V(); return { chart: hbars(groupCount(r, (x) => x.owner_company_name, (k) => k), { title: 'السيارات حسب الشركة المالكة' }), stats: [['إجمالي السيارات', num(r.length)]], ...T(vcols, r.sort((a, b) => (a.owner_company_name || '').localeCompare(b.owner_company_name || ''))) }; }
    case 'vehicles_site': { const r = await V(); return { chart: hbars(groupCount(r, (x) => x.site_name || 'بلا موقع', (k) => k), { title: 'السيارات حسب الموقع' }), stats: [['إجمالي السيارات', num(r.length)]], ...T(vcols, r.sort((a, b) => (a.site_name || '').localeCompare(b.site_name || ''))) }; }
    case 'documents': {
      const r = (await api.get('v_document_status', { select: '*' })).filter((d) => ['expired', 'expiring', 'no_date', 'missing', 'not_authorized'].includes(d.status) && siteOk(d.site_id, d.company_id) && (!st.vehicle || d.owner_id === st.vehicle) && (!st.employee || d.owner_id === st.employee))
        .sort((a, b) => (a.days_left ?? -1e9) - (b.days_left ?? -1e9));
      return { chart: hbars(groupCount(r, (x) => x.status, (k) => label('doc_status', k)), { title: 'الوثائق حسب الحالة' }), stats: [['منتهية', num(r.filter((x) => x.status === 'expired').length)], ['تقترب من الانتهاء', num(r.filter((x) => x.status === 'expiring').length)]],
        ...T([{ header: 'السيارة أو الموظف', type: 'text', value: (x) => x.subject_label }, { header: 'الوثيقة', type: 'text', value: (x) => label('doc_type', x.doc_type) }, { header: 'الانتهاء', type: 'date', value: (x) => x.expiry_date }, { header: 'الأيام المتبقية', type: 'int', value: (x) => x.days_left }, { header: 'الحالة', type: 'text', value: (x) => (x.doc_type === 'authorization' ? label('auth_status', x.status) : label('doc_status', x.status)) }, { header: 'الموقع', type: 'text', value: (x) => (x.site_id ? data.siteName(x.site_id) : '') }], r) };
    }
    case 'authorizations': {
      const r = (await V()).filter((v) => v.current_driver_id);
      return { chart: hbars(groupCount(r, (x) => x.authorization_status, (k) => label('auth_status', k)), { title: 'حالة تفويض السائقين الحاليين' }), stats: [['سيارات لها سائق', num(r.length)], ['تفويض ساري', num(r.filter((x) => x.authorization_status === 'valid').length)]],
        ...T([{ header: 'السيارة', type: 'text', value: (x) => `${x.plate_no} (${x.code})` }, { header: 'السائق', type: 'text', value: (x) => x.driver_name }, { header: 'حالة التفويض', type: 'text', value: (x) => label('auth_status', x.authorization_status) }, { header: 'انتهاء التفويض', type: 'date', value: (x) => x.authorization_expiry }, { header: 'الشركة المالكة', type: 'text', value: (x) => x.owner_company_name }, { header: 'الموقع', type: 'text', value: (x) => x.site_name }], r) };
    }
    case 'oil': {
      const r = (await api.get('oil_changes', { select: '*', deleted_at: 'is.null', order: 'change_date.desc' })).filter((x) => inRange(x.change_date) && siteOk(x.site_id) && vehOk(x.vehicle_id));
      return { chart: hbars(groupSum(r, (x) => x.site_id, (k) => data.siteName(k)), { fmt: money, title: 'تكاليف الزيت حسب الموقع' }), stats: [['عدد العمليات', num(r.length)], ['الإجمالي', money(sum(r))]],
        ...T([{ header: 'رقم العملية', type: 'text', value: (x) => x.oil_no }, { header: 'السيارة', type: 'text', value: (x) => data.vehicleLabel(x.vehicle_id) }, { header: 'التاريخ', type: 'date', value: (x) => x.change_date }, { header: 'العداد', type: 'int', value: (x) => x.odometer }, { header: 'القادم', type: 'int', value: (x) => x.next_odometer }, { header: 'الموقع', type: 'text', value: (x) => data.siteName(x.site_id) }, { header: 'الإجمالي', type: 'money', value: (x) => x.total }], r) };
    }
    case 'maintenance': {
      const r = (await api.get('maintenance', { select: '*', deleted_at: 'is.null', order: 'maint_date.desc' })).filter((x) => inRange(x.maint_date) && siteOk(x.site_id) && vehOk(x.vehicle_id));
      return { chart: hbars(groupSum(r, (x) => x.vehicle_id, (k) => data.vehicleLabel(k)).slice(0, 15), { fmt: money, title: 'تكاليف الصيانة حسب السيارة' }), stats: [['عدد العمليات', num(r.length)], ['قبل الضريبة', money(sum(r, (x) => x.subtotal))], ['الإجمالي', money(sum(r))]],
        ...T([{ header: 'رقم الصيانة', type: 'text', value: (x) => x.maint_no }, { header: 'السيارة', type: 'text', value: (x) => data.vehicleLabel(x.vehicle_id) }, { header: 'التاريخ', type: 'date', value: (x) => x.maint_date }, { header: 'النوع', type: 'text', value: (x) => x.maint_type }, { header: 'الورشة', type: 'text', value: (x) => x.workshop }, { header: 'قبل الضريبة', type: 'money', value: (x) => x.subtotal }, { header: 'الضريبة', type: 'money', value: (x) => x.vat_amount }, { header: 'الإجمالي', type: 'money', value: (x) => x.total }, { header: 'السداد', type: 'text', value: (x) => label('payment_status', x.payment_status) }], r) };
    }
    case 'accidents': {
      const r = (await api.get('accidents', { select: '*', deleted_at: 'is.null', order: 'occurred_at.desc' })).filter((x) => inRange(ridDate(x.occurred_at)) && siteOk(x.site_id) && vehOk(x.vehicle_id) && (!st.employee || x.driver_id === st.employee));
      return { chart: hbars(groupCount(r, (x) => x.status, (k) => label('accident_status', k)), { title: 'الحوادث حسب الحالة' }), stats: [['عدد الحوادث', num(r.length)], ['مفتوحة', num(r.filter((x) => x.status !== 'completed').length)], ['تكاليف الإصلاح', money(sum(r))]],
        ...T([{ header: 'رقم الحادث', type: 'text', value: (x) => x.accident_no }, { header: 'السيارة', type: 'text', value: (x) => data.vehicleLabel(x.vehicle_id) }, { header: 'التاريخ والوقت', type: 'datetime', value: (x) => x.occurred_at }, { header: 'السائق', type: 'text', value: (x) => (x.driver_id ? data.employeeName(x.driver_id) : '') }, { header: 'الحالة', type: 'text', value: (x) => label('accident_status', x.status) }, { header: 'الإجمالي', type: 'money', value: (x) => x.total }], r) };
    }
    case 'handovers': {
      const r = (await api.get('handovers', { select: '*', deleted_at: 'is.null', order: 'occurred_at.desc' })).filter((x) => inRange(ridDate(x.occurred_at)) && siteOk(x.site_id, x.company_id) && vehOk(x.vehicle_id) && (!st.employee || x.from_employee_id === st.employee || x.to_employee_id === st.employee));
      return { stats: [['عدد النماذج', num(r.length)], ['معتمد', num(r.filter((x) => x.state === 'approved').length)], ['مسودة', num(r.filter((x) => x.state === 'draft').length)]],
        ...T([{ header: 'رقم النموذج', type: 'text', value: (x) => x.form_no }, { header: 'النوع', type: 'text', value: (x) => (x.kind === 'receive' ? 'استلام' : 'تسليم') }, { header: 'السيارة', type: 'text', value: (x) => data.vehicleLabel(x.vehicle_id) }, { header: 'المسلِّم', type: 'text', value: (x) => (x.from_employee_id ? data.employeeName(x.from_employee_id) : 'الشركة') }, { header: 'المستلِم', type: 'text', value: (x) => (x.to_employee_id ? data.employeeName(x.to_employee_id) : 'الشركة') }, { header: 'التاريخ والوقت', type: 'datetime', value: (x) => x.occurred_at }, { header: 'الحالة', type: 'text', value: (x) => ({ draft: 'مسودة', approved: 'معتمد', cancelled: 'ملغى' }[x.state]) }], r) };
    }
    case 'housing': case 'food': {
      const t = key === 'housing' ? 'housing_maintenance' : 'food_supplies'; const dk = key === 'housing' ? 'work_date' : 'supply_date';
      const r = (await api.get(t, { select: '*', deleted_at: 'is.null', order: `${dk}.desc` })).filter((x) => inRange(x[dk]) && siteOk(x.site_id, x.company_id));
      return { chart: hbars(groupSum(r, (x) => x.site_id, (k) => data.siteName(k)), { fmt: money, title: 'الإجمالي حسب الموقع' }), stats: [['عدد العمليات', num(r.length)], ['الإجمالي', money(sum(r))]],
        ...T([{ header: 'رقم العملية', type: 'text', value: (x) => x.op_no }, { header: 'التاريخ', type: 'date', value: (x) => x[dk] }, { header: 'الموقع', type: 'text', value: (x) => data.siteName(x.site_id) }, { header: 'الشركة', type: 'text', value: (x) => data.companyName(x.company_id) }, { header: key === 'housing' ? 'المقاول' : 'المورد', type: 'text', value: (x) => x.contractor || x.supplier }, { header: 'الوصف', type: 'wrap', value: (x) => x.description }, { header: 'الإجمالي', type: 'money', value: (x) => x.total }, { header: 'السداد', type: 'text', value: (x) => label('payment_status', x.payment_status) }], r) };
    }
    case 'expenses': case 'cost_vehicle': case 'cost_site': case 'cost_company': {
      const r = (await api.get('v_expenses', { select: '*' })).filter((x) => inRange(x.expense_date) && siteOk(x.site_id, x.site_company_id) && vehOk(x.vehicle_id) && (key !== 'cost_vehicle' || x.vehicle_id));
      if (key === 'expenses') {
        const months = [...new Set(r.map((x) => x.expense_date.slice(0, 7)))].sort();
        const series = CATS.map(([k, n]) => ({ name: n, values: Object.fromEntries(months.map((m) => [m, Math.round(r.filter((x) => x.category === k && x.expense_date.startsWith(m)).reduce((s, x) => s + Number(x.total), 0) * 100) / 100])) }));
        const rows = months.slice().reverse().map((m) => ({ m, ...Object.fromEntries(series.map((s, i) => [CATS[i][0], s.values[m]])), total: series.reduce((s, x) => s + x.values[m], 0) }));
        const years = [...new Set(months.map((m) => m.slice(0, 4)))];
        return { chart: months.length ? stacked(months, series, { title: 'المصروفات الشهرية حسب الفئة' }) : '',
          stats: [['إجمالي الفترة', money(sum(r))], ...years.map((yy) => [`سنة ${yy}`, money(sum(r.filter((x) => x.expense_date.startsWith(yy))))])],
          ...T([{ header: 'الشهر', type: 'text', value: (x) => x.m.replace('-', '/') }, ...CATS.map(([k, n]) => ({ header: n, type: 'money', value: (x) => x[k] })), { header: 'الإجمالي', type: 'money', value: (x) => x.total }], rows) };
      }
      const keyFn = { cost_vehicle: (x) => x.vehicle_id, cost_site: (x) => x.site_id, cost_company: (x) => x.site_company_id }[key];
      const labFn = { cost_vehicle: data.vehicleLabel, cost_site: (k) => (k ? data.siteName(k) : 'بلا موقع'), cost_company: (k) => (k ? data.companyName(k) : '—') }[key];
      const groups = groupSum(r, keyFn, labFn);
      const rows = groups.map((g) => ({ name: g.label, ...Object.fromEntries(CATS.map(([k]) => [k, Math.round(r.filter((x) => keyFn(x) === g.key && x.category === k).reduce((s, x) => s + Number(x.total), 0) * 100) / 100])), total: g.value, n: r.filter((x) => keyFn(x) === g.key).length }));
      const cats = key === 'cost_vehicle' ? CATS.slice(0, 3) : CATS;
      return { chart: hbars(groups.slice(0, 20), { fmt: money, title: 'إجمالي التكاليف' }), stats: [['الإجمالي', money(sum(r))], ['عدد العمليات', num(r.length)]],
        ...T([{ header: key === 'cost_vehicle' ? 'السيارة' : key === 'cost_site' ? 'الموقع' : 'الشركة', type: 'text', value: (x) => x.name }, ...cats.map(([k, n]) => ({ header: n, type: 'money', value: (x) => x[k] })), { header: 'عدد العمليات', type: 'int', value: (x) => x.n }, { header: 'الإجمالي', type: 'money', value: (x) => x.total }], rows) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// الصفحة
// ---------------------------------------------------------------------
export async function renderReports(el) {
  await data.lookups(true);
  const opt = (v, t, cur) => html`<option value="${v}" ${raw(String(v) === String(cur) ? 'selected' : '')}>${t}</option>`;
  el.innerHTML = html`
    <div class="page-head no-print"><h1>التقارير</h1></div>
    <form class="filters rep-filters no-print" onsubmit="return false">
      <label class="grow"><span>التقرير</span><select name="report">${raw(Object.entries(GROUPS).map(([g, gt]) => html`<optgroup label="${gt}">${raw(REPORTS.filter((r) => r[2] === g).map(([k, t]) => opt(k, t, st.report)).join(''))}</optgroup>`).join(''))}</select></label>
      <label><span>الشركة</span><select name="company">${raw(opt('', 'الكل', st.company))}${raw(data.companyOptions(false).map(([k, t]) => opt(k, t, st.company)).join(''))}</select></label>
      <label><span>الموقع</span><select name="site">${raw(opt('', 'الكل', st.site))}${raw(data.siteOptions(false).map(([k, t]) => opt(k, t, st.site)).join(''))}</select></label>
      <label><span>السيارة</span><select name="vehicle">${raw(opt('', 'الكل', st.vehicle))}${raw(data.vehicleOptions().map(([k, t]) => opt(k, t, st.vehicle)).join(''))}</select></label>
      <label><span>الموظف</span><select name="employee">${raw(opt('', 'الكل', st.employee))}${raw(data.employeeOptions().map(([k, t]) => opt(k, t, st.employee)).join(''))}</select></label>
      <label><span>من تاريخ</span><input name="from" dir="ltr" inputmode="numeric" placeholder="YYYY/MM/DD" value="${st.from.replaceAll('-', '/')}"></label>
      <label><span>إلى تاريخ</span><input name="to" dir="ltr" inputmode="numeric" placeholder="YYYY/MM/DD" value="${st.to.replaceAll('-', '/')}"></label>
      <div class="quick">
        <button type="button" class="chip" data-q="month">هذا الشهر</button><button type="button" class="chip" data-q="last">الشهر الماضي</button>
        <button type="button" class="chip" data-q="year">هذه السنة</button><button type="button" class="chip" data-q="all">كل الفترات</button>
      </div>
    </form>
    <section class="report panel"><div class="loading">جارٍ إعداد التقرير…</div></section>
    <div id="tip" class="tip" hidden></div>`;

  let current = null;
  const box = $('.report', el);
  const run = async () => {
    box.innerHTML = '<div class="loading">جارٍ إعداد التقرير…</div>';
    const meta = REPORTS.find((r) => r[0] === st.report);
    try {
      const rep = await build(st.report);
      current = { meta, rep };
      const timeBased = !['vehicles_status', 'vehicles_owner', 'vehicles_site', 'documents', 'authorizations'].includes(st.report);
      const filt = [st.company && data.companyName(st.company), st.site && data.siteName(st.site), st.vehicle && data.vehicleLabel(st.vehicle), st.employee && data.employeeName(st.employee)].filter(Boolean);
      box.innerHTML = html`
        <header class="rep-head"><div><h2>${meta[1]}</h2>
          <p class="muted small">${timeBased ? html`الفترة: <span class="num">${date(st.from)} — ${date(st.to)}</span>` : html`الوضع الحالي بتاريخ <span class="num">${date(todayISO())}</span>`}${filt.length ? ` · ${filt.join(' · ')}` : ''}</p></div>
          <div class="btn-row no-print">${raw(api.can('export') ? html`<button class="btn btn-sm" data-x>${icon('table')}<span>Excel</span></button>` : '')}<button class="btn btn-sm" data-p>${icon('print')}<span>طباعة / PDF</span></button></div></header>
        ${raw(rep.stats?.length ? html`<div class="rep-stats">${raw(rep.stats.map(([k, v]) => html`<div><span>${k}</span><b class="num">${v}</b></div>`).join(''))}</div>` : '')}
        ${raw(rep.chart || '')}
        ${raw(rep.rows.length ? html`<div class="table-wrap"><table class="rtable rep-table"><thead><tr>${raw(rep.columns.map((c) => html`<th>${c.header}</th>`).join(''))}</tr></thead><tbody>
          ${raw(rep.rows.map((r) => html`<tr>${raw(rep.columns.map((c) => { const v = c.value(r); const t = c.type === 'money' ? money(v) : c.type === 'int' ? num(v) : c.type === 'date' ? date(v) : c.type === 'datetime' ? dateTime(v) : (v ?? '—'); return html`<td data-l="${c.header}" class="${['money', 'int', 'date', 'datetime'].includes(c.type) ? 'num' : ''}">${t || '—'}</td>`; }).join(''))}</tr>`).join(''))}
          </tbody></table></div>` : html`<div class="empty soft"><p>لا توجد بيانات لهذا التقرير بالفلاتر الحالية.</p></div>`)}
        <p class="muted small print-only">طُبع من نظام إدارة الأسطول والمواقع الزراعية — <span class="num">${date(todayISO())}</span></p>`;
    } catch (e) { box.innerHTML = html`<p class="bad-box">${errorText(e)}</p>`; }
  };

  const f = $('form', el);
  const readDates = () => {
    try { st.from = parseDate(f.from.value) || '2000-01-01'; st.to = parseDate(f.to.value) || todayISO(); return true; }
    catch (e) { toast(e.message, 'error'); return false; }
  };
  f.addEventListener('change', (e) => {
    if (e.target.name === 'from' || e.target.name === 'to') { if (!readDates()) return; }
    st.report = f.report.value; st.company = f.company.value; st.site = f.site.value; st.vehicle = f.vehicle.value; st.employee = f.employee.value;
    run();
  });
  el.onclick = (e) => {
    const q = e.target.closest('[data-q]');
    if (q) {
      const pad = (n) => String(n).padStart(2, '0');
      const end = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
      if (q.dataset.q === 'month') { st.from = `${Y}-${pad(M)}-01`; st.to = todayISO(); }
      if (q.dataset.q === 'last') { const yy = M === 1 ? Y - 1 : Y, mm = M === 1 ? 12 : M - 1; st.from = `${yy}-${pad(mm)}-01`; st.to = end(yy, mm); }
      if (q.dataset.q === 'year') { st.from = `${Y}-01-01`; st.to = todayISO(); }
      if (q.dataset.q === 'all') { st.from = '2000-01-01'; st.to = todayISO(); }
      f.from.value = st.from.replaceAll('-', '/'); f.to.value = st.to.replaceAll('-', '/');
      run(); return;
    }
    if (e.target.closest('[data-p]')) { window.print(); return; }
    if (e.target.closest('[data-x]') && current) {
      const { meta, rep } = current;
      saveBlob(writeXlsx([{ name: meta[1].slice(0, 31), columns: rep.columns, rows: rep.rows }]), `تقرير-${meta[1].replace(/[\s/()،]+/g, '-')}-${todayISO()}.xlsx`);
    }
  };
  // تلميح عند المرور أو اللمس
  const tip = $('#tip', el);
  const showTip = (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip.replaceAll(' | ', '\n'); tip.hidden = false;
    const r = t.getBoundingClientRect();
    tip.style.top = `${window.scrollY + r.top - tip.offsetHeight - 8}px`;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  };
  box.addEventListener('pointerover', showTip); box.addEventListener('focusin', showTip);
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
  await run();
}
