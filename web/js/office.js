// 1.37: «مكتب الأسطول» (طلب المالك بعد فيديو شركة بموظفين ذكاء اصطناعي): المنطق الخالص بدون DOM.
// كل «موظف» مسؤول عن ملف، شغله المفتوح يُحسب من البيانات الموجودة (قراءة فقط) + مهام office_tasks.
import { norm } from './predict.js';

// الموظفون بالترتيب الذي يظهر في المكتب. shirt/hair = ألوان الشخصية المرسومة
export const AGENTS = [
  { id: 'manager',     name: 'عبدالرحمن', role: 'المدير',          shirt: '#C2410C', hair: '#3b2416', room: 'manager', kw: [] },
  { id: 'maintenance', name: 'فهد',   role: 'الصيانة',               shirt: '#2563EB', hair: '#1f1f1f', room: 'work', kw: ['صيانه', 'ورشه', 'عطل', 'فني', 'فحص', 'مكيف', 'كهرب', 'قير', 'محرك', 'رديتر', 'فرامل', 'تقرير فحص', 'اصلاح'] },
  { id: 'excel',       name: 'نورة',  role: 'الإكسل والمزامنة',      shirt: '#15803D', hair: '#4a2c1a', room: 'work', kw: ['اكسل', 'excel', 'شيت', 'ورقه', 'مزامنه', 'قاعده البيانات', 'جدول', 'onedrive', 'ون درايف'] },
  { id: 'custody',     name: 'خالد',  role: 'العهد والفواتير',        shirt: '#7C3AED', hair: '#262626', room: 'work', kw: ['عهده', 'فاتوره', 'فواتير', 'سداد', 'مدفوع', 'دفع', 'مورد', 'حساب', 'مبلغ', 'تحويل'] },
  { id: 'docs',        name: 'ريم',   role: 'الوثائق والاستمارات',    shirt: '#DB2777', hair: '#2b1a10', room: 'work', kw: ['استماره', 'تامين', 'فحص دوري', 'رخصه', 'مفوض', 'تفويض', 'وثيقه', 'وثائق', 'تجديد', 'انتهاء'] },
  { id: 'oil',         name: 'سلمان', role: 'الزيوت والكفرات',        shirt: '#CA8A04', hair: '#1c1c1c', room: 'work', kw: ['زيت', 'كفر', 'كفرات', 'اطار', 'بنشر', 'بطاريه', 'فلتر', 'ممشى', 'عداد'] },
  { id: 'reports',     name: 'عبير',  role: 'التقارير والكشوفات',     shirt: '#0891B2', hair: '#3a2a1a', room: 'work', kw: ['تقرير', 'كشف', 'جرد', 'قائمه', 'pdf', 'ملخص', 'احصائ', 'بطاقه'] },
  { id: 'food',        name: 'ماجد',  role: 'التموين',                shirt: '#65A30D', hair: '#222', room: 'work', kw: ['تموين', 'اكل', 'طعام', 'غذائ', 'صرف المواد', 'سكن', 'عمال'] },
];
export const agentById = (id) => AGENTS.find((a) => a.id === id) || AGENTS[0];

// «المديرة» توزع الطلب: أكثر موظف تطابقت كلماته مع الطلب، وإلا تبقى عندها
export function routeAgent(text) {
  const t = norm(text);
  let best = 'manager', score = 0;
  for (const a of AGENTS) {
    const s = a.kw.reduce((n, k) => n + (t.includes(norm(k)) ? norm(k).length : 0), 0);
    if (s > score) { score = s; best = a.id; }
  }
  return best;
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

// يجمع لكل موظف: شغله المفتوح (items)، مهامه، نقاطه ومستواه، وحالته (يشتغل/فاضي/ينتظرك)
// data: { requests, docs, costs, alerts (من الصيانة التنبؤية مع plate/vid), tasks, now (ISO) }
export function buildOffice({ requests = [], docs = [], costs = [], alerts = [], tasks = [], now = new Date().toISOString() }) {
  const items = Object.fromEntries(AGENTS.map((a) => [a.id, []]));
  const history = Object.fromEntries(AGENTS.map((a) => [a.id, 0]));

  for (const r of requests) {
    history.maintenance++;
    if (OPEN_MR.includes(r.status)) items.maintenance.push({ kind: 'request', level: r.status === 'new' || r.status === 'pending_supervisor' ? 'warn' : 'info', text: `طلب صيانة ${r.request_no || ''}: ${r.fault || ''}`.trim(), href: `#/requests/${r.id}`, status: r.status });
  }
  for (const d of docs) {
    if (d.status === 'valid') history.docs++;
    if (d.status === 'expired' || d.status === 'expiring') items.docs.push({ kind: 'doc', level: d.status === 'expired' ? 'bad' : 'warn', text: `${d.subject_label || ''}: ${d.doc_label || d.doc_type} ${d.status === 'expired' ? 'منتهية' : 'تنتهي قريباً'}`, href: d.owner_type === 'vehicle' ? `#/vehicles/${d.owner_id}?tab=docs` : '#/documents', days: d.days_left });
  }
  let lastSync = null;
  for (const c of costs) {
    history.excel++;
    if (c.category !== 'maintenance') history.oil++;
    if (c.payment_status === 'مدفوع') history.custody++;
    if (c.payment_status === 'غير مدفوع') items.custody.push({ kind: 'unpaid', level: 'warn', text: `فاتورة غير مدفوعة${c.supplier ? ' · ' + c.supplier : ''}${c.plate_text ? ' · ' + c.plate_text : ''}`, amount: Number(c.amount) || 0, href: '#/costs' });
    if (c.synced_at && (!lastSync || c.synced_at > lastSync)) lastSync = c.synced_at;
  }
  const syncAge = lastSync ? days(lastSync, now) : null;
  if (lastSync == null) items.excel.push({ kind: 'sync', level: 'warn', text: 'ما وصلت أي مزامنة من ملف الإكسل', href: '#/costs' });
  else if (syncAge >= 3) items.excel.push({ kind: 'sync', level: syncAge >= 7 ? 'bad' : 'warn', text: `آخر مزامنة للإكسل قبل ${syncAge} يوم، تأكد إن برنامج المزامنة شغال باللابتوب`, href: '#/costs' });
  for (const a of alerts) {
    if (['oil', 'tires', 'puncture', 'battery'].includes(a.kind)) items.oil.push({ kind: a.kind, level: a.level, text: `${a.plate}: ${a.text}`, href: `#/vehicles/${a.vid}?tab=costs` });
    else if (a.kind === 'fault') items.maintenance.push({ kind: 'fault', level: a.level, text: `${a.plate}: ${a.text}`, href: '#/predict' });
  }

  const recent = (t) => t.done_at && days(t.done_at, now) < 1;
  const out = AGENTS.map((a) => {
    const mine = tasks.filter((t) => t.agent === a.id && t.is_active !== false);
    const open = mine.filter((t) => TASK_OPEN.includes(t.status));
    const done = mine.filter((t) => t.status === 'done');
    const waiting = open.filter((t) => t.status === 'needs_you');
    const xp = history[a.id] * XP.history + done.length * XP.done;
    const its = items[a.id].sort((x, y) => (x.level === 'bad' ? 0 : x.level === 'warn' ? 1 : 2) - (y.level === 'bad' ? 0 : y.level === 'warn' ? 1 : 2));
    const busy = open.length + its.length;
    const state = waiting.length ? 'waiting' : busy ? 'working' : 'idle';
    return { ...a, items: its, tasks: mine, open, done, waiting, delivered: done.some(recent), level: levelOf(xp), busy, state };
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
