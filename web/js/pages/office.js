// 1.37/1.38: صفحة «مكتب الأسطول الذكي»: المدير عبدالرحمن وثمانية موظفين ذكاء اصطناعي (روبوتات)، كل واحد ماسك ملف.
// 1.38 (بعد اعتماد المالك للمعاينة): مكتب ثلاثي الأبعاد (office3d.js) + «غرفة المتابعة» الداكنة (عدادات، أرضية بكسل،
// شبكة المهام، سجل حي) + بطاقات الفريق + الموافقات. كل الأرقام من البيانات الفعلية (قراءة فقط).
// الكتابة الوحيدة: إضافة مهمة (office_add_task) وقرار «موافق/لا» للمسؤول (office_decide). بدون أي تغيير في قاعدة البيانات.
import * as api from '../api.js';
import { html, raw, icon, toast, $, $$ } from '../ui.js';
import { num, date, label, errorText } from '../fmt.js';
import { loadPredictions } from './predict.js';
import { AGENTS, TASK_AGENTS, agentById, routeAgent, buildOffice, buildBrief } from '../office.js';

const STATE = { working: 'يشتغل', idle: 'هادئ', waiting: 'ينتظر موافقتك', alert: 'عنده تنبيه' };
const DOTC = { working: '#3FD38E', waiting: '#F0B04A', alert: '#F07A6E', idle: '#6F7F77' };
const TASK_ST = { new: 'جديدة', working: 'قيد التنفيذ', needs_you: 'تحتاجك', done: 'منجزة', rejected: 'مرفوضة' };
const LVL = { bad: 'عاجل', warn: 'قريب', info: 'متابعة' };
const CODE = { manager: 'MGR', fleet: 'FLT', maintenance: 'MNT', oil: 'OIL', docs: 'DOC', accidents: 'ACC', expenses: 'EXP', reports: 'RPT', purchasing: 'BUY' };
// وش يتابع كل موظف، ووش المنفذ فعلاً (طلب المالك: «وضح ما هو المنفذ فعلياً وما يحتاج إلى تطوير»)
const CAP = {
  fleet: ['السيارات، الحالة، قراءات العداد', 'يكشف السيارات اللي ما لها قراءة عداد حديثة', 'part', 'تتبع GPS حي (يحتاج أجهزة)', 'تغيير موقع أو حالة سيارة'],
  maintenance: ['طلبات الصيانة، الأعطال المتكررة', 'يتابع الطلبات المفتوحة والأعطال المتكررة، وClaude يصدر طلب الصيانة PDF', 'yes', 'تنفيذ فوري من الموقع', 'إرسال طلب للاعتماد، إضافة تكلفة'],
  oil: ['الزيت، الممشى، الكفرات، البطاريات', 'يتوقع موعد الزيت والكفرات والبطارية وينبه على البنشر المتكرر', 'yes', 'قراءة العداد تلقائياً', 'تسجيل غيار زيت'],
  docs: ['الاستمارة، التأمين، الفحص، التفويض', 'ينبه على المنتهي والقريب ويتابع خطط التجديد', 'yes', 'ربط مباشر مع أبشر (غير متاح)', 'تأكيد خطوة تجديد، سداد رسوم'],
  accidents: ['الحوادث (القسم مخفي وفاضي)', 'لا شيء حالياً', 'no', 'إظهار القسم، قراءة التقدير من صورة', 'اعتماد تقدير أو إصلاح'],
  expenses: ['تكاليف الصيانة من الإكسل، الفواتير', 'يحسب الفواتير غير المدفوعة والمصاريف الزايدة ويراقب المزامنة', 'part', 'قراءة الفاتورة من صورة داخل الموقع (مفتاح Claude API)', 'اعتماد أي مصروف أو دفعة'],
  reports: ['كل الجداول (قراءة)', 'ملخص الصباح ومكتبة الأسبوع (Claude، مهام مجدولة)', 'yes', 'تقارير شهرية تلقائية', 'إرسال تقرير لجهة خارجية'],
  purchasing: ['الموردين من الفواتير', 'يعد الموردين فقط', 'no', 'جدول طلبات شراء وعروض أسعار', 'أي طلب شراء أو أمر دفع'],
};
const CAPL = { yes: ['منفذ', 'yes'], part: ['منفذ جزئياً', 'part'], no: ['يحتاج تطوير', 'no'] };
const hhmm = (v) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(v ? new Date(v) : new Date());

