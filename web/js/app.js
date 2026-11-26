// الهيكل العام: تسجيل الدخول، القائمة، الشريط العلوي، التنقل بين الصفحات
import * as api from './api.js';
import { html, raw, icon, esc, toast, $, $$ } from './ui.js';
import { todayISO, date, errorText, label, statusText } from './fmt.js';
import { renderLogin } from './pages/login.js';
// 1.39: الصفحات تُحمَّل عند فتحها فقط (أسرع فتح للموقع)؛ نفس الصفحات بلا تغيير
const MODS = {
  './pages/dashboard.js': () => import('./pages/dashboard.js'),
  './pages/search.js': () => import('./pages/search.js'),
  './pages/upcoming.js': () => import('./pages/upcoming.js'),
  './pages/sites.js': () => import('./pages/sites.js'),
  './pages/vehicles.js': () => import('./pages/vehicles.js'),
  './pages/vehicle.js': () => import('./pages/vehicle.js'),
  './pages/employees.js': () => import('./pages/employees.js'),
  './pages/documents.js': () => import('./pages/documents.js'),
  './pages/protect.js': () => import('./pages/protect.js'),
  './pages/vehicle-admin.js': () => import('./pages/vehicle-admin.js'),
  './pages/request-admin.js': () => import('./pages/request-admin.js'),
  './pages/ops.js': () => import('./pages/ops.js'),
  './pages/handovers.js': () => import('./pages/handovers.js'),
  './pages/camp.js': () => import('./pages/camp.js'),
  './attachments.js': () => import('./attachments.js'),
  './pages/users.js': () => import('./pages/users.js'),
  './pages/audit.js': () => import('./pages/audit.js'),
  './pages/settings.js': () => import('./pages/settings.js'),
  './pages/excel.js': () => import('./pages/excel.js'),
  './pages/reports.js': () => import('./pages/reports.js'),
  './pages/costs.js': () => import('./pages/costs.js'),
  './pages/predict.js': () => import('./pages/predict.js'),
  './pages/office.js': () => import('./pages/office.js'),
  './pages/requests.js': () => import('./pages/requests.js'),
  './pages/renewal.js': () => import('./pages/renewal.js'),
};
const loaded = {};
// فشل تحميل ملف الصفحة (انقطاع الإنترنت) = رسالة الاتصال المعتادة، ويُعاد المحاولة في المرة التالية
function mod(path) {
  return (loaded[path] ||= MODS[path]().catch((e) => {
    delete loaded[path];
    const err = new Error('NETWORK'); err.code = 'NETWORK'; err.cause = e; throw err;
  }));
}
const FN = {};
FN.renderDashboard = async (...a) => (await mod('./pages/dashboard.js')).renderDashboard(...a);
FN.subject = async (...a) => (await mod('./pages/dashboard.js')).subject(...a);
FN.renderSearch = async (...a) => (await mod('./pages/search.js')).renderSearch(...a);
FN.renderUpcoming = async (...a) => (await mod('./pages/upcoming.js')).renderUpcoming(...a);
FN.renderSites = async (...a) => (await mod('./pages/sites.js')).renderSites(...a);
FN.renderVehicles = async (...a) => (await mod('./pages/vehicles.js')).renderVehicles(...a);
FN.addVehicle = async (...a) => (await mod('./pages/vehicles.js')).addVehicle(...a);
FN.renderVehicle = async (...a) => (await mod('./pages/vehicle.js')).renderVehicle(...a);
FN.renderEmployees = async (...a) => (await mod('./pages/employees.js')).renderEmployees(...a);
FN.renderEmployee = async (...a) => (await mod('./pages/employees.js')).renderEmployee(...a);
FN.addEmployee = async (...a) => (await mod('./pages/employees.js')).addEmployee(...a);
FN.renderDocuments = async (...a) => (await mod('./pages/documents.js')).renderDocuments(...a);
FN.renderProtect = async (...a) => (await mod('./pages/protect.js')).renderProtect(...a);
FN.renderVehicleFields = async (...a) => (await mod('./pages/vehicle-admin.js')).renderVehicleFields(...a);
FN.renderVehiclesArchive = async (...a) => (await mod('./pages/vehicle-admin.js')).renderVehiclesArchive(...a);
FN.renderRequestsAdmin = async (...a) => (await mod('./pages/request-admin.js')).renderRequestsAdmin(...a);
FN.renderOil = async (...a) => (await mod('./pages/ops.js')).renderOil(...a);
FN.renderMaintenance = async (...a) => (await mod('./pages/ops.js')).renderMaintenance(...a);
FN.renderAccidents = async (...a) => (await mod('./pages/ops.js')).renderAccidents(...a);
FN.oilForm = async (...a) => (await mod('./pages/ops.js')).oilForm(...a);
FN.maintForm = async (...a) => (await mod('./pages/ops.js')).maintForm(...a);
FN.accidentForm = async (...a) => (await mod('./pages/ops.js')).accidentForm(...a);
FN.renderHandovers = async (...a) => (await mod('./pages/handovers.js')).renderHandovers(...a);
FN.handoverForm = async (...a) => (await mod('./pages/handovers.js')).handoverForm(...a);
FN.renderHousing = async (...a) => (await mod('./pages/camp.js')).renderHousing(...a);
FN.renderFood = async (...a) => (await mod('./pages/camp.js')).renderFood(...a);
FN.housingForm = async (...a) => (await mod('./pages/camp.js')).housingForm(...a);
FN.foodForm = async (...a) => (await mod('./pages/camp.js')).foodForm(...a);
FN.renderAttachmentsLibrary = async (...a) => (await mod('./attachments.js')).renderAttachmentsLibrary(...a);
FN.renderUsers = async (...a) => (await mod('./pages/users.js')).renderUsers(...a);
FN.renderAudit = async (...a) => (await mod('./pages/audit.js')).renderAudit(...a);
FN.renderSettings = async (...a) => (await mod('./pages/settings.js')).renderSettings(...a);
FN.renderExcel = async (...a) => (await mod('./pages/excel.js')).renderExcel(...a);
FN.renderReports = async (...a) => (await mod('./pages/reports.js')).renderReports(...a);
FN.renderCosts = async (...a) => (await mod('./pages/costs.js')).renderCosts(...a);
FN.renderPredict = async (...a) => (await mod('./pages/predict.js')).renderPredict(...a);
FN.renderOffice = async (...a) => (await mod('./pages/office.js')).renderOffice(...a);
FN.renderRequests = async (...a) => (await mod('./pages/requests.js')).renderRequests(...a);
FN.requestForm = async (...a) => (await mod('./pages/requests.js')).requestForm(...a);
FN.renderRenewalList = async (...a) => (await mod('./pages/renewal.js')).renderRenewalList(...a);
FN.renderPlan = async (...a) => (await mod('./pages/renewal.js')).renderPlan(...a);
FN.renderDelegates = async (...a) => (await mod('./pages/renewal.js')).renderDelegates(...a);
// تحميل مسبق للوحة التحكم بعد ظهور الواجهة
function warm() { mod('./pages/dashboard.js').catch(() => {}); }
import { saved } from './form.js';
import { pruneDrafts } from './drafts.js';
import { registerWorker } from './push.js';

