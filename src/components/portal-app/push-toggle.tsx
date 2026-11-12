"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Bell, BellOff, Check, Loader2, Smartphone } from "lucide-react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/server/actions/client-app";
import {
  detectPlatform,
  getServiceWorker,
  isStandalone,
  pushSupported,
  urlBase64ToUint8Array,
} from "@/lib/pwa-client";
import { Button } from "@/components/ui";

type State = "loading" | "off" | "on" | "denied" | "needs-install" | "unsupported" | "not-configured";

/**
 * Pushmeldingen aan- en uitzetten op dit apparaat. Toestemming vragen mag alleen
 * na een tik (eis van iOS), dus dit gebeurt altijd via de knop.
 */
export function PushToggle({
  vapidPublicKey,
  compact = false,
  onEnabled,
}: {
  vapidPublicKey: string | null;
  compact?: boolean;
  onEnabled?: () => void;
}) {
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const refresh = useCallback(async () => {
    if (!vapidPublicKey) return setState("not-configured");
    const platform = detectPlatform();
    if (platform === "ios" && !isStandalone()) return setState("needs-install");
    if (!pushSupported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    try {
      const reg = await getServiceWorker();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    } catch {
      setState("off");
    }
  }, [vapidPublicKey]);

  useEffect(() => {
    // Asynchroon starten: de status hangt af van browser-API's.
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  function enable() {
    setMessage(null);
    start(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        await getServiceWorker();
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
          }));
        const json = sub.toJSON();
        const saved = await savePushSubscription({
          endpoint: json.endpoint!,
          keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! },
          platform: detectPlatform(),
        });
        if (!saved.ok) {
          setMessage(saved.message ?? "Aanzetten is niet gelukt.");
          return;
        }
        setState("on");
        onEnabled?.();
        const test = await sendTestPush();
        setMessage(test.ok ? "Gelukt. Je krijgt zo een testmelding." : (test.message ?? null));
      } catch {
        setMessage("Aanzetten is niet gelukt. Probeer het opnieuw.");
      }
    });
  }

  function disable() {
    setMessage(null);
    start(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await removePushSubscription({ endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
        setState("off");
      } catch {
        setMessage("Uitzetten is niet gelukt. Probeer het opnieuw.");
      }
    });
  }

  if (state === "loading") return compact ? null : <div className="h-11" aria-hidden />;
  if (compact && (state === "on" || state === "unsupported" || state === "not-configured")) return null;

  return (
    <div className="space-y-2">
      {state === "on" ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1d6b4c]">
            <Check className="size-4" /> Meldingen staan aan op dit apparaat
          </span>
          <Button variant="secondary" size="sm" onClick={disable} disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <BellOff className="size-3.5" />} Uitzetten
          </Button>
        </div>
      ) : null}

      {state === "off" ? (
        <Button size="lg" className="w-full sm:w-auto" onClick={enable} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />} Meldingen aanzetten
        </Button>
      ) : null}

      {state === "needs-install" ? (
        <div className="flex items-start gap-2 text-sm text-[var(--color-ink-muted)]">
          <Smartphone className="mt-0.5 size-4 shrink-0" />
          <p>
            Op een iPhone werken meldingen alleen in de app op je beginscherm.{" "}
            <Link href="/portal/app" className="font-semibold text-[var(--color-ink)] underline underline-offset-2">
              Zo installeer je de app
            </Link>
          </p>
        </div>
      ) : null}

      {state === "denied" ? (
        <p className="text-sm text-[var(--color-ink-muted)]">
          Meldingen zijn geblokkeerd voor Shortclips. Zet ze aan via de instellingen van je telefoon
          {detectPlatform() === "ios" ? " (Instellingen > Berichtgeving > Shortclips)" : " (Instellingen > Apps > Shortclips > Meldingen)"}.
        </p>
      ) : null}

      {state === "unsupported" && !compact ? (
        <p className="text-sm text-[var(--color-ink-muted)]">Deze browser ondersteunt geen meldingen. Gebruik de app op je telefoon.</p>
      ) : null}

      {state === "not-configured" && !compact ? (
        <p className="text-sm text-[var(--color-ink-muted)]">Pushmeldingen worden binnenkort ingeschakeld. Tot die tijd krijg je je meldingen per e-mail.</p>
      ) : null}

      {message ? <p className="text-xs text-[var(--color-ink-muted)]">{message}</p> : null}
    </div>
  );
}