// روبوت مرسوم (بديل سريع قبل ما توصل صور الثلاثي الأبعاد، أو إن ما يدعم الجهاز WebGL)
const SHAPES = {
  ball: '<circle cx="32" cy="34" r="20"/>', hex: '<path d="M32 13 50 23.5v21L32 55 14 44.5v-21z"/>', drop: '<path d="M32 10C40 22 52 30 52 40a20 20 0 0 1-40 0c0-10 12-18 20-30z"/>',
  cube: '<rect x="13" y="15" width="38" height="38" rx="8"/>', tri: '<path d="M32 10 56 54H8z"/>', pill: '<rect x="16" y="12" width="32" height="44" rx="16"/>',
  ghost: '<path d="M12 54V32a20 20 0 0 1 40 0v22l-6-4-7 4-7-4-7 4-7-4z"/>', gem: '<path d="M32 8 52 32 32 58 12 32z"/>',
};
export function botSvg(a) {
  const b = a.bot || {};
  return `<svg viewBox="0 0 64 64" class="of-pic" aria-hidden="true" style="padding:14%"><g fill="${b.c}">${SHAPES[b.shape] || SHAPES.ball}</g>${b.crown ? '<path d="M22 14l4-8 6 6 6-6 4 8z" fill="#F5D27A"/>' : '<line x1="32" y1="4" x2="32" y2="12" stroke="#2A2F2C" stroke-width="2"/><circle cx="32" cy="4" r="3" fill="#3FD38E"/>'}<g fill="#fff"><ellipse cx="26" cy="36" rx="4.5" ry="5.5"/><ellipse cx="38" cy="36" rx="4.5" ry="5.5"/></g><g fill="#10151A"><circle cx="26.5" cy="37" r="2.4"/><circle cx="38.5" cy="37" r="2.4"/></g></svg>`;
}

async function loadAll() {
  const [requests, docs, costs, pred, tasks, reports, accidents] = await Promise.all([
    api.get('maintenance_requests', { select: 'id,request_no,status,fault,request_date', deleted_at: 'is.null' }).catch(() => []),
    api.get('v_document_status', { select: 'owner_type,owner_id,doc_type,subject_label,expiry_date,days_left,status' }).catch(() => []),
    api.get('cost_lines', { select: 'category,payment_status,synced_at,amount,plate_text,supplier,line_date', is_active: 'is.true' }).catch(() => []),
    loadPredictions().catch(() => ({ rows: [] })),
    api.get('office_tasks', { select: '*', is_active: 'is.true', order: 'created_at.desc' }).catch(() => null),
    api.get('office_reports', { select: '*', order: 'report_date.desc', limit: 8 }).catch(() => null),
    api.get('accidents', { select: 'id,occurred_at', deleted_at: 'is.null' }).catch(() => []),
  ]);
  const alerts = pred.rows.flatMap((r) => r.alerts.map((a) => ({ ...a, plate: r.v.plate_no || r.v.code, vid: r.v.id })));
  const vehicles = pred.rows.map((r) => r.v);
  docs.forEach((d) => { d.doc_label = label('doc_type', d.doc_type); });
  const office = buildOffice({ requests, docs, costs, alerts, vehicles, accidents: accidents.map((x) => ({ accident_date: x.occurred_at })), tasks: tasks || [], now: new Date().toISOString() });
  return { office, tasks, reports };
}

const pic = (a, P) => (P[a.id] ? `<img class="of-pic" src="${P[a.id]}" alt="">` : botSvg(a));

const room = (a, P) => html`
  <button type="button" class="of-room of-${a.state === 'alert' ? 'working' : a.state} ${a.state === 'alert' ? 'of-alerting' : ''} ${a.delivered ? 'of-deliver' : ''}" data-agent="${a.id}" aria-label="${a.name}، ${a.role}، ${STATE[a.state]}">
    <span data-pic="${a.id}">${raw(pic(a, P))}</span>
    ${raw(a.busy ? html`<span class="of-badge num" data-busy>${a.busy}</span>` : '')}
    <span class="of-row"><span><h3>${a.name}</h3><span class="of-role">${a.role}</span></span><span class="of-lv num" data-lv>Lv ${a.level.lv}</span></span>
    <span class="of-bar" title="${a.level.xp} نقطة"><i style="width:${a.level.pct}%"></i></span>
    <span class="of-row"><span class="of-st"><span class="dot st-${a.state}"></span>${STATE[a.state]}</span><span class="of-st">${raw(a.busy ? html`<span class="num">${a.busy}</span> مفتوح` : a.db ? 'لا شيء مفتوح' : '<span class="of-dev">يحتاج تطوير</span>')}</span></span>
  </button>`;

const itemLi = (it) => html`<li class="of-it of-${it.level}"><span class="of-pill">${LVL[it.level] || ''}</span>${raw(it.href ? html`<a href="${it.href}">${it.text}</a>` : html`<span>${it.text}</span>`)}</li>`;
const taskLi = (t, admin) => html`<li class="of-task" data-task="${t.id}"><span class="of-tst of-ts-${t.status}">${TASK_ST[t.status]}</span>
  <b class="num">#${t.task_no}</b> <span>${t.title}</span>${raw(t.needs_note ? html`<small class="of-need">${t.needs_note}</small>` : '')}${raw(t.result ? html`<small class="muted">النتيجة: ${t.result}</small>` : '')}
  ${raw(t.status === 'needs_you' && admin ? html`<span class="of-acts"><input class="of-note" placeholder="ملاحظة (اختياري)" aria-label="ملاحظة"><button class="btn btn-primary btn-sm" data-decide="approved">موافق</button><button class="btn btn-sm" data-decide="rejected">لا</button></span>` : '')}</li>`;

