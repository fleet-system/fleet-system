// إشعارات الجوال: تفعيلها على هذا الجهاز، تجربتها، وإيقافها.
import * as api from './api.js';

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export function registerWorker() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('sw.js').catch(() => null);
}

const b64ToBytes = (s) => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function currentSub() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// الحالة: unsupported | needs_install | denied | on | off
export async function status() {
  if (isIOS() && !isStandalone()) return 'needs_install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const s = await currentSub();
  return s && Notification.permission === 'granted' ? 'on' : 'off';
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  const dev = /iPhone/.test(ua) ? 'آيفون' : /iPad/.test(ua) ? 'آيباد' : /Android/.test(ua) ? 'أندرويد' : /Windows/.test(ua) ? 'ويندوز' : /Mac/.test(ua) ? 'ماك' : 'جهاز';
  return `${dev} · ${new Date().toISOString().slice(0, 10).replace(/-/g, '/')}`;
}

export async function enable() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'DENIED' : 'DISMISSED');
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerWorker());
  await navigator.serviceWorker.ready;
  const { key } = await api.fn('push', { action: 'public-key' });
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  const j = sub.toJSON();
  await api.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_label: deviceLabel() });
  return sub;
}

export async function disable() {
  const sub = await currentSub();
  if (!sub) return;
  await api.rpc('disable_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export const test = () => api.fn('push', { action: 'test' });

// إشعار المعتمدين بطلب صيانة أُرسل للاعتماد (لا يوقف العمل إن فشل)
export function notifyRequest(id) {
  if (!id) return;
  api.fn('push', { action: 'request', id }).catch(() => {});
}
