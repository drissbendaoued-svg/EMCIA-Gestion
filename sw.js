const scope = new URL(self.registration.scope);
const appPages = new Set(['', 'index.html', 'emcia.html'].map(path => new URL(path, scope).pathname));

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.mode !== 'navigate' || url.origin !== scope.origin || !appPages.has(url.pathname)) return;

  // Revalidate the app on every launch. Leave cloud requests and authentication data outside the worker.
  event.respondWith(fetch(request, { cache: 'no-cache' }).catch(() => new Response(`<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMCIA Gestion</title>
<style>body{font:1rem/1.6 system-ui,sans-serif;background:#f3f7fb;color:#102a43;padding:24px}main{max-width:380px;margin:12vh auto;padding:20px;background:white;border-radius:16px}button{min-height:44px;padding:8px 16px;border:0;border-radius:8px;background:#175d8d;color:white;font:inherit}</style></head>
<body><main><h1>EMCIA Gestion</h1><p>تعذّر الاتصال. تحقق من اتصالك بالإنترنت، ثم أعد المحاولة.</p>
<button type="button" onclick="location.reload()">إعادة المحاولة</button></main></body></html>`, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  })));
});