function detail(a, admin, P) {
  const c = CAP[a.id];
  return html`<section class="panel of-detail" data-detail="${a.id}">
    <header><span data-pic="${a.id}" style="width:64px;flex:none">${raw(pic(a, P))}</span><div><h2>${a.name} · ${a.role}</h2>
      <p class="muted small">${STATE[a.state]} · المستوى <span class="num">${a.level.lv}</span> · <span class="num">${num(a.level.xp)}</span> نقطة${raw(a.level.next ? html` (باقي <span class="num">${num(a.level.next - a.level.xp)}</span> للمستوى التالي)` : '')}</p></div>
      <button class="icon-btn" data-close aria-label="إغلاق">${icon('close')}</button></header>
    ${raw(c ? html`<p class="small"><b>يتابع:</b> ${c[0]}. <b>ينفذ الحين:</b> ${c[1]}. <b>يحتاج موافقتك قبل:</b> ${c[4]}.</p>` : html`<p class="small">صاحب القرار النهائي: أي اعتماد مالي أو حذف أو تعديل حساس يرجع له.</p>`)}
    ${raw(a.items.length ? html`<h3>الشغل المفتوح</h3><ul class="of-list">${raw(a.items.slice(0, 40).map(itemLi).join(''))}</ul>` : '<p class="muted pad">ما عنده شغل مفتوح الحين.</p>')}
    ${raw(a.tasks.length ? html`<h3>المهام</h3><ul class="of-list">${raw(a.tasks.slice(0, 20).map((t) => taskLi(t, admin)).join(''))}</ul>` : '')}
  </section>`;
}

const SEC = [['needs_you', 'يحتاجك', 'shield'], ['broke', 'وش اللي خرب', 'alert'], ['today', 'مهامك اليوم', 'calendar'], ['done', 'اللي انعمل', 'wrench'], ['improve', 'كيف نطوّر الشغل', 'gauge'], ['levels', 'ترقيات', 'chart']];
function reportView(body, emptyText) {
  const parts = SEC.filter(([k]) => Array.isArray(body[k]) && body[k].length).map(([k, t, ic]) => html`<div class="of-rsec" data-rsec="${k}"><h3>${icon(ic)} ${t} <span class="count num">${body[k].length}</span></h3>
    <ul>${raw(body[k].map((x) => { const s = typeof x === 'string' ? x : x.text; const who = x.agent ? agentById(x.agent).name + ': ' : ''; return x.href ? html`<li>${who}<a href="${x.href}">${s}</a></li>` : html`<li>${who}${s}</li>`; }).join(''))}</ul></div>`);
  return html`${raw(body.summary ? html`<p class="of-sum">${body.summary}</p>` : '')}${raw(parts.length ? parts.join('') : html`<p class="muted pad">${emptyText}</p>`)}`;
}

const spark = (arr) => {
  const mx = Math.max(1, ...arr), w = 100, h = 26;
  const pts = arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - 2 - (v / mx) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,${h} ${pts} ${w},${h}" fill="rgba(63,185,132,.12)"/><polyline points="${pts}" fill="none" stroke="#3FB984" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
};

// سجل المتابعة: أحداث المهام الفعلية بوقتها، ثم الموظفين يراجعون شغلهم المفتوح واحد واحد (من البيانات)
function feedSource(office, tasks) {
  const ev = [];
  for (const t of tasks || []) {
    const a = agentById(t.agent);
    if (t.done_at) ev.push({ at: t.done_at, a, text: `أنجز: ${t.title}`, k: 'ok' });
    if (t.decided_at) ev.push({ at: t.decided_at, a, text: `${t.decision === 'approved' ? 'وصلته موافقتك' : 'وصله رفضك'}: ${t.title}`, k: t.decision === 'approved' ? 'ok' : 'warn' });
    if (t.status === 'needs_you') ev.push({ at: t.updated_at || t.created_at, a, text: `يطلب موافقتك: ${t.needs_note || t.title}`, k: 'ask' });
    ev.push({ at: t.created_at, a, text: `استلم مهمة: ${t.title}`, k: 'ok' });
  }
  ev.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  const queues = office.agents.filter((a) => a.items.length).map((a) => a.items.slice(0, 12).map((it) => ({ a, text: it.text, href: it.href, k: it.level === 'bad' ? 'bad' : it.level === 'warn' ? 'warn' : 'ok' })));
  const rr = [];
  for (let i = 0; queues.some((q) => q[i]); i++) queues.forEach((q) => q[i] && rr.push(q[i]));
  return { events: ev.slice(0, 6), review: rr };
}
const VERB = { ok: 'تم', warn: 'تنبيه', bad: 'عاجل', ask: 'يحتاج موافقتك' };