export const VERSION = '1.40';

// القائمة الرئيسية (بالترتيب المطلوب). phase = المرحلة التي يُبنى فيها القسم
export const NAV = [
  { id: 'dashboard',   t: 'لوحة التحكم',              ic: 'dashboard', phase: 2 },
  { id: 'office',      t: 'مكتب الأسطول',              ic: 'people',    phase: 2 },  // 1.37: موظفين ذكاء اصطناعي، 1.38: مكتب ثلاثي الأبعاد وغرفة المتابعة
  { id: 'sites',       t: 'الشركات والمواقع',          ic: 'sites',     phase: 3 },
  { id: 'vehicles',    t: 'السيارات',                  ic: 'car',       phase: 3 },
  { id: 'employees',   t: 'الموظفون',                  ic: 'people',    phase: 3, hidden: true },  // مخفي من القائمة فقط؛ الصفحة والبيانات باقية وتُفتح من ملف السيارة
  { id: 'documents',   t: 'الوثائق والتنبيهات',        ic: 'doc',       phase: 3 },
  { id: 'renewal',     t: 'خطة تجديد المركبة والمفوض', ic: 'doc',       phase: 3, hidden: true },  // تُفتح من لوحة التحكم ← وثائق السيارات
  { id: 'delegates',   t: 'المفوّضون',                 ic: 'people',    phase: 3, hidden: true },
  { id: 'oil',         t: 'تغيير الزيت',               ic: 'oil',       phase: 4 },
  { id: 'requests',    t: 'طلب صيانة',                 ic: 'wrench',    phase: 4 },
  { id: 'costs',       t: 'تكاليف الصيانة',             ic: 'invoice',   phase: 4 },  // 1.34: من ملف Excel
  { id: 'predict',     t: 'الصيانة التنبؤية',           ic: 'gauge',     phase: 4 },  // 1.36: توقعات بدون حساسات
  { id: 'accidents',   t: 'الحوادث',                   ic: 'alert',     phase: 4, hidden: true },  // 1.32: مخفي من القائمة بطلب المالك؛ الصفحة والبيانات باقية
  { id: 'handovers',   t: 'استلام وتسليم السيارات',     ic: 'swap',      phase: 4 },
  { id: 'housing',     t: 'صيانة سكن العمال',          ic: 'home',      phase: 5, hidden: true },  // 1.32: مخفي من القائمة بطلب المالك؛ الصفحة والبيانات باقية
  { id: 'food',        t: 'توريد الطعام',              ic: 'food',      phase: 5, hidden: true },  // 1.32: مخفي من القائمة بطلب المالك؛ الصفحة والبيانات باقية
  { id: 'attachments', t: 'الفواتير والمرفقات',        ic: 'invoice',   phase: 5 },
  { id: 'reports',     t: 'التقارير',                  ic: 'chart',     phase: 7 },
  { id: 'excel',       t: 'Excel: الاستيراد والتصدير', ic: 'table',     phase: 7 },
  { id: 'users',       t: 'المستخدمون والصلاحيات',     ic: 'shield',    phase: 6 },
  { id: 'audit',       t: 'سجل التعديلات',             ic: 'clock',     phase: 6 },
  { id: 'backup',      t: 'النسخ الاحتياطي وحماية البيانات', ic: 'shield', phase: 10, admin: true },
  { id: 'settings',    t: 'الإعدادات',                 ic: 'gear',      phase: 6 },
];
const TABS = ['dashboard', 'vehicles', 'requests', 'documents'];
const ADD_MENU = [
  ['vehicles?new=1', 'سيارة'], ['employees?new=1', 'موظف'], ['oil?new=1', 'تغيير زيت'], ['requests?new=1', 'طلب صيانة'],
  ['handovers?new=1', 'نموذج استلام أو تسليم'],  // 1.32: أُخفيت الحوادث وسكن العمال وتوريد الطعام من القوائم
];

