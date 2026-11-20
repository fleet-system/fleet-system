// 1.37: صفحة «مكتب الأسطول»: مكتب مرسوم فيه موظفين ذكاء اصطناعي، كل واحد مسؤول عن ملف.
// القراءة من البيانات الموجودة فقط؛ الكتابة الوحيدة: إضافة مهمة للمديرة، وقرار «موافق/لا» للمسؤول (دوال office_*).
import * as api from '../api.js';
import { html, raw, icon, toast, $, $$ } from '../ui.js';
import { num, date, label, errorText } from '../fmt.js';
import { loadPredictions } from './predict.js';
import { AGENTS, agentById, routeAgent, buildOffice, buildBrief } from '../office.js';

// شخصية بكسل أصلية (12×14): H شعر، S بشرة، E عين، T قميص، P بنطلون، B حذاء
const SPRITE = [
  '....HHHH....', '...HHHHHH...', '...HSSSSH...', '...SESSES...', '...SSSSSS...', '....SSSS....', '..TTTTTTTT..',
  '.TTTTTTTTTT.', '.STTTTTTTTS.', '.STTTTTTTTS.', '..PPPPPPPP..', '..PP....PP..', '..PP....PP..', '.BBB....BBB.',
];
export function sprite(a) {
  const col = { H: a.hair, S: '#E8B98A', E: '#1b1b1b', T: a.shirt, P: '#334155', B: '#111827' };
  let r = '';
  SPRITE.forEach((row, y) => [...row].forEach((ch, x) => { if (col[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col[ch]}"/>`; }));
  return `<svg class="of-sprite" viewBox="0 0 12 14" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

const STATE = { working: 'يشتغل', idle: 'فاضي', waiting: 'ينتظر موافقتك' };
const TASK_ST = { new: 'جديدة', working: 'قيد التنفيذ', needs_you: 'تحتاجك', done: 'منجزة', rejected: 'مرفوضة' };
const LVL = { bad: 'عاجل', warn: 'قريب', info: 'متابعة' };

async function loadAll() {
  const [requests, docs, costs, pred, tasks, reports] = await Promise.all([
    api.get('maintenance_requests', { select: 'id,request_no,status,fault,request_date', deleted_at: 'is.null' }).catch(() => []),
    api.get('v_document_status', { select: 'owner_type,owner_id,doc_type,subject_label,expiry_date,days_left,status' }).catch(() => []),
    api.get('cost_lines', { select: 'category,payment_status,synced_at,amount,plate_text,supplier', is_active: 'is.true' }).catch(() => []),
    loadPredictions().catch(() => ({ rows: [] })),
    api.get('office_tasks', { select: '*', is_active: 'is.true', order: 'created_at.desc' }).catch(() => null),
    api.get('office_reports', { select: '*', order: 'report_date.desc', limit: 8 }).catch(() => null),
  ]);
  const alerts = pred.rows.flatMap((r) => r.alerts.map((a) => ({ ...a, plate: r.v.plate_no || r.v.code, vid: r.v.id })));
  docs.forEach((d) => { d.doc_label = label('doc_type', d.doc_type); });
  const office = buildOffice({ requests, docs, costs, alerts, tasks: tasks || [], now: new Date().toISOString() });
  return { office, tasks, reports };
}

const room = (a) => html`
  <button type="button" class="of-room ${a.room === 'manager' ? 'of-mgr' : ''} of-${a.state} ${a.delivered ? 'of-deliver' : ''}" data-agent="${a.id}" aria-label="${a.name}، ${a.role}، ${STATE[a.state]}">
    <span class="of-lamp" title="${a.state === 'idle' ? 'اللمبة طافية' : 'اللمبة شغالة'}"></span>
    ${raw(a.room === 'manager' ? '<span class="of-table"></span><span class="of-phone"></span>' : '<span class="of-shelf"></span>')}
    <span class="of-desk"><span class="of-pc"></span></span>
    <span class="of-char">${raw(sprite(a))}${raw(a.state === 'idle' ? '<i class="of-zzz">z z</i>' : '')}</span>
    ${raw(a.busy ? html`<span class="of-badge num" data-busy>${a.busy}</span>` : '')}
    <span class="of-lv num" data-lv>Lv ${a.level.lv}</span>
    <span class="of-plate"><b>${a.name}</b><small>${a.role}</small></span>
    <span class="of-bar" title="${a.level.xp} نقطة"><i style="width:${a.level.pct}%"></i></span>
  </button>`;

const itemLi = (it) => html`<li class="of-it of-${it.level}"><span class="of-pill">${LVL[it.level] || ''}</span>${raw(it.href ? html`<a href="${it.href}">${it.text}</a>` : html`<span>${it.text}</span>`)}</li>`;
const taskLi = (t, admin) => html`<li class="of-task" data-task="${t.id}"><span class="of-tst of-ts-${t.status}">${TASK_ST[t.status]}</span>
  <b class="num">#${t.task_no}</b> <span>${t.title}</span>${raw(t.needs_note ? html`<small class="of-need">${t.needs_note}</small>` : '')}${raw(t.result ? html`<small class="muted">النتيجة: ${t.result}</small>` : '')}
  ${raw(t.status === 'needs_you' && admin ? html`<span class="of-acts"><input class="of-note" placeholder="ملاحظة (اختياري)" aria-label="ملاحظة"><button class="btn btn-primary btn-sm" data-decide="approved">موافق</button><button class="btn btn-sm" data-decide="rejected">لا</button></span>` : '')}</li>`;

function detail(a, admin) {
  return html`<section class="panel of-detail" data-detail="${a.id}">
    <header><span class="of-av">${raw(sprite(a))}</span><div><h2>${a.name} · ${a.role}</h2>
      <p class="muted small">${STATE[a.state]} · المستوى <span class="num">${a.level.lv}</span> · <span class="num">${num(a.level.xp)}</span> نقطة${raw(a.level.next ? html` (باقي <span class="num">${num(a.level.next - a.level.xp)}</span> للمستوى التالي)` : '')}</p></div>
      <button class="icon-btn" data-close aria-label="إغلاق">${icon('close')}</button></header>
    ${raw(a.items.length ? html`<h3>الشغل المفتوح</h3><ul class="of-list">${raw(a.items.slice(0, 40).map(itemLi).join(''))}</ul>` : '<p class="muted pad">ما عنده شغل مفتوح الحين.</p>')}
    ${raw(a.tasks.length ? html`<h3>المهام</h3><ul class="of-list">${raw(a.tasks.slice(0, 20).map((t) => taskLi(t, admin)).join(''))}</ul>` : '')}
  </section>`;
}

// تقرير محفوظ (ملخص صباحي أو مكتبة الأسبوع) أو ملخص مباشر محسوب الآن
const SEC = [['needs_you', 'يحتاجك', 'shield'], ['broke', 'وش اللي خرب', 'alert'], ['today', 'مهامك اليوم', 'calendar'], ['done', 'اللي انعمل', 'wrench'], ['improve', 'كيف نطوّر الشغل', 'gauge'], ['levels', 'ترقيات', 'chart']];
function reportView(body, emptyText) {
  const parts = SEC.filter(([k]) => Array.isArray(body[k]) && body[k].length).map(([k, t, ic]) => html`<div class="of-rsec" data-rsec="${k}"><h3>${icon(ic)} ${t} <span class="count num">${body[k].length}</span></h3>
    <ul>${raw(body[k].map((x) => { const s = typeof x === 'string' ? x : x.text; const who = x.agent ? agentById(x.agent).name + ': ' : ''; return x.href ? html`<li>${who}<a href="${x.href}">${s}</a></li>` : html`<li>${who}${s}</li>`; }).join(''))}</ul></div>`);
  return html`${raw(body.summary ? html`<p class="of-sum">${body.summary}</p>` : '')}${raw(parts.length ? parts.join('') : html`<p class="muted pad">${emptyText}</p>`)}`;
}

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
  const mgr = office.agents.find((a) => a.id === 'manager');
  const staff = office.agents.filter((a) => a.id !== 'manager');
  const working = office.agents.filter((a) => a.state !== 'idle').length;

  el.innerHTML = html`
    <div class="page-head"><div><h1>مكتب الأسطول</h1>
      <p class="muted small">موظفين ذكاء اصطناعي، كل واحد ماسك ملف. اطلب من عبدالرحمن (المدير) وهو يوزّع. اللي لمبته شغالة عنده شغل، واضغط على أي مكتب تشوف شغله.</p></div></div>

    <section class="of-hq" data-office aria-label="المكتب">
      <div class="of-top"><span class="of-live">● مباشر</span><span><span class="num">${working}</span> من <span class="num">${office.agents.length}</span> يشتغلون</span>${raw(waiting.length ? html`<a href="#of-needs" class="of-alert">${icon('bell')} <span class="num">${waiting.length}</span> تنتظر موافقتك</a>` : '')}</div>
      <div class="of-floor">
        ${raw(room(mgr))}
        <div class="of-hall" aria-hidden="true"></div>
        <div class="of-rooms">${raw(staff.map(room).join(''))}</div>
        <div class="of-lib" aria-hidden="true"><span>مكتبة الأسبوع</span></div>
      </div>
    </section>
    <div id="of-detail"></div>

    <section class="panel of-brief" data-brief>
      <header><h2>${icon('calendar')} ${daily ? html`ملخص الصباح · <span class="num">${date(daily.report_date)}</span>` : 'ملخص مباشر الحين'}</h2></header>
      ${raw(daily ? reportView(daily.body || {}, 'ما فيه شي اليوم.') : reportView(live, 'كل شي تمام، ما فيه شي يحتاجك.'))}
      ${raw(daily ? html`<details class="of-livebox"><summary>الوضع الحين (محسوب مباشرة)</summary>${raw(reportView(live, 'كل شي تمام.'))}</details>` : '')}
    </section>

    <section class="panel of-needs" id="of-needs" data-needs>
      <header><h2>${icon('shield')} يحتاجك</h2><span class="count num">${waiting.length}</span></header>
      ${raw(!ready ? '<p class="muted pad" data-not-ready>قسم المهام والموافقات يشتغل بعد تحديث قاعدة البيانات (0028).</p>'
        : waiting.length ? html`<ul class="of-list">${raw(waiting.map((t) => taskLi(t, admin)).join(''))}</ul>` : '<p class="muted pad">ما فيه شي ينتظر موافقتك.</p>')}
    </section>

    <section class="panel of-ask" data-ask>
      <header><h2>${icon('chat')} اطلب من المدير</h2></header>
      ${raw(ready ? html`<form class="of-form">
        <textarea name="text" rows="3" placeholder="مثال: جهّز طلب صيانة للسيارة 1624 مكيف ما يبرد" aria-label="الطلب" required></textarea>
        <div class="of-form-row"><label><span>يروح لـ</span><select name="agent">${raw(AGENTS.map((a) => html`<option value="${a.id}">${a.name} · ${a.role}</option>`).join(''))}</select></label>
        <button class="btn btn-primary" type="submit">أرسل</button></div>
        <p class="muted small">الطلب يتسجل هنا، وClaude ينفذه في الجلسة الجاية أو في دورة الصبح. أي حذف أو تعديل بيانات يرجع لك بـ«موافق» قبل التنفيذ.</p>
      </form>` : '<p class="muted pad">يشتغل بعد تحديث قاعدة البيانات (0028).</p>')}
    </section>

    <section class="panel of-tasks" data-tasks>
      <header><h2>${icon('clock')} آخر المهام</h2><span class="count num">${(tasks || []).length}</span></header>
      ${raw((tasks || []).length ? html`<ul class="of-list">${raw(tasks.slice(0, 15).map((t) => html`<li class="of-task"><span class="of-who">${agentById(t.agent).name}</span>${raw(taskLi(t, false))}</li>`).join(''))}</ul>` : '<p class="muted pad">ما فيه مهام بعد.</p>')}
    </section>

    <section class="panel of-weekly" data-weekly>
      <header><h2>${icon('chart')} مكتبة الأسبوع ${raw(weekly ? html`· <span class="num">${date(weekly.report_date)}</span>` : '')}</h2></header>
      ${raw(weekly ? reportView(weekly.body || {}, 'ما فيه ملاحظات هالأسبوع.') : '<p class="muted pad">كل أسبوع يجتمعون في المكتبة: وش انعمل، وش خرب، وكيف يطوّرون شغلهم. أول مراجعة تظهر هنا يوم الخميس.</p>')}
    </section>`;

  const show = (id) => {
    const a = office.agents.find((x) => x.id === id);
    $('#of-detail', el).innerHTML = detail(a, admin);
    $$('.of-room', el).forEach((b) => b.classList.toggle('of-sel', b.dataset.agent === id));
    $('#of-detail', el).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $$('.of-room', el).forEach((b) => b.addEventListener('click', () => show(b.dataset.agent)));

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
      f.querySelector('button[type=submit]').disabled = true;
      try {
        await api.rpc('office_add_task', { p_agent: f.agent.value, p_title: title, p_details: text === title ? null : text });
        toast(`وصل الطلب لـ${agentById(f.agent.value).name}`);
        renderOffice(el);
      } catch (err) { f.querySelector('button[type=submit]').disabled = false; toast(errorText(err), 'error'); }
    });
  }
}
