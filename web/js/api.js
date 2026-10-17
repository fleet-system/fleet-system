// طبقة الاتصال بـ Supabase عبر fetch مباشرة (بدون مكتبات خارجية)
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const STORE_KEY = 'fleet.session.v1';
let session = null;
let me = null; // { id, email, full_name, is_admin, perms:Set }

function save(s) {
  session = s;
  try { s ? localStorage.setItem(STORE_KEY, JSON.stringify(s)) : localStorage.removeItem(STORE_KEY); } catch (_) {}
}
function load() {
  try { session = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (_) { session = null; }
  return session;
}

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

async function authCall(path, body) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (_) { throw new ApiError('NETWORK', 0, 'NETWORK'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error_description || j.msg || j.message || 'auth_error', r.status, j.error || j.error_code);
  return j;
}

function toSession(j) {
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user?.id, email: j.user?.email },
  };
}

export async function signIn(email, password) {
  const j = await authCall('token?grant_type=password', { email: email.trim(), password });
  save(toSession(j));
  return loadMe();
}

let refreshing = null;
async function ensureFresh() {
  if (!session) return;
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - now > 60) return;
  if (!refreshing) {
    refreshing = authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then((j) => save(toSession(j)))
      // لا نمسح الجلسة عند انقطاع الإنترنت؛ فقط إذا رفض الخادم رمز التجديد فعلاً
      .catch((e) => { if (e.status >= 400 && e.status < 500) save(null); throw e; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function signOut() {
  try {
    if (session) await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
    });
  } catch (_) {}
  save(null); me = null;
}

// استعادة الجلسة عند فتح الموقع. عند انقطاع الإنترنت نرمي خطأ NETWORK ونُبقي الجلسة
// حتى لا يُطلب من المستخدم تسجيل الدخول من جديد (ولا يظن أن بياناته ضاعت).
export async function restore() {
  if (!load()) return null;
  try { await ensureFresh(); return await loadMe(); }
  catch (e) {
    if (e && e.code === 'NETWORK') throw e;
    if (e && e.status >= 400 && e.status < 500) { save(null); return null; }
    throw e;
  }
}

async function loadMe() {
  const id = session.user.id;
  const [prof] = await get('profiles', { select: 'user_id,full_name,email,is_admin,is_active', user_id: `eq.${id}` });
  const perms = await get('user_permissions', { select: 'permission', user_id: `eq.${id}` });
  me = {
    id, email: session.user.email,
    full_name: prof?.full_name || session.user.email,
    is_admin: !!prof?.is_admin, is_active: prof?.is_active !== false,
    perms: new Set(perms.map((p) => p.permission)),
  };
  return me;
}

export const currentUser = () => me;
export const can = (p) => !!me && me.is_active && (me.is_admin || me.perms.has(p));

// ---------------------------------------------------------------------
// REST (PostgREST)
// ---------------------------------------------------------------------
async function request(method, path, { query, body, prefer } = {}) {
  await ensureFresh();
  const qs = query ? '?' + Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (session) headers.Authorization = `Bearer ${session.access_token}`;
  if (prefer) headers.Prefer = prefer;
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/${path}${qs}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError('NETWORK', 0, 'NETWORK');
  }
  if (r.status === 401) { save(null); location.hash = '#/login'; throw new ApiError('SESSION_EXPIRED', 401, 'SESSION_EXPIRED'); }
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(data?.message || 'error', r.status, data?.code);
  const range = r.headers.get('Content-Range');
  if (range && Array.isArray(data)) data.total = Number(range.split('/')[1]);
  return data;
}