const root = document.getElementById('app');

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { page: parts[0] || 'dashboard', id: parts[1], params: new URLSearchParams(qs || '') };
}

function shell(user) {
  const today = date(todayISO());
  const navLink = (n, cls = '') => html`<a href="#/${n.id}" class="nav-link ${cls}" data-nav="${n.id}">${icon(n.ic)}<span>${n.t}</span></a>`;
  root.innerHTML = html`
    <div class="layout">
      <aside class="sidebar" aria-label="القائمة الرئيسية">
        <div class="brand"><span class="brand-logo"><img src="logo.png" alt="شعار شركة روى الرمال الزراعية" width="624" height="640"></span><div><b>نظام إدارة الأسطول</b><small>والمواقع الزراعية · الإصدار <span class="num">${VERSION}</span></small></div></div>
        <nav class="nav">${raw(NAV.filter((n) => !n.hidden && (!n.admin || user.is_admin)).map((n) => navLink(n)).join(''))}</nav>
        <button class="nav-link signout" data-act="signout">${icon('logout')}<span>تسجيل الخروج</span></button>
      </aside>

      <div class="main">
        <header class="topbar">
          <div class="tb-title">
            <img class="tb-logo" src="logo-mark.png" alt="شعار شركة روى الرمال الزراعية" width="192" height="192">
            <span class="tb-company">شركة روى الرمال الزراعية</span>
            <span class="tb-name">نظام إدارة الأسطول والمواقع الزراعية</span>
            <span class="tb-meta"><span class="tb-user">${user.full_name}</span><span class="tb-date num">${today}</span></span>
          </div>
          <form class="search" role="search" data-act="search">
            ${icon('search')}
            <input type="search" name="q" placeholder="ابحث: رقم اللوحة، الرقم الداخلي، اسم الموظف" aria-label="بحث عام" autocomplete="off">
          </form>
          <div class="tb-actions">
            <div class="pop-wrap">
              <button class="btn btn-primary btn-add" data-act="add" aria-haspopup="true" aria-expanded="false">${icon('plus')}<span>إضافة جديد</span></button>
              <div class="pop pop-add" hidden>${raw(ADD_MENU.map(([id, t]) => html`<a href="#/${id}" class="pop-item">${t}</a>`).join(''))}</div>
            </div>
            <div class="pop-wrap">
              <button class="icon-btn bell" data-act="bell" aria-label="مركز التنبيهات" aria-haspopup="true" aria-expanded="false">${icon('bell')}<span class="badge num" hidden></span></button>
              <div class="pop pop-bell" hidden><div class="pop-head">التنبيهات العاجلة</div><div class="pop-body"><p class="muted pad">جارٍ التحميل…</p></div></div>
            </div>
          </div>
        </header>
        <main id="page" class="page" tabindex="-1"></main>
      </div>

      <nav class="tabbar" aria-label="التنقل السريع">
        ${raw(TABS.map((id) => { const n = NAV.find((x) => x.id === id); return html`<a href="#/${id}" class="tab" data-nav="${id}">${icon(n.ic)}<span>${n.id === 'documents' ? 'الوثائق' : n.t}</span></a>`; }).join(''))}
        <button class="tab" data-act="more" aria-haspopup="dialog">${icon('more')}<span>المزيد</span></button>
      </nav>

      <div class="sheet" hidden role="dialog" aria-modal="true" aria-label="كل الأقسام">
        <div class="sheet-panel">
          <div class="sheet-head"><b>كل الأقسام</b><button class="icon-btn" data-act="close-sheet" aria-label="إغلاق">${icon('close')}</button></div>
          <div class="sheet-grid">${raw(NAV.filter((n) => !n.hidden && (!n.admin || user.is_admin)).map((n) => navLink(n, 'sheet-link')).join(''))}</div>
          <button class="btn btn-ghost wide" data-act="signout">${icon('logout')}<span>تسجيل الخروج</span></button>
          <p class="muted small center">الإصدار <span class="num">${VERSION}</span></p>
        </div>
      </div>
    </div>`;

  root.addEventListener('click', onShellClick);
  $('form.search', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.pop-wrap')) closePops(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePops(); closeSheet(); } });
  loadBell();
}

function closePops() { $$('.pop').forEach((p) => (p.hidden = true)); $$('[aria-haspopup="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false')); }
function togglePop(btn, sel) {
  const pop = $(sel); const open = pop.hidden;
  closePops(); pop.hidden = !open; btn.setAttribute('aria-expanded', String(open));
}
function closeSheet() { const s = $('.sheet'); if (s) s.hidden = true; }

