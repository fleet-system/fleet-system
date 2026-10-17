// عامل الخدمة: يستقبل إشعارات الجوال ويفتح الصفحة المناسبة عند الضغط عليها.
// لا يخزّن الموقع مؤقتاً (لا يوجد fetch handler) حتى تبقى التحديثات فورية كما هي.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'نظام إدارة الأسطول';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'favicon-48.png',
    lang: 'ar',
    dir: 'rtl',
    tag: d.tag || undefined,
    data: { url: d.url || '#/dashboard' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL('./' + (e.notification.data?.url || '#/dashboard'), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); return w.navigate ? w.navigate(target) : undefined; }
    }
    return self.clients.openWindow(target);
  })());
});
