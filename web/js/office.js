// 1.37/1.38: «مكتب الأسطول» (طلب المالك بعد فيديو شركة بموظفين ذكاء اصطناعي): المنطق الخالص بدون DOM.
// كل «موظف» مسؤول عن ملف، شغله المفتوح يُحسب من البيانات الموجودة (قراءة فقط) + مهام office_tasks.
import { norm } from './predict.js';

// 1.38: الموظفون الثمانية الجدد (طلب المالك) + المدير. كل موظف روبوت بشكل ولون (bot).
// id = معرّف الواجهة؛ db = قيمته في office_tasks.agent (بدون تغيير قاعدة البيانات: القيم المسموحة في 0028 كما هي).
// الحوادث بدون db: القسم مخفي وفاضي، ما يستقبل مهام حتى يُطوَّر (المهام تروح للمدير).
export const AGENTS = [
  { id: 'manager',     db: 'manager',     name: 'عبدالرحمن', role: 'المدير',             bot: { c: '#D6B064', shape: 'ball', crown: true }, room: 'manager', kw: [] },
  { id: 'fleet',       db: 'excel',       name: 'راشد',  role: 'إدارة المركبات',          bot: { c: '#4C8DFF', shape: 'ball' },  room: 'work', kw: ['مركبه', 'موقع', 'حاله', 'عداد', 'ممشى', 'لوحه', 'بطاقه', 'تسليم', 'مستخدم'] },
  { id: 'maintenance', db: 'maintenance', name: 'فهد',   role: 'الصيانة',                 bot: { c: '#F59E3A', shape: 'hex' },   room: 'work', kw: ['صيانه', 'ورشه', 'عطل', 'فني', 'مكيف', 'كهرب', 'قير', 'محرك', 'رديتر', 'فرامل', 'تقرير فحص', 'اصلاح', 'خربان'] },
  { id: 'oil',         db: 'oil',         name: 'سلمان', role: 'الزيوت والكيلومترات',     bot: { c: '#F5C542', shape: 'drop' },  room: 'work', kw: ['زيت', 'كفر', 'كفرات', 'اطار', 'بنشر', 'بطاريه', 'فلتر', 'كيلو'] },
  { id: 'docs',        db: 'docs',        name: 'ريم',   role: 'الوثائق',                 bot: { c: '#F062A8', shape: 'cube' },  room: 'work', kw: ['استماره', 'تامين', 'فحص دوري', 'رخصه', 'مفوض', 'تفويض', 'وثيقه', 'وثائق', 'تجديد', 'انتهاء'] },
  { id: 'accidents',   db: null,          name: 'ماجد',  role: 'الحوادث',                 bot: { c: '#F05252', shape: 'tri' },   room: 'work', kw: ['حادث', 'حوادث', 'تقدير', 'نجم', 'صدمه', 'مصدوم'] },
  { id: 'expenses',    db: 'custody',     name: 'نورة',  role: 'المصروفات',               bot: { c: '#3FD38E', shape: 'pill' },  room: 'work', kw: ['فاتوره', 'فواتير', 'سداد', 'مدفوع', 'دفع', 'مصروف', 'مصاريف', 'تكلفه', 'تكاليف', 'مبلغ', 'تحويل', 'عهده', 'اكسل', 'excel', 'مزامنه', 'شيت'] },
  { id: 'reports',     db: 'reports',     name: 'عبير',  role: 'التقارير',                bot: { c: '#EEF1F6', shape: 'ghost', phones: true }, room: 'work', kw: ['تقرير', 'كشف', 'جرد', 'قائمه', 'pdf', 'ملخص', 'احصائ'] },
  { id: 'purchasing',  db: 'food',        name: 'خالد',  role: 'المشتريات',               bot: { c: '#9B6BFF', shape: 'gem' },   room: 'work', kw: ['شراء', 'مشتريات', 'مورد', 'موردين', 'عرض سعر', 'قطع غيار', 'طلب شراء', 'تموين', 'اكل', 'طعام'] },
];
// يقبل معرّف الواجهة أو قيمة قاعدة البيانات (office_tasks.agent)
export const agentById = (id) => AGENTS.find((a) => a.id === id) || AGENTS.find((a) => a.db === id) || AGENTS[0];
// الموظفون اللي يستقبلون مهام (لهم قيمة في قاعدة البيانات)
export const TASK_AGENTS = AGENTS.filter((a) => a.db);

