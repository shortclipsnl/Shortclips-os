/*
 * Service worker van de Shortclips klant-app.
 *
 * Doet bewust maar twee dingen: pushmeldingen tonen en bij een tik de juiste
 * pagina openen. Er wordt geen klantdata op het toestel bewaard (geen offline
 * cache), zodat elke pagina altijd vers en server-side gecontroleerd is.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Alleen eigen portaalpaden openen; al het andere wordt het overzicht. */
function safeHref(href) {
  if (typeof href !== "string" || !href.startsWith("/portal")) return "/portal";
  if (href.startsWith("//") || href.includes("\\") || href.includes("://")) return "/portal";
  return href;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Shortclips", body: event.data ? event.data.text() : "" };
  }

  // iOS trekt het abonnement in als een push geen zichtbare melding toont,
  // dus er wordt áltijd een melding getoond.
  const title = data.title || "Shortclips";
  const options = {
    body: data.body || "Er staat iets nieuws voor je klaar.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { href: safeHref(data.href) },
    lang: "nl",
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // App-icoon met een stip/teller waar het toestel dat ondersteunt.
      self.navigator && "setAppBadge" in self.navigator
        ? self.navigator.setAppBadge().catch(() => undefined)
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = safeHref(event.notification.data && event.notification.data.href);
  const target = new URL(href, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) return client.navigate(target);
          return undefined;
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
