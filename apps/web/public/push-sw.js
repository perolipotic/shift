/*
 * Story 10.4: the service worker's push handlers, loaded by the generated
 * `sw.js` through `importScripts` (`vite.config.ts`, generateSW). Kept out of
 * the precache, and with no `fetch` handler: the worker still caches nothing
 * at runtime (story 8.1).
 *
 * The payload is `notify`'s: `{ title, body, url, tag }`, where `url` is the
 * organization's sign-in route returning to the surface
 * (`/prijava/<slug>?povratak=<path>`) and `tag` is `<code>:<subject_id>`, so a
 * re-send of one fact replaces its notification rather than stacking. A tap
 * navigates a window this worker controls, or opens one; a failed navigation
 * opens one too. Only this app's own origin is ever opened.
 */

/* global self, clients, URL */

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  if (data === null || typeof data !== 'object') data = {};

  const title = typeof data.title === 'string' && data.title !== '' ? data.title : 'Shift';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/pwa-192x192.png',
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  };
  if (typeof data.tag === 'string' && data.tag !== '') options.tag = data.tag;

  event.waitUntil(self.registration.showNotification(title, options));
});

/** The tapped notification's url, on this origin only; anything else is `/`. */
function targetOf(raw) {
  const origin = self.location.origin;
  try {
    const target = new URL(typeof raw === 'string' ? raw : '/', origin);
    return target.origin === origin ? target.href : new URL('/', origin).href;
  } catch {
    return new URL('/', origin).href;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = targetOf(event.notification.data && event.notification.data.url);
  const open = () => clients.openWindow(url);

  event.waitUntil(
    // Controlled windows only: `navigate` works on a window this worker
    // controls, so any other (or none) gets a new window.
    clients
      .matchAll({ type: 'window' })
      .then((windows) => {
        const controlled = windows.find(
          (client) => new URL(client.url).origin === self.location.origin && 'navigate' in client,
        );
        if (controlled === undefined) return open();
        return controlled
          .navigate(url)
          .then((navigated) => (navigated ? navigated.focus() : open()));
      })
      .catch(open),
  );
});