// المدير يوزع الطلب: أكثر موظف تطابقت كلماته مع الطلب، وإلا يبقى عنده. الحوادث (بدون db) ترجع للمدير.
export function routeAgent(text) {
  const t = norm(text);
  let best = 'manager', score = 0;
  for (const a of AGENTS) {
    const s = a.kw.reduce((n, k) => n + (t.includes(norm(k)) ? norm(k).length : 0), 0);
    if (s > score) { score = s; best = a.id; }
  }
  return agentById(best).db ? best : 'manager';
}

// المستويات Lv1..Lv10 حسب النقاط
export const LEVELS = [0, 50, 150, 300, 500, 800, 1200, 1700, 2300, 3000];
export function levelOf(xp) {
  let lv = 1;
  LEVELS.forEach((min, i) => { if (xp >= min) lv = i + 1; });
  const next = LEVELS[lv] ?? null;
  const from = LEVELS[lv - 1];
  return { lv, xp, next, pct: next == null ? 100 : Math.round(((xp - from) / (next - from)) * 100) };
}
export const XP = { history: 5, done: 20 };

const OPEN_MR = ['new', 'pending_supervisor', 'approved', 'in_progress'];
const TASK_OPEN = ['new', 'working', 'needs_you'];
const DAY = 864e5;
const days = (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / DAY);

