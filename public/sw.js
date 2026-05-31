const CACHE_VERSION = 'iiser-shifts-v4';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  '/',
  '/admin',
  '/staff',
  '/worker-detail',
  '/offline.html',
  '/css/style.css',
  '/js/login.js',
  '/js/admin.js',
  '/js/staff.js',
  '/js/worker-detail.js',
  '/js/logout-confirm.js',
  '/js/utils.js',
  '/js/pwa.js',
  '/img/iiserb-logo.png',
  '/img/pwa-icon-192.png',
  '/img/pwa-icon-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationRequest(request));
    return;
  }

  if (request.method === 'GET' && /\.(js|css)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (request.method === 'GET') {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('push', event => {
  let payload = {
    title: 'Shift reminder',
    body: 'Your shift starts soon.',
    url: '/staff',
    tag: 'shift-reminder'
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (error) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/img/pwa-icon-192.png',
      badge: '/img/pwa-icon-96.png',
      tag: payload.tag,
      renotify: true,
      data: {
        url: payload.url || '/staff',
        ...(payload.data || {})
      }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data && event.notification.data.url || '/staff', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const existingClient = clientList.find(client => client.url === targetUrl);
      if (existingClient) return existingClient.focus();
      return clients.openWindow(targetUrl);
    })
  );
});

async function navigationRequest(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    return cached || caches.match('/offline.html');
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (request.method === 'GET' && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.method === 'GET') {
      const cached = await caches.match(request);
      if (cached) return cached;
    }

    return new Response(
      JSON.stringify({ error: 'Offline. Reconnect to sync the latest shift data.' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await caches.match(request);
  const fresh = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || fresh;
}