// Supabase يعيد 1000 صف كحد أقصى في الطلب الواحد. عند عدم تحديد limit نجلب كل الصفوف على صفحات
// بترتيب ثابت (مع مفتاح فريد لكسر التعادل) حتى لا تنقص الإجماليات بصمت عند كبر البيانات.
const PAGE = 1000;
const UNIQUE_KEY = {
  profiles: 'user_id', user_permissions: 'user_id,permission', app_settings: 'key', employee_private: 'employee_id', vehicle_private: 'vehicle_id', delegate_private: 'delegate_id',
  v_document_status: 'owner_type,owner_id,doc_type', v_expenses: 'category,record_id', v_followups: 'subject_type,subject_id,alert_type',
  v_vehicle_oil_status: 'vehicle_id', v_vehicle_authorization: 'vehicle_id',
};
function stableOrder(table, order) {
  const keys = (UNIQUE_KEY[table] || 'id').split(',');
  const have = new Set((order || '').split(',').filter(Boolean).map((p) => p.split('.')[0]));
  return [...(order ? order.split(',') : []), ...keys.filter((k) => !have.has(k))].join(',');
}
export async function get(table, query = {}, opts = {}) {
  if (query.limit !== undefined) return request('GET', table, { query, prefer: opts.count ? 'count=exact' : undefined });
  const order = stableOrder(table, query.order);
  // الصفحة الأولى تعيد العدد الكلي، ثم تُجلب بقية الصفحات بالتوازي
  const first = await request('GET', table, { query: { ...query, order, limit: PAGE }, prefer: 'count=exact' });
  const total = Number.isFinite(first.total) ? first.total : null;
  let all = first;
  if (first.length === PAGE) {
    if (total !== null) {
      const offs = []; for (let o = PAGE; o < total; o += PAGE) offs.push(o);
      const pages = await Promise.all(offs.map((o) => request('GET', table, { query: { ...query, order, limit: PAGE, offset: o } })));
      all = first.concat(...pages);
    } else {
      for (let o = PAGE; ; o += PAGE) { const pg = await request('GET', table, { query: { ...query, order, limit: PAGE, offset: o } }); all = all.concat(pg); if (pg.length < PAGE) break; }
    }
  }
  if (opts.count) all.total = total ?? all.length;
  return all;
}
// ---------------------------------------------------------------------
// إضافة السجلات بدون تكرار عند إعادة المحاولة
// كل سجل جديد يأخذ معرّفاً ثابتاً (UUID) يُنشأ في المتصفح. إذا انقطع الاتصال بعد وصول الطلب إلى الخادم
// ثم ضغط المستخدم «حفظ» مرة أخرى بنفس البيانات، نستخدم المعرّف نفسه ونتحقق أولاً هل السجل محفوظ؛
// فإن كان محفوظاً نعيده كما هو بدل إنشاء نسخة مكررة.
// ---------------------------------------------------------------------
const NATURAL_KEY = { employee_private: ['employee_id'], vehicle_private: ['vehicle_id'], user_permissions: ['user_id', 'permission'], app_settings: ['key'] };
const pendingInserts = new Map(); // payload -> { ids, at }
export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => ((o[key] = x[key]), o), {}) : x));
export async function insert(table, rows) {
  const many = Array.isArray(rows), list = many ? rows : [rows];
  const now = Date.now();
  for (const [k, p] of pendingInserts) if (now - p.at > 30 * 60000) pendingInserts.delete(k);
  const key = `${table}|${stable(list)}`;
  const prev = pendingInserts.get(key);
  let body = list, ids = null, already = [];
  if (NATURAL_KEY[table]) {
    if (prev && list.length === 1) {
      const q = { select: '*', limit: 1 }; NATURAL_KEY[table].forEach((c) => { q[c] = `eq.${list[0][c]}`; });
      const found = await request('GET', table, { query: q }).catch(() => []);
      if (found.length) { pendingInserts.delete(key); return found; }
    }
  } else {
    ids = prev ? prev.ids : list.map((r) => r.id || newId());
    body = list.map((r, i) => (r.id ? r : { id: ids[i], ...r }));
    if (prev) {
      const found = await request('GET', table, { query: { select: '*', id: `in.(${ids.join(',')})` } });
      if (found.length === list.length) { pendingInserts.delete(key); return found; }
      const have = new Set(found.map((f) => f.id));
      body = body.filter((r) => !have.has(r.id)); already = found;
    }
  }
  let res;
  try { res = await request('POST', table, { body: many ? body : body[0], prefer: 'return=representation' }); }
  catch (e) { pendingInserts.set(key, { ids, at: now }); throw e; } // نتيجة غير مؤكدة: نتذكر المعرّفات لإعادة المحاولة
  pendingInserts.delete(key);
  return already.length ? already.concat(res || []) : res;
}
export const update = (table, filters, values) => request('PATCH', table, { query: filters, body: values, prefer: 'return=representation' });
export const rpc = (fn, args = {}) => request('POST', `rpc/${fn}`, { body: args });

// ---------------------------------------------------------------------
// التخزين الدائم (Supabase Storage) — حاوية خاصة اسمها attachments
// ---------------------------------------------------------------------
export const BUCKET = 'attachments';

export async function uploadFile(path, blob, contentType) {
  await ensureFresh();
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'content-type': contentType || 'application/octet-stream', 'x-upsert': 'false', 'cache-control': 'max-age=3600' },
      body: blob,
    });
  } catch (_) { throw new ApiError('NETWORK', 0, 'NETWORK'); }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new ApiError(j.message || j.error || `UPLOAD_FAILED ${r.status}`, r.status, j.statusCode || 'UPLOAD');
  }
  return path;
}

// رابط مؤقت (ساعة) لعرض الملف أو تنزيله — لا يُنشأ إلا إذا كان المستخدم يملك صلاحية رؤية المرفق
export async function signedUrl(path, expiresIn = 3600, download = false) {
  await ensureFresh();
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  if (!r.ok) throw new ApiError('PERMISSION_DENIED', r.status, 'SIGN');
  const j = await r.json();
  return encodeURI(`${SUPABASE_URL}/storage/v1${j.signedURL}`) + (download ? '&download=' : '');
}

export const remove = (table, filters) => request('DELETE', table, { query: filters, prefer: 'return=representation' });

// استدعاء دالة Supabase (Edge Function) باسم المستخدم الحالي
export async function fn(name, body = {}) {
  await ensureFresh();
  if (!session) throw new ApiError('SESSION_EXPIRED', 401, 'SESSION_EXPIRED');
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (_) { throw new ApiError('NETWORK', 0, 'NETWORK'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || 'error', r.status, j.error);
  return j;
}