// يجمع لكل موظف: شغله المفتوح (items)، مهامه، نقاطه ومستواه، عدد السجلات اللي يراجعها (scanned)، نشاطه آخر 14 يوم (spark)، وحالته
// data: { requests, docs, costs, alerts (من الصيانة التنبؤية مع plate/vid), vehicles, accidents, tasks, now (ISO) }
export function buildOffice({ requests = [], docs = [], costs = [], alerts = [], vehicles = [], accidents = [], tasks = [], now = new Date().toISOString() }) {
  const ids = AGENTS.map((a) => a.id);
  const items = Object.fromEntries(ids.map((id) => [id, []]));
  const history = Object.fromEntries(ids.map((id) => [id, 0]));
  const scanned = Object.fromEntries(ids.map((id) => [id, 0]));
  const spark = Object.fromEntries(ids.map((id) => [id, Array(14).fill(0)]));
  const today = Date.parse(now.slice(0, 10));
  const mark = (id, d) => { if (!d) return; const k = Math.floor((today - Date.parse(String(d).slice(0, 10))) / DAY); if (k >= 0 && k < 14) spark[id][13 - k]++; };

  for (const v of vehicles) {
    scanned.fleet++; history.fleet++;
    const age = v.odometer_updated_at ? days(v.odometer_updated_at, now) : null;
    if (age == null || age > 30) items.fleet.push({ kind: 'odometer', level: age == null ? 'warn' : 'info', text: `${v.plate_no || v.code || ''}: ${age == null ? 'ما فيه قراءة عداد مسجلة' : `آخر قراءة عداد قبل ${age} يوم`}`, href: `#/vehicles/${v.id}` });
    mark('fleet', v.odometer_updated_at);
  }
  for (const r of requests) {
    history.maintenance++; scanned.maintenance++; mark('maintenance', r.request_date);
    if (OPEN_MR.includes(r.status)) items.maintenance.push({ kind: 'request', level: r.status === 'new' || r.status === 'pending_supervisor' ? 'warn' : 'info', text: `طلب صيانة ${r.request_no || ''}: ${r.fault || ''}`.trim(), href: `#/requests/${r.id}`, status: r.status });
  }
  for (const d of docs) {
    scanned.docs++;
    if (d.status === 'valid') history.docs++;
    if (d.status === 'expired' || d.status === 'expiring') items.docs.push({ kind: 'doc', level: d.status === 'expired' ? 'bad' : 'warn', text: `${d.subject_label || ''}: ${d.doc_label || d.doc_type} ${d.status === 'expired' ? 'منتهية' : 'تنتهي قريباً'}`, href: d.owner_type === 'vehicle' ? `#/vehicles/${d.owner_id}?tab=docs` : '#/documents', days: d.days_left });
  }
  let lastSync = null;
  const suppliers = new Set();
  for (const c of costs) {
    history.expenses++; scanned.expenses++; mark('expenses', c.line_date);
    if (c.category !== 'maintenance') { history.oil++; scanned.oil++; mark('oil', c.line_date); }
    if (c.supplier) suppliers.add(String(c.supplier).trim());
    if (c.payment_status === 'غير مدفوع') items.expenses.push({ kind: 'unpaid', level: 'warn', text: `فاتورة غير مدفوعة${c.supplier ? ' · ' + c.supplier : ''}${c.plate_text ? ' · ' + c.plate_text : ''}`, amount: Number(c.amount) || 0, href: '#/costs' });
    if (c.synced_at && (!lastSync || c.synced_at > lastSync)) lastSync = c.synced_at;
  }
  scanned.purchasing = history.purchasing = suppliers.size;
  const syncAge = lastSync ? days(lastSync, now) : null;
  if (lastSync == null) items.expenses.push({ kind: 'sync', level: 'warn', text: 'ما وصلت أي مزامنة من ملف الإكسل', href: '#/costs' });
  else if (syncAge >= 3) items.expenses.push({ kind: 'sync', level: syncAge >= 7 ? 'bad' : 'warn', text: `آخر مزامنة للإكسل قبل ${syncAge} يوم، تأكد إن برنامج المزامنة شغال باللابتوب`, href: '#/costs' });
  for (const a of alerts) {
    if (['oil', 'tires', 'puncture', 'battery'].includes(a.kind)) items.oil.push({ kind: a.kind, level: a.level, text: `${a.plate}: ${a.text}`, href: `#/vehicles/${a.vid}?tab=costs` });
    else if (a.kind === 'fault') items.maintenance.push({ kind: 'fault', level: a.level, text: `${a.plate}: ${a.text}`, href: '#/predict' });
    else if (a.kind === 'cost') items.expenses.push({ kind: 'cost', level: a.level, text: `${a.plate}: ${a.text}`, href: `#/vehicles/${a.vid}?tab=costs` });
  }
  for (const x of accidents) { scanned.accidents++; history.accidents++; mark('accidents', x.accident_date); }

  const recent = (t) => t.done_at && days(t.done_at, now) < 1;
  const rank = (l) => (l === 'bad' ? 0 : l === 'warn' ? 1 : 2);
  const out = AGENTS.map((a) => {
    const mine = a.db ? tasks.filter((t) => t.agent === a.db && t.is_active !== false) : [];
    mine.forEach((t) => mark(a.id, t.created_at));
    const open = mine.filter((t) => TASK_OPEN.includes(t.status));
    const done = mine.filter((t) => t.status === 'done');
    const waiting = open.filter((t) => t.status === 'needs_you');
    const xp = history[a.id] * XP.history + done.length * XP.done;
    const its = items[a.id].sort((x, y) => rank(x.level) - rank(y.level));
    const busy = open.length + its.length;
    const alerting = its.some((x) => x.level === 'bad');
    const state = waiting.length ? 'waiting' : alerting ? 'alert' : busy ? 'working' : 'idle';
    return { ...a, items: its, tasks: mine, open, done, waiting, delivered: done.some(recent), doneToday: done.filter(recent).length, level: levelOf(xp), busy, state, scanned: scanned[a.id], spark: spark[a.id] };
  });
  return { agents: out, lastSync, syncAge };
}

// الملخص الصباحي (نفس شكل office_reports.body): مهامك اليوم، يحتاجك، وش اللي خرب
export function buildBrief(office, tasks = []) {
  const needs = tasks.filter((t) => t.status === 'needs_you' && t.is_active !== false).map((t) => ({ text: `${agentById(t.agent).name} (${agentById(t.agent).role}): ${t.needs_note || t.title}`, task: t.id }));
  const broke = [];
  const today = [];
  for (const a of office.agents) {
    for (const it of a.items) {
      if (it.level === 'bad' || it.kind === 'sync') broke.push({ agent: a.id, text: it.text, href: it.href });
      else if (it.level === 'warn') today.push({ agent: a.id, text: it.text, href: it.href });
    }
  }
  return { today: today.slice(0, 12), needs_you: needs, broke: broke.slice(0, 12), counts: { today: today.length, needs_you: needs.length, broke: broke.length } };
}