async function onShellClick(e) {
  const b = e.target.closest('[data-act]');
  if (e.target.closest('.sheet-link')) closeSheet();
  if (e.target.closest('.pop-item')) closePops();
  const newItem = e.target.closest('.pop-add a[href*="?new=1"]');
  if (newItem) {
    e.preventDefault(); closePops();
    const page = newItem.getAttribute('href').slice(2).split('?')[0];
    if (!api.can('create')) { toast('لا تملك صلاحية الإضافة.', 'error'); return; }
    const fn = { vehicles: FN.addVehicle, employees: FN.addEmployee, oil: () => FN.oilForm(null), maintenance: () => FN.maintForm(null), requests: () => FN.requestForm(), accidents: () => FN.accidentForm(null), handovers: () => FN.handoverForm(null), housing: () => FN.housingForm(), food: () => FN.foodForm() }[page];
    const row = await fn();
    if (!row) return;
    if (page === 'vehicles' || page === 'employees') { saved(`تمت الإضافة: ${row.code}`); location.hash = `#/${page}/${row.id}`; }
    else if (page === 'requests') { saved(`تم حفظ الطلب ${row.request_no}`); location.hash = `#/requests/${row.id}`; }
    else { saved(); if (location.hash.startsWith(`#/${page}`)) route(); else location.hash = `#/${page}`; }
    return;
  }
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'add') togglePop(b, '.pop-add');
  if (act === 'bell') togglePop(b, '.pop-bell');
  if (act === 'more') $('.sheet').hidden = false;
  if (act === 'close-sheet') closeSheet();
  if (act === 'signout') { await api.signOut(); location.hash = '#/login'; start(); }
}

