/* PRIM service worker — web push notifications.
 * Minimal + focused: handle incoming pushes and notification clicks.
 * Registered by src/lib/push.js on the client after the agent opts in. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text ? event.data.text() : '' }; }
  const title = data.title || 'PRIM';
  const options = {
    body: data.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'prim-alert',
    data: { url: data.url || 'https://www.primtracker.com' },
    requireInteraction: !!data.urgent,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || (self.location.origin + '/');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Only a window on the APP origin can receive the in-app view switch. A
      // subscription registered on www before the host split would otherwise
      // focus a marketing tab whose "/" is a rewrite to /landing.
      let sameOrigin = false;
      let view = null;
      try {
        const target = new URL(url);
        sameOrigin = target.origin === self.location.origin;
        view = target.searchParams.get('view');
      } catch { sameOrigin = false; }
      if (sameOrigin) {
        for (const client of clientList) {
          let pathname = null;
          try { pathname = new URL(client.url).pathname; } catch { pathname = null; }
          // Prefer the app shell ("/"): /pricing, /admin and the legal pages mount no listener.
          if (pathname === '/' && 'focus' in client) {
            return client.focus().then((c) => { if (view && c && typeof c.postMessage === 'function') c.postMessage({ type: 'prim:view', view }); });
          }
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
