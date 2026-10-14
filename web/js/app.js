// الهيكل العام: تسجيل الدخول، القائمة، الشريط العلوي، التنقل بين الصفحات
import * as api from './api.js';
import { html, raw, icon, esc, toast, $, $$ } from './ui.js';
import { todayISO, date, errorText, label, statusText } from './fmt.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard, subject } from './pages/dashboard.js';
import { renderSearch } from './pages/search.js';
import { renderUpcoming } from './pages/upcoming.js';
import { renderSites } from './pages/sites.js';
import { renderVehicles, addVehicle } from './pages/vehicles.js';
import { renderVehicle } from './pages/vehicle.js';
import { renderEmployees, renderEmployee, addEmployee } from './pages/employees.js';
import { renderDocuments } from './pages/documents.js';
import { saved } from './form.js';
import { pruneDrafts } from './drafts.js';
import { renderProtect } from './pages/protect.js';
import { renderVehicleFields, renderVehiclesArchive } from './pages/vehicle-admin.js';
import { renderRequestsAdmin } from './pages/request-admin.js';
import { renderOil, renderMaintenance, renderAccidents, oilForm, maintForm, accidentForm } from './pages/ops.js';
import { renderHandovers, handoverForm } from './pages/handovers.js';
import { renderHousing, renderFood, housingForm, foodForm } from './pages/camp.js';
import { renderAttachmentsLibrary } from './attachments.js';
import { renderUsers } from './pages/users.js';
import { renderAudit } from './pages/audit.js';
import { renderSettings } from './pages/settings.js';
import { renderExcel } from './pages/excel.js';
import { renderReports } from './pages/reports.js';
import { renderRequests, requestForm } from './pages/requests.js';
import { renderRenewalList, renderPlan, renderDelegates } from './pages/renewal.js';

export const VERSION = '1.18';

// القائمة الرئيسية (بالترتيب المطلوب). phase = المرحلة التي يُبنى فيها القسم
export const NAV = [
  { id: 'dashboard',   t: 'لوحة التحكم',              ic: 'dashboard', phase: 2 },
  { id: 'sites',       t: 'الشركات والمواقع',          ic: 'sites',     phase: 3 },
  { id: 'vehicles',    t: 'السيارات',                  ic: 'car',       phase: 3 },
  { id: 'employees',   t: 'الموظفون',                  ic: 'people',    phase: 3, hidden: true },  // مخفي من القائمة فقط؛ الصفحة والبيانات باقية وتُفتح من ملف السيارة
  { id: 'documents',   t: 'الوثائق والتنبيهات',        ic: 'doc',       phase: 3 },
  { id: 'renewal',     t: 'خطة تجديد المركبة والمفوض', ic: 'doc',       phase: 3, hidden: true },  // تُفتح من لوحة التحكم ← وثائق السيارات
  { id: 'delegates',   t: 'المفوّضون',                 ic: 'people',    phase: 3, hidden: true },
  { id: 'oil',         t: 'تغيير الزيت',               ic: 'oil',       phase: 4 },
  { id: 'requests',    t: 'طلب صيانة',                 ic: 'wrench',    phase: 4 },
  { id: 'accidents',   t: 'الحوادث',                   ic: 'alert',     phase: 4 },
  { id: 'handovers',   t: 'استلام وتسليم السيارات',     ic: 'swap',      phase: 4 },
  { id: 'housing',     t: 'صيانة سكن العمال',          ic: 'home',      phase: 5 },
  { id: 'food',        t: 'توريد الطعام',              ic: 'food',      phase: 5 },
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
  ['accidents?new=1', 'حادث'], ['handovers?new=1', 'نموذج استلام أو تسليم'], ['housing?new=1', 'صيانة سكن'], ['food?new=1', 'توريد طعام'],
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
    const fn = { vehicles: addVehicle, employees: addEmployee, oil: () => oilForm(null), maintenance: () => maintForm(null), requests: () => requestForm(), accidents: () => accidentForm(null), handovers: () => handoverForm(null), housing: () => housingForm(), food: () => foodForm() }[page];
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
  const nav = NAV.find((n) => n.id === page);
  document.title = `${nav ? nav.t : page === 'search' ? 'نتائج البحث' : 'الصفحة'} — نظام إدارة الأسطول`;
  try {
    if (page === 'dashboard') await renderDashboard(el);
    else if (page === 'search') await renderSearch(el, params.get('q') || '');
    else if (page === 'sites') await renderSites(el);
    else if (page === 'vehicles') await (id ? renderVehicle(el, id, params) : renderVehicles(el, params));
    else if (page === 'employees') await (id ? renderEmployee(el, id, params) : renderEmployees(el));
    else if (page === 'documents') await renderDocuments(el);
    else if (page === 'renewal') await (id ? renderPlan(el, id) : renderRenewalList(el, params));
    else if (page === 'delegates') await renderDelegates(el, id);
    else if (page === 'oil') await renderOil(el);
    else if (page === 'maintenance') await renderMaintenance(el);
    else if (page === 'requests') await renderRequests(el, id, params);
    else if (page === 'accidents') await renderAccidents(el);
    else if (page === 'handovers') await renderHandovers(el, id, params);
    else if (page === 'housing') await renderHousing(el);
    else if (page === 'food') await renderFood(el);
    else if (page === 'attachments') await renderAttachmentsLibrary(el);
    else if (page === 'users') await renderUsers(el);
    else if (page === 'audit') await renderAudit(el);
    else if (page === 'settings' && id === 'vehicle-fields') await renderVehicleFields(el);
    else if (page === 'settings' && id === 'vehicles-archive') await renderVehiclesArchive(el);
    else if (page === 'settings' && id === 'requests') await renderRequestsAdmin(el, params);
    else if (page === 'settings') await renderSettings(el);
    else if (page === 'backup') await renderProtect(el);
    else if (page === 'excel') await renderExcel(el);
    else if (page === 'reports') await renderReports(el);
    else if (nav) renderUpcoming(el, nav, id);
    else el.innerHTML = html`<div class="empty"><h1>الصفحة غير موجودة</h1><a class="btn btn-primary" href="#/dashboard">الرجوع إلى لوحة التحكم</a></div>`;
  } catch (e) {
    el.innerHTML = html`<div class="empty error"><h1>تعذر تحميل الصفحة</h1><p>${errorText(e)}</p><button class="btn btn-primary" onclick="location.reload()">إعادة المحاولة</button></div>`;
  }
  if (el.isConnected) { host.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}

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
  try { user = await api.restore(); }
  catch (_) { return bootOffline(); }
  if (!user) {
    renderLogin(root, async (u) => {
      if (!u.is_active) return disabled();
      shell(u); if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard'; else route();
    });
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