export async function loadBell() {
  try {
    const { subject } = await mod('./pages/dashboard.js');
    const rows = (await api.get('v_followups', { select: 'subject_type,subject_id,subject_label,alert_type,status,days_left,km_left,severity', severity: 'eq.1' }))
      .sort((a, b) => (b.alert_type === 'maintenance_request') - (a.alert_type === 'maintenance_request'));
    const badge = $('.bell .badge');
    if (badge) { badge.hidden = rows.length === 0; badge.textContent = rows.length > 99 ? '99+' : rows.length; }
    const body = $('.pop-bell .pop-body');
    if (!body) return;
    body.innerHTML = rows.length
      ? rows.slice(0, 8).map((r) => html`<a class="pop-item alert-item" href="#/${{ vehicle: 'vehicles', employee: 'employees', maintenance_request: 'requests' }[r.subject_type]}/${r.subject_id}">
          <b>${subject(r.subject_label)}</b><span>${label('alert_type', r.alert_type)} · ${statusText(r)}</span></a>`).join('') +
        html`<a class="pop-foot" href="#/dashboard">عرض كل المهام في لوحة التحكم</a>`
      : html`<p class="muted pad">لا توجد تنبيهات عاجلة.</p>`;
  } catch (_) { /* التنبيهات ليست حرجة */ }
}

function setActive(page) {
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (page === 'maintenance' ? 'requests' : page)));
}

async function route() {
  const { page, id, params } = parseHash();
  const user = api.currentUser();
  if (!user) return start();
  if (page === 'login') { location.hash = '#/dashboard'; return; }
  setActive(page);
  closePops(); closeSheet();
  // كل انتقال يرسم في حاوية جديدة؛ إذا انتهى تحميل صفحة سابقة متأخراً فإنه يكتب في حاوية لم تعد معروضة،
  // فلا تظهر صفحة قديمة فوق الصفحة التي اختارها المستخدم.
  const host = $('#page');
  const el = document.createElement('div');
  el.className = 'view';
  el.innerHTML = '<div class="loading" aria-live="polite">جارٍ التحميل…</div>';
  host.replaceChildren(el);
  if (Date.now() - (route.bellAt || 0) > 20000) { route.bellAt = Date.now(); loadBell(); }
  checkUpdate();
  const nav = NAV.find((n) => n.id === page);
  document.title = `${nav ? nav.t : page === 'search' ? 'نتائج البحث' : 'الصفحة'} — نظام إدارة الأسطول`;
  try {
    if (page === 'dashboard') await FN.renderDashboard(el);
    else if (page === 'search') await FN.renderSearch(el, params.get('q') || '');
    else if (page === 'sites') await FN.renderSites(el);
    else if (page === 'vehicles') await (id ? FN.renderVehicle(el, id, params) : FN.renderVehicles(el, params));
    else if (page === 'employees') await (id ? FN.renderEmployee(el, id, params) : FN.renderEmployees(el));
    else if (page === 'documents') await FN.renderDocuments(el);
    else if (page === 'renewal') await (id ? FN.renderPlan(el, id) : FN.renderRenewalList(el, params));
    else if (page === 'delegates') await FN.renderDelegates(el, id);
    else if (page === 'oil') await FN.renderOil(el);
    else if (page === 'maintenance') await FN.renderMaintenance(el);
    else if (page === 'requests') await FN.renderRequests(el, id, params);
    else if (page === 'accidents') await FN.renderAccidents(el);
    else if (page === 'handovers') await FN.renderHandovers(el, id, params);
    else if (page === 'housing') await FN.renderHousing(el);
    else if (page === 'food') await FN.renderFood(el);
    else if (page === 'attachments') await FN.renderAttachmentsLibrary(el);
    else if (page === 'users') await FN.renderUsers(el);
    else if (page === 'audit') await FN.renderAudit(el);
    else if (page === 'settings' && id === 'vehicle-fields') await FN.renderVehicleFields(el);
    else if (page === 'settings' && id === 'vehicles-archive') await FN.renderVehiclesArchive(el);
    else if (page === 'settings' && id === 'requests') await FN.renderRequestsAdmin(el, params);
    else if (page === 'settings') await FN.renderSettings(el);
    else if (page === 'backup') await FN.renderProtect(el);
    else if (page === 'excel') await FN.renderExcel(el);
    else if (page === 'reports') await FN.renderReports(el);
    else if (page === 'predict') await FN.renderPredict(el);
    else if (page === 'office') await FN.renderOffice(el);
    else if (page === 'costs') await FN.renderCosts(el, { vehicle: params.get('vehicle') ?? undefined, cat: params.get('cat') ?? undefined });
    else if (nav) await FN.renderUpcoming(el, nav, id);
    else el.innerHTML = html`<div class="empty"><h1>الصفحة غير موجودة</h1><a class="btn btn-primary" href="#/dashboard">الرجوع إلى لوحة التحكم</a></div>`;
  } catch (e) {
    el.innerHTML = html`<div class="empty error"><h1>تعذر تحميل الصفحة</h1><p>${errorText(e)}</p><button class="btn btn-primary" onclick="location.reload()">إعادة المحاولة</button></div>`;
  }
  if (el.isConnected) { host.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}

// تنبيه «يوجد إصدار جديد»: الصفحة المفتوحة منذ مدة تبقى على النسخة القديمة حتى تُحدَّث
let updAt = 0;
async function checkUpdate(force = false) {
  if (!force && Date.now() - updAt < 120000) return;
  updAt = Date.now();
  try {
    const t = await (await fetch(`js/app.js?v=${Date.now()}`, { cache: 'no-store' })).text();
    const m = t.match(/VERSION = '([^']+)'/);
    if (!m || m[1] === VERSION || document.querySelector('.upd-banner')) return;
    const b = document.createElement('div');
    b.className = 'upd-banner'; b.setAttribute('role', 'status');
    b.innerHTML = html`<span>يوجد إصدار جديد من النظام (<b class="num">${m[1]}</b>). حدّث الصفحة لتظهر آخر التعديلات.</span><button type="button" class="btn btn-sm btn-primary" data-upd>تحديث الآن</button>`;
    b.querySelector('[data-upd]').onclick = () => location.reload();
    document.body.appendChild(b);
  } catch (_) { /* غير حرج */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(true); });
