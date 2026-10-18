// telecipher service worker：只做 Web Push，不攔截 fetch。新版立即接管。
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let p = {}
  try { p = event.data ? event.data.json() : {} } catch { p = {} }
  event.waitUntil(self.registration.showNotification(p.title || 'telecipher', {
    body: p.body || '',
    tag: p.tag || 'telecipher',
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { id: p.id, url: p.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {}
  event.notification.close()
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (clients.length) {
      try { await clients[0].focus() } catch (_) {}
      clients[0].postMessage({ type: 'openRequest', id: data.id })
    } else {
      await self.clients.openWindow(data.url || '/')
    }
  })())
})
