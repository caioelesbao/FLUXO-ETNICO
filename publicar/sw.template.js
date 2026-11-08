// Guarda o sistema no aparelho. Páginas e scripts: tenta a internet primeiro (pega versões novas) e cai no que está guardado.
// Chamadas ao Supabase NÃO passam por aqui (outro endereço): o próprio sistema guarda os dados.
const V = 'fe-__VERSAO__', ARQUIVOS = __ARQUIVOS__;
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then(m => m || caches.match('./'))));
});
