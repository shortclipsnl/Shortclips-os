"use client";

import { useEffect } from "react";
import { savePushSubscription } from "@/server/actions/client-app";
import { detectPlatform, getServiceWorker, type BeforeInstallPromptEvent } from "@/lib/pwa-client";

/**
 * Onzichtbaar onderdeel van de portaal-layout:
 *  - registreert de service worker (nodig voor installeren en pushmeldingen);
 *  - bewaart het installatievoorstel van Chrome voor de knop "Installeer";
 *  - vernieuwt bij elke opening een bestaand push-abonnement, zodat een door
 *    iOS verlopen abonnement vanzelf weer op de server staat;
 *  - wist de teller op het app-icoon zodra de klant de app opent;
 *  - houdt de app actueel: een telefoon laat een app soms dagen open staan. Komt
 *    de klant na een kwartier terug, dan laadt de app de nieuwste versie en de
 *    nieuwste gegevens. Een nieuwe versie van het portaal is zo altijd vanzelf
 *    binnen, zonder App Store-update.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

/** Nooit herladen als de klant halverwege feedback of een formulier zit. */
function hasUnsavedInput(): boolean {
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input[type=text], input:not([type])");
  return Array.from(fields).some((f) => f.value.trim() !== "" && f.value !== f.defaultValue);
}

export function PortalAppRuntime({ pushEnabled }: { pushEnabled: boolean }) {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__scInstallPrompt = e as BeforeInstallPromptEvent;
      window.dispatchEvent(new Event("sc-install-available"));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    (async () => {
      try {
        const reg = await getServiceWorker();
        const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
        nav.clearAppBadge?.().catch(() => undefined);
        if (!reg || !pushEnabled || !("PushManager" in window)) return;
        if (Notification.permission !== "granted") return;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        const json = sub.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
        await savePushSubscription({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          platform: detectPlatform(),
        });
      } catch {
        /* nooit de pagina storen */
      }
    })();

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > STALE_AFTER_MS && !hasUnsavedInput()) {
        window.location.reload();
        return;
      }
      hiddenAt = null;
      navigator.serviceWorker?.getRegistration("/").then((r) => r?.update()).catch(() => undefined);
      const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
      nav.clearAppBadge?.().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pushEnabled]);

  return null;
}