export async function renderOffice(el) {
  el.innerHTML = '<div class="loading">الموظفين يجهزون مكاتبهم…</div>';
  let d;
  try { d = await loadAll(); } catch (e) { el.innerHTML = html`<div class="form-error">${errorText(e)}</div>`; return; }
  const { office, tasks, reports } = d;
  const admin = !!api.currentUser()?.is_admin;
  const ready = tasks !== null;
  const daily = (reports || []).find((r) => r.kind === 'daily');
  const weekly = (reports || []).find((r) => r.kind === 'weekly');
  const live = buildBrief(office, tasks || []);
  const waiting = (tasks || []).filter((t) => t.status === 'needs_you');
  const staff = office.agents.filter((a) => a.id !== 'manager');
  const working = office.agents.filter((a) => a.state !== 'idle').length;
  const P = {}; // صور الروبوتات من المشهد الثلاثي الأبعاد (تُملأ بعد التحميل)
  const kpi = { scanned: staff.reduce((n, a) => n + a.scanned, 0), alerts: staff.reduce((n, a) => n + a.items.length, 0), waiting: waiting.length, done: staff.reduce((n, a) => n + a.doneToday, 0) };

  el.innerHTML = html`
    <div class="page-head"><div><h1>مكتب الأسطول الذكي</h1>
      <p class="muted small">أنت المدير، وتحتك ثمانية موظفين ذكاء اصطناعي. كل واحد يتابع قسمه من بياناتك ويرفع لك طلب موافقة قبل أي إجراء حساس. اسحب المكتب لتدويره واضغط على أي موظف.</p></div></div>

    <section class="o3-stage" id="o3" aria-label="المكتب ثلاثي الأبعاد"><div class="o3-loading">يجهز المكتب…</div><div class="o3-hud"></div><div class="o3-toast" role="status"></div>
      <div class="o3-legend" aria-hidden="true"><span><i class="st-working"></i>يشتغل</span><span><i class="st-waiting"></i>ينتظر موافقتك</span><span><i class="st-alert"></i>تنبيه</span><span><i class="st-idle"></i>هادئ</span></div></section>
    <div id="of-detail"></div>

    <section class="ops" data-office data-ops aria-label="غرفة المتابعة">
      <div class="ops-head"><div style="display:grid;gap:4px"><span class="ops-live"><i></i>مباشر · <span class="num">${working}</span> من <span class="num">${office.agents.length}</span> يشتغلون</span><h2>غرفة المتابعة</h2>
        <p class="sub">كل موظف وش يراجع، وش لقى، ووش رفع لك. الأرقام من بياناتك الفعلية.</p></div></div>
      <div class="ops-kpis">
        <div class="ops-kpi ok"><small>سجلات يتابعونها</small><b class="num" data-kpi="scanned">${num(kpi.scanned)}</b></div>
        <div class="ops-kpi bad"><small>تنبيهات مفتوحة</small><b class="num" data-kpi="alerts">${num(kpi.alerts)}</b></div>
        <a class="ops-kpi warn" href="#of-needs"><small>تنتظر موافقتك</small><b class="num" data-kpi="waiting">${num(kpi.waiting)}</b></a>
        <div class="ops-kpi"><small>أنجزوا اليوم</small><b class="num" data-kpi="done">${num(kpi.done)}</b></div>
      </div>
      <div class="ops-box"><h3>أرضية المكتب <span class="note">الموظف يمشي لمكتبك لما يرفع تنبيه عاجل أو يطلب موافقة</span></h3><canvas class="ops-pix" width="320" height="120" aria-hidden="true"></canvas></div>
      <div class="ops-grid">
        <div class="ops-box"><h3>سير المهام بينك وبين الموظفين <span class="note">الأخضر إنجاز · البرتقالي موافقة · الأحمر عاجل</span></h3><svg class="ops-net" viewBox="0 0 520 330" role="img" aria-label="شبكة المهام"></svg></div>
        <div class="ops-box"><h3>سجل المتابعة <span class="note">آخر ١٠</span></h3><ul class="ops-feed" data-feed></ul></div>
      </div>
      <div class="ops-agents">${raw(staff.map((a) => html`<button type="button" class="ops-ag" data-ag="${a.id}">
        <span class="top"><span data-pic="${a.id}" class="av-wrap">${raw(P[a.id] ? `<img class="av" src="${P[a.id]}" alt="">` : botSvg(a).replace('class="of-pic"', 'class="av"'))}</span><span class="dot" style="background:${DOTC[a.state]}"></span><span class="nm">${a.name}</span><span class="rl">${a.role}</span></span>
        <span class="nums"><span><b class="num">${num(a.scanned)}</b>يتابع</span><span><b class="num">${num(a.items.length)}</b>تنبيه</span><span><b class="num">${num(a.done.length)}</b>أنجز</span></span>
        ${raw(spark(a.spark))}<span class="doing" data-doing>${a.items[0] ? a.items[0].text : a.db ? 'ما عنده شي مفتوح' : 'يحتاج تطوير'}</span></button>`).join(''))}</div>
    </section>

    <h2 class="of-h2">الفريق</h2>
    <div class="of-team" data-team>${raw(office.agents.map((a) => room(a, P)).join(''))}</div>

    <section class="panel of-needs" id="of-needs" data-needs>
      <header><h2>${icon('shield')} طلبات تنتظر موافقتك</h2><span class="count num">${waiting.length}</span></header>
      <div class="of-lock">${icon('shield')}<div><b>القرار لك وحدك.</b> ما يقدر أي موظف يعتمد مصروف، أو يحذف بيانات، أو يعدّل سجل حساس، أو ينفذ إجراء مالي، إلا بعد «موافق» منك.</div></div>
      ${raw(!ready ? '<p class="muted pad" data-not-ready>قسم المهام والموافقات يشتغل بعد تحديث قاعدة البيانات (0028).</p>'
        : waiting.length ? html`<ul class="of-list">${raw(waiting.map((t) => html`<li class="of-task"><span class="of-who">${agentById(t.agent).name}</span>${raw(taskLi(t, admin))}</li>`).join(''))}</ul>` : '<p class="muted pad">ما فيه شي ينتظر موافقتك.</p>')}
    </section>

    <section class="panel of-brief" data-brief>
      <header><h2>${icon('calendar')} ${daily ? html`ملخص الصباح · <span class="num">${date(daily.report_date)}</span>` : 'ملخص مباشر الحين'}</h2></header>
      ${raw(daily ? reportView(daily.body || {}, 'ما فيه شي اليوم.') : reportView(live, 'كل شي تمام، ما فيه شي يحتاجك.'))}
      ${raw(daily ? html`<details class="of-livebox"><summary>الوضع الحين (محسوب مباشرة)</summary>${raw(reportView(live, 'كل شي تمام.'))}</details>` : '')}
    </section>

    <section class="panel of-ask" data-ask>
      <header><h2>${icon('chat')} اطلب من المدير</h2></header>
      ${raw(ready ? html`<form class="of-form">
        <textarea name="text" rows="3" placeholder="مثال: جهّز طلب صيانة للسيارة 1624 مكيف ما يبرد" aria-label="الطلب" required></textarea>
        <div class="of-form-row"><label><span>يروح لـ</span><select name="agent">${raw(TASK_AGENTS.map((a) => html`<option value="${a.id}">${a.name} · ${a.role}</option>`).join(''))}</select></label>
        <button class="btn btn-primary" type="submit">أرسل</button></div>
        <p class="muted small">الطلب يتسجل هنا، وClaude ينفذه في الجلسة الجاية أو في دورة الصبح. أي حذف أو تعديل بيانات يرجع لك بـ«موافق» قبل التنفيذ. الحوادث ما تستقبل مهام حتى يتطور قسمها، طلباتها تروح للمدير.</p>
      </form>` : '<p class="muted pad">يشتغل بعد تحديث قاعدة البيانات (0028).</p>')}
    </section>

    <section class="panel of-tasks" data-tasks>
      <header><h2>${icon('clock')} آخر المهام</h2><span class="count num">${(tasks || []).length}</span></header>
      ${raw((tasks || []).length ? html`<ul class="of-list">${raw(tasks.slice(0, 15).map((t) => html`<li class="of-task"><span class="of-who">${agentById(t.agent).name}</span>${raw(taskLi(t, false))}</li>`).join(''))}</ul>` : '<p class="muted pad">ما فيه مهام بعد.</p>')}
    </section>

    <section class="panel of-weekly" data-weekly>
      <header><h2>${icon('chart')} مكتبة الأسبوع ${raw(weekly ? html`· <span class="num">${date(weekly.report_date)}</span>` : '')}</h2></header>
      ${raw(weekly ? reportView(weekly.body || {}, 'ما فيه ملاحظات هالأسبوع.') : '<p class="muted pad">كل أسبوع يجتمعون في المكتبة: وش انعمل، وش خرب، وكيف يطوّرون شغلهم. أول مراجعة تظهر هنا يوم الخميس.</p>')}
    </section>

    <section class="panel" data-cap>
      <header><h2>${icon('gauge')} وش المنفذ فعلاً ووش يحتاج تطوير</h2></header>
      <div class="of-capwrap"><table class="of-cap"><thead><tr><th>الموظف</th><th>يتابع</th><th>ينفذ الحين</th><th>الحالة</th><th>يحتاج تطوير</th></tr></thead>
      <tbody>${raw(staff.map((a) => { const c = CAP[a.id]; return html`<tr><td><b>${a.name}</b><br><span class="muted small">${a.role}</span></td><td>${c[0]}</td><td>${c[1]}</td><td><span class="of-lvl ${CAPL[c[2]][1]}">${CAPL[c[2]][0]}</span></td><td>${c[3]}</td></tr>`; }).join(''))}</tbody></table></div>
      <p class="muted small">«العقل» الحين: قواعد ذكية داخل الموقع تحسب من بياناتك فوراً، وClaude (ذكاء اصطناعي حقيقي) ينفذ المهام والملخصات من مشروعك. الرد الفوري من الموظف داخل الموقع يحتاج مفتاح Claude API مدفوع.</p>
    </section>`;

  // ===== التفاعل =====
  let scene3 = null;
  const show = (id, fromScene) => {
    const a = office.agents.find((x) => x.id === id);
    if (!a) return;
    $('#of-detail', el).innerHTML = detail(a, admin, P);
    $$('.of-room', el).forEach((b) => b.classList.toggle('of-sel', b.dataset.agent === id));
    if (!fromScene) scene3?.select(id, false);
    $('#of-detail', el).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $$('.of-room', el).forEach((b) => b.addEventListener('click', () => show(b.dataset.agent)));
  $$('.ops-ag', el).forEach((b) => b.addEventListener('click', () => show(b.dataset.ag)));

  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { $('#of-detail', el).innerHTML = ''; $$('.of-room', el).forEach((b) => b.classList.remove('of-sel')); return; }
    const btn = e.target.closest('[data-decide]');
    if (!btn) return;
    const li = btn.closest('[data-task]');
    btn.disabled = true;
    try {
      await api.rpc('office_decide', { p_id: li.dataset.task, p_decision: btn.dataset.decide, p_note: $('.of-note', li)?.value || null });
      toast(btn.dataset.decide === 'approved' ? 'تمت الموافقة' : 'تم الرفض');
      renderOffice(el);
    } catch (err) { btn.disabled = false; toast(errorText(err), 'error'); }
  });

  const f = $('.of-form', el);
  if (f) {
    let touched = false;
    f.agent.addEventListener('change', () => { touched = true; });
    f.text.addEventListener('input', () => { if (!touched) f.agent.value = routeAgent(f.text.value); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = f.text.value.trim();
      if (!text) return;
      const title = text.split('\n')[0].slice(0, 90);
      const ag = agentById(f.agent.value);
      f.querySelector('button[type=submit]').disabled = true;
      try {
        await api.rpc('office_add_task', { p_agent: ag.db || 'manager', p_title: title, p_details: text === title ? null : text });
        toast(`وصل الطلب لـ${ag.name}`);
        renderOffice(el);
      } catch (err) { f.querySelector('button[type=submit]').disabled = false; toast(errorText(err), 'error'); }
    });
  }

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timers = [];
  const alive = () => el.isConnected && $('[data-ops]', el);
  const every = (ms, fn) => { const t = setInterval(() => { if (!alive()) { timers.forEach(clearInterval); return; } if (!document.hidden) fn(); }, ms); timers.push(t); };

  // ===== شبكة المهام =====
  const NS = 'http://www.w3.org/2000/svg', net = $('.ops-net', el);
  const nodes = { manager: { x: 260, y: 52 } };
  staff.forEach((a, i) => { nodes[a.id] = { x: 70 + (i % 4) * 126.6, y: i < 4 ? 186 : 280 }; });
  const drawNet = () => {
    let s = '';
    staff.forEach((a) => { const n = nodes[a.id], m = nodes.manager; s += `<path id="ofln-${a.id}" d="M${n.x},${n.y} Q${(n.x + m.x) / 2},${(n.y + m.y) / 2 - 20} ${m.x},${m.y}" fill="none" stroke="#1F4434" stroke-width="1.4" stroke-dasharray="3 4"/>`; });
    for (const a of office.agents) {
      const n = nodes[a.id], mgr = a.id === 'manager', r = mgr ? 26 : 19;
      s += `<g data-node="${a.id}" style="cursor:pointer"><circle cx="${n.x}" cy="${n.y}" r="${r}" fill="#0F241B" stroke="${mgr ? '#D6B064' : DOTC[a.state]}" stroke-width="2"/>`
        + (P[a.id] ? `<image href="${P[a.id]}" x="${n.x - r + 2}" y="${n.y - r + 2}" width="${2 * r - 4}" height="${2 * r - 4}" clip-path="circle(${r - 3}px)"/>` : `<circle cx="${n.x}" cy="${n.y}" r="${r - 6}" fill="${a.bot.c}"/><text x="${n.x}" y="${n.y + 3.5}" text-anchor="middle" style="font-size:9px;font-weight:700;fill:#0B1511">${CODE[a.id]}</text>`)
        + `<text x="${n.x}" y="${n.y + (mgr ? -33 : 33)}" text-anchor="middle">${a.name}</text>${mgr ? '' : `<text class="l2" x="${n.x}" y="${n.y + 46}" text-anchor="middle">${a.role}</text>`}</g>`;
    }
    net.innerHTML = s + '<g data-pk></g>';
  };
  drawNet();
  net.addEventListener('click', (e) => { const g = e.target.closest('[data-node]'); if (g) show(g.dataset.node); });
  const packets = [];
  const packet = (id, k) => {
    const path = net.querySelector('#ofln-' + id); if (!path || still) return;
    const c = document.createElementNS(NS, 'circle'); c.setAttribute('r', 4.5); c.setAttribute('fill', k === 'ask' || k === 'warn' ? '#F0B04A' : k === 'bad' ? '#F07A6E' : '#5BD39D');
    net.querySelector('[data-pk]').appendChild(c); packets.push({ c, path, len: path.getTotalLength(), t: 0 });
  };
  (function anim() {
    if (!alive()) return;
    for (let i = packets.length - 1; i >= 0; i--) { const p = packets[i]; p.t += 0.018; const pt = p.path.getPointAtLength(Math.min(p.len, p.t * p.len)); p.c.setAttribute('cx', pt.x); p.c.setAttribute('cy', pt.y); if (p.t >= 1) { p.c.remove(); packets.splice(i, 1); } }
    requestAnimationFrame(anim);
  })();

  // ===== أرضية البكسل =====
  const cv = $('.ops-pix', el), px = cv.getContext && cv.getContext('2d');
  const desk = { manager: { x: 152, y: 18 } }; staff.forEach((a, i) => { desk[a.id] = { x: 22 + (i % 4) * 78, y: i < 4 ? 62 : 92 }; });
  const walkers = staff.map((a) => ({ a, x: desk[a.id].x + 10, y: desk[a.id].y - 4, tx: null, ty: null, back: false, wait: 0, bub: 0, k: 'ok' }));
  const walkTo = (id, k) => { const w = walkers.find((x) => x.a.id === id); if (!w || w.tx != null || w.wait > 0) return; w.tx = desk.manager.x + 4 + ((Math.random() * 16) | 0); w.ty = desk.manager.y + 16; w.k = k; w.back = false; };
  const PIX = { ball: ['.###.', '#####', '#####', '#####', '.###.'], hex: ['.###.', '#####', '#####', '#####', '.###.'], drop: ['..#..', '.###.', '#####', '#####', '.###.'], cube: ['#####', '#####', '#####', '#####', '#####'],
    tri: ['..#..', '.###.', '.###.', '#####', '#####'], pill: ['.###.', '#####', '#####', '#####', '.###.'], ghost: ['.###.', '#####', '#####', '#####', '#.#.#'], gem: ['..#..', '.###.', '#####', '.###.', '..#..'] };
  const bot = (x, y, a, hop) => {
    x = Math.round(x); y = Math.round(y) - (hop ? 1 : 0);
    px.fillStyle = 'rgba(0,0,0,.4)'; px.fillRect(x, y + 7 + (hop ? 1 : 0), 5, 1);
    px.fillStyle = a.bot.c; PIX[a.bot.shape].forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') px.fillRect(x + i, y + 1 + j, 1, 1); }));
    px.fillStyle = '#fff'; px.fillRect(x + 1, y + 3, 1, 1); px.fillRect(x + 3, y + 3, 1, 1);
    if (a.bot.crown) { px.fillStyle = '#F5D27A'; px.fillRect(x + 1, y, 3, 1); px.fillRect(x + 1, y - 1, 1, 1); px.fillRect(x + 3, y - 1, 1, 1); }
    else { px.fillStyle = DOTC[a.state]; px.fillRect(x + 2, y - 1, 1, 1); }
  };
  const mgr = office.agents.find((a) => a.id === 'manager');
  const t0 = performance.now();
  (function floor() {
    if (!alive() || !px) return;
    requestAnimationFrame(floor);
    if (document.hidden) return;
    const t = (performance.now() - t0) / 1000;
    px.fillStyle = '#0D1A14'; px.fillRect(0, 0, 320, 120);
    px.fillStyle = '#10221A'; for (let x = 0; x < 320; x += 8) for (let y = 0; y < 120; y += 8) if ((x + y) % 16 === 0) px.fillRect(x, y, 8, 8);
    px.fillStyle = '#16382A'; px.fillRect(110, 4, 100, 36); px.strokeStyle = '#D6B064'; px.strokeRect(110.5, 4.5, 99, 35);
    px.fillStyle = '#6B4A2E'; px.fillRect(146, 22, 28, 6); px.fillStyle = '#3FD38E'; px.fillRect(156, 19, 8, 3);
    bot(157, 12, mgr, still ? 0 : (t * 2 | 0) % 2);
    staff.forEach((a) => { const dd = desk[a.id]; px.fillStyle = '#132A20'; px.fillRect(dd.x - 6, dd.y - 12, 38, 26); px.fillStyle = '#7A5A3A'; px.fillRect(dd.x, dd.y + 2, 24, 5);
      px.fillStyle = a.state !== 'idle' && (t * 3 | 0) % 2 ? '#5BD39D' : '#1F4434'; px.fillRect(dd.x + 8, dd.y - 1, 8, 3); px.fillStyle = DOTC[a.state]; px.fillRect(dd.x + 28, dd.y - 10, 2, 2); });
    walkers.forEach((w) => {
      let moving = false;
      if (w.wait > 0) { w.wait -= 1 / 60; if (w.wait <= 0) { w.tx = desk[w.a.id].x + 10; w.ty = desk[w.a.id].y - 4; w.back = true; } }
      else if (w.tx != null) {
        const dx = w.tx - w.x, dy = w.ty - w.y;
        if (Math.hypot(dx, dy) < 0.8) { w.x = w.tx; w.y = w.ty; if (w.back) w.tx = w.ty = null; else { w.wait = 1.6; w.bub = 1.6; } }
        else { const sp = 0.7; if (Math.abs(dy) > 0.8 && Math.abs(dx) > 0.8 && !w.back) w.y += Math.sign(dy) * Math.min(sp, Math.abs(dy)); else { w.x += Math.sign(dx) * Math.min(sp, Math.abs(dx)); w.y += Math.sign(dy) * Math.min(sp, Math.abs(dy)); } moving = true; }
      }
      bot(w.x, w.y, w.a, moving ? (t * 8 | 0) % 2 : still ? 0 : ((t * 2 + w.x) | 0) % 2);
      if (w.bub > 0) { w.bub -= 1 / 60; const X = Math.round(w.x), Y = Math.round(w.y); px.fillStyle = w.k === 'ask' ? '#F0B04A' : w.k === 'bad' ? '#F07A6E' : '#5BD39D'; px.fillRect(X + 5, Y - 7, 6, 5); px.fillRect(X + 6, Y - 2, 1, 1); px.fillStyle = '#0B1511'; px.fillRect(X + 7, Y - 6, 2, 1); px.fillRect(X + 7, Y - 4, 2, 1); }
    });
  })();

  // ===== السجل =====
  const feed = $('[data-feed]', el);
  const src = feedSource(office, tasks);
  const add = (e, at) => {
    const li = document.createElement('li'); li.className = e.k === 'ok' ? '' : e.k;
    li.innerHTML = html`<time class="num">${at}</time><span><b>${e.a.name}</b> ${raw(e.href ? html`<a href="${e.href}">${e.text}</a>` : html`${e.text}`)}</span><span class="v">${VERB[e.k]}</span>`;
    feed.prepend(li); while (feed.children.length > 10) feed.lastChild.remove();
  };
  [...src.events].reverse().forEach((e) => add(e, hhmm(e.at)));
  if (!src.events.length && !src.review.length) feed.innerHTML = '<li><span></span><span>كل شي هادئ، ما فيه شغل مفتوح.</span><span></span></li>';
  let ri = 0;
  const step = () => {
    if (!src.review.length) return;
    const e = src.review[ri++ % src.review.length];
    add({ ...e, text: `يراجع: ${e.text}` }, hhmm());
    const card = $(`.ops-ag[data-ag="${e.a.id}"] [data-doing]`, el); if (card) card.textContent = e.text;
    packet(e.a.id, e.k);
    if (e.k === 'bad') walkTo(e.a.id, 'bad');
    scene3?.pulse(e.a.id, e.k, e.k === 'bad' ? `${e.a.name} رفع تنبيه عاجل` : null, e.text);
  };
  for (let i = 0; i < Math.min(4, src.review.length); i++) step();
  if (!still) {
    every(2800, step);
    every(9000, () => { const w = staff.find((a) => a.waiting.length); if (w) { walkTo(w.id, 'ask'); packet(w.id, 'ask'); scene3?.pulse(w.id, 'ask', `${w.name} يطلب موافقتك`, w.waiting[0].needs_note || w.waiting[0].title); } });
  }

  // ===== المكتب الثلاثي الأبعاد (يُحمَّل بعد الصفحة) =====
  const host = $('#o3', el);
  const skip3d = navigator.webdriver && !window.__office3d; // الاختبارات الآلية بدون WebGL
  if (skip3d) { host.classList.add('o3-off'); return; }
  try {
    const { mountOffice3D } = await import('../office3d.js');
    scene3 = await mountOffice3D(host, office.agents, { onSelect: (id) => show(id, true) });
  } catch { scene3 = null; }
  if (!scene3) { host.classList.add('o3-off'); return; }
  Object.assign(P, scene3.portraits || {});
  $$('[data-pic]', el).forEach((s) => { const a = agentById(s.dataset.pic); if (!P[a.id]) return; s.innerHTML = s.classList.contains('av-wrap') ? `<img class="av" src="${P[a.id]}" alt="">` : `<img class="of-pic" src="${P[a.id]}" alt="">`; });
  drawNet();
}