registerWorker(); // عامل الخدمة لإشعارات الجوال فقط (بدون تخزين مؤقت)

async function disabled() {
  root.innerHTML = html`<div class="empty"><h1>الحساب معطّل</h1><p>تواصل مع مسؤول النظام لإعادة تفعيل حسابك.</p><button class="btn" data-out>تسجيل الخروج</button></div>`;
  root.querySelector('[data-out]').onclick = async () => { await api.signOut(); start(); };
}

// شاشة عند تعذر الاتصال أثناء فتح الموقع: الجلسة تبقى محفوظة، ولا يُطلب تسجيل الدخول من جديد
function bootOffline() {
  root.innerHTML = html`<div class="boot-offline"><h1>لا يوجد اتصال بالإنترنت</h1>
    <p>بياناتك محفوظة في قاعدة البيانات ولم يُحذف منها شيء، لكن عرضها يحتاج اتصالاً بالإنترنت.</p>
    <button class="btn btn-primary" data-retry>إعادة المحاولة</button></div>`;
  root.querySelector('[data-retry]').onclick = () => start();
}

async function start() {
  root.removeEventListener('click', onShellClick);
  let user;
  const first = parseHash().page;
  if (!first || first === 'dashboard' || first === 'login') warm();
  try { user = await api.restore(); }
  catch (_) { return bootOffline(); }
  if (!user) {
    renderLogin(root, async (u) => {
      if (!u.is_active) return disabled();
      shell(u); if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard'; else route();
    });
    setTimeout(warm, 300);
    return;
  }
  if (!user.is_active) return disabled();
  shell(user);
  route();
}

window.addEventListener('hashchange', () => { if (api.currentUser()) route(); });
// شريط حالة الاتصال: يوضح أن الإضافة والتعديل لا يُحفظان أثناء انقطاع الإنترنت
function netBanner() {
  let b = document.querySelector('.net-banner');
  if (navigator.onLine === false) {
    if (!b) { b = document.createElement('div'); b.className = 'net-banner'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
    b.className = 'net-banner';
    b.textContent = 'لا يوجد اتصال بالإنترنت — لن تُحفظ أي إضافة أو تعديل حتى يعود الاتصال. ما تكتبه في النماذج يبقى محفوظاً كمسودة على هذا الجهاز.';
  } else if (b) {
    b.className = 'net-banner ok'; b.textContent = 'عاد الاتصال بالإنترنت. يمكنك الحفظ الآن.';
    setTimeout(() => { if (navigator.onLine !== false) b.remove(); }, 3000);
  }
}
window.addEventListener('offline', netBanner);
window.addEventListener('online', netBanner);
netBanner();
pruneDrafts();
window.addEventListener('error', (e) => toast(errorText(e.error || e.message), 'error'));
// أي عملية حفظ فشلت دون معالجة تظهر للمستخدم كرسالة خطأ واضحة بدل أن تفشل بصمت
window.addEventListener('unhandledrejection', (e) => toast((e.reason && e.reason.code === 'NETWORK' ? 'لم تُحفظ العملية: ' : '') + errorText(e.reason), 'error'));
document.addEventListener('click', (e) => { if (e.target.classList && e.target.classList.contains('sheet')) closeSheet(); });
start();
