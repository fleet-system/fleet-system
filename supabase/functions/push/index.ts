// دالة Supabase: إشعارات الجوال (Web Push). verify_jwt=false لأنها تتحقق بنفسها:
//  - public-key / test / request: المستخدم المسجّل (رمز الدخول يُتحقق منه عند Supabase Auth).
//  - daily: المهمة اليومية فقط (المفتاح x-cron-key يطابق push_private.cron_key).
// مفاتيح الإرسال (VAPID) تُنشأ تلقائياً أول مرة وتُحفظ في push_private (لا يقرؤها إلا الخادم).
import webpush from 'npm:web-push@3.6.7';
import { dailyMessage, requestMessage, testMessage, isGone, sameKey, isUuid, riyadhDay } from './logic.js';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUBJECT = 'mailto:abdama700@gmail.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function rest(method: string, path: string, body?: unknown, prefer?: string) {
  const h: Record<string, string> = { apikey: SRK, Authorization: `Bearer ${SRK}`, 'Content-Type': 'application/json' };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status}`);
  return t ? JSON.parse(t) : null;
}

async function userId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const p = await rest('GET', `profiles?user_id=eq.${u.id}&is_active=eq.true&select=user_id`);
  return p?.length ? u.id : null;
}

async function keys() {
  let [k] = await rest('GET', 'push_private?id=eq.1&select=*');
  if (!k?.vapid_public) {
    const g = webpush.generateVAPIDKeys();
    await rest('PATCH', 'push_private?id=eq.1&vapid_public=is.null', { vapid_public: g.publicKey, vapid_private: g.privateKey });
    [k] = await rest('GET', 'push_private?id=eq.1&select=*');
  }
  webpush.setVapidDetails(SUBJECT, k.vapid_public, k.vapid_private);
  return k;
}

type Sub = { id: string; endpoint: string; p256dh: string; auth_key: string; fail_count: number };
async function send(subs: Sub[], msg: Record<string, string>) {
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, JSON.stringify(msg), { TTL: 86400, urgency: 'high' });
      sent++;
      await rest('PATCH', `push_subscriptions?id=eq.${s.id}`, { last_sent_at: new Date().toISOString(), fail_count: 0, last_error: null });
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode || 0;
      const patch: Record<string, unknown> = { last_error: `${code} ${String((e as Error).message || '').slice(0, 150)}`, fail_count: (s.fail_count || 0) + 1 };
      if (isGone(code) || (s.fail_count || 0) >= 9) patch.is_active = false;
      await rest('PATCH', `push_subscriptions?id=eq.${s.id}`, patch).catch(() => {});
    }
  }));
  return { sent, failed };
}

const log = (kind: string, ref: string | null, r: { sent: number; failed: number }, info = '') =>
  rest('POST', 'push_log', { kind, ref, sent: r.sent, failed: r.failed, info }).catch(() => {});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD' }, 405);
  let body: Record<string, string> = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  try {
    if (body.action === 'daily') {
      const k = await keys();
      if (!sameKey(req.headers.get('x-cron-key') || '', k.cron_key)) return json({ error: 'NOT_ALLOWED' }, 403);
      const day = riyadhDay();
      const done = await rest('GET', `push_log?kind=eq.daily&ref=eq.${day}&select=id&limit=1`);
      if (done.length) return json({ ok: true, skipped: 'already_sent' });
      const rows = await rest('GET', 'v_document_status?select=doc_type,subject_label,days_left,status&status=in.(expired,expiring)');
      const msg = dailyMessage(rows);
      if (!msg) { await log('daily', day, { sent: 0, failed: 0 }, 'nothing'); return json({ ok: true, skipped: 'nothing' }); }
      const subs = await rest('POST', 'rpc/push_targets', { p_perm: 'view' });
      const r = await send(subs, msg);
      await log('daily', day, r);
      return json({ ok: true, ...r });
    }

    const uid = await userId(req);
    if (!uid) return json({ error: 'NOT_SIGNED_IN' }, 401);
    const k = await keys();

    if (body.action === 'public-key') return json({ key: k.vapid_public });

    if (body.action === 'test') {
      const subs = await rest('GET', `push_subscriptions?user_id=eq.${uid}&is_active=eq.true&select=*`);
      if (!subs.length) return json({ error: 'NO_DEVICE' }, 404);
      const r = await send(subs, testMessage());
      await log('test', uid, r);
      return json({ ok: true, ...r });
    }

    if (body.action === 'request') {
      if (!isUuid(body.id)) return json({ error: 'BAD_ID' }, 400);
      const [mr] = await rest('GET', `maintenance_requests?id=eq.${body.id}&select=id,request_no,status,plate_no,fault`);
      const msg = requestMessage(mr);
      if (!msg) return json({ ok: true, skipped: 'not_pending' });
      const done = await rest('GET', `push_log?kind=eq.request&ref=eq.${body.id}&select=id&limit=1`);
      if (done.length) return json({ ok: true, skipped: 'already_sent' });
      const subs = await rest('POST', 'rpc/push_targets', { p_perm: 'approve_maintenance' });
      const r = await send(subs, msg);
      await log('request', body.id, r);
      return json({ ok: true, ...r });
    }
    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (_e) {
    return json({ error: 'UNAVAILABLE' }, 503);
  }
});
