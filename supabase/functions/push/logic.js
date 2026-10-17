// منطق رسائل إشعارات الجوال (بدون اتصال بالشبكة) — يُختبر في tests/push_logic_test.mjs
export const DOC_NAMES = {
  registration: 'استمارة',
  periodic_inspection: 'فحص',
  insurance: 'تأمين',
  vehicle_authorization: 'تفويض',
  delegate_license: 'رخصة مفوّض',
};
export const DAILY_TYPES = ['registration', 'periodic_inspection', 'insurance', 'vehicle_authorization'];

// تاريخ اليوم بتوقيت الرياض بصيغة YYYY-MM-DD (مفتاح منع التكرار اليومي)
export function riyadhDay(now = new Date()) {
  const d = new Date(now.getTime() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// rows: صفوف v_document_status (doc_type, subject_label, days_left, status)
export function dailyMessage(rows) {
  const r = (rows || []).filter((x) => DAILY_TYPES.includes(x.doc_type) && (x.status === 'expired' || x.status === 'expiring'));
  if (!r.length) return null;
  const expired = r.filter((x) => x.status === 'expired');
  const soon = r.filter((x) => x.status === 'expiring');
  const byType = {};
  for (const x of expired) byType[x.doc_type] = (byType[x.doc_type] || 0) + 1;
  const parts = DAILY_TYPES.filter((t) => byType[t]).map((t) => `${DOC_NAMES[t]} ${byType[t]}`);
  const lines = [];
  if (expired.length) lines.push(`منتهية: ${expired.length}${parts.length ? ` (${parts.join('، ')})` : ''}`);
  if (soon.length) {
    const next = [...soon].sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9))[0];
    lines.push(`تنتهي قريباً: ${soon.length} — أقربها ${DOC_NAMES[next.doc_type] || ''} ${cut(next.subject_label, 40)} بعد ${next.days_left} يوم`);
  }
  return { title: 'تنبيهات وثائق السيارات', body: lines.join('\n'), url: '#/dashboard', tag: 'daily-docs' };
}

export function requestMessage(req) {
  if (!req || req.status !== 'pending_supervisor') return null;
  const what = [req.request_no, cut(req.plate_no, 30), cut(req.fault, 70)].filter(Boolean).join(' • ');
  return { title: 'طلب صيانة بانتظار اعتمادك', body: what, url: `#/requests/${req.id}`, tag: `mr-${req.id}` };
}

export function testMessage() {
  return { title: 'تم تفعيل الإشعارات ✅', body: 'ستصلك على هذا الجهاز تنبيهات الوثائق وطلبات الصيانة.', url: '#/dashboard', tag: 'test' };
}

// 404/410 من خدمة الإشعارات = الجهاز ألغى الاشتراك نهائياً فيُؤرشف
export const isGone = (status) => status === 404 || status === 410;

// مقارنة ثابتة الزمن للمفاتيح
export function sameKey(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
