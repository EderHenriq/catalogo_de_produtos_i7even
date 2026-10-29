/*
 * Service worker mínimo: só mostra os avisos de vencimento (core/notify.js)
 * e abre o sistema em "A receber" quando a pessoa toca no aviso.
 * Não intercepta requisições e não guarda nada em cache - uma atualização
 * do site aparece na hora, como sempre.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './#/receber', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        try { await c.navigate(url); } catch { /* aba de outra origem */ }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
