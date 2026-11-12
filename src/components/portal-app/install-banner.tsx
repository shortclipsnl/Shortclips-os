"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Smartphone, X } from "lucide-react";
import { detectPlatform, isStandalone, noopSubscribe, pushSupported } from "@/lib/pwa-client";
import { PushToggle } from "./push-toggle";

const DISMISS_KEY = "sc-app-banner-dismissed";
const DISMISS_DAYS = 14;

/**
 * Korte balk bovenaan het portaal op een telefoon:
 *  - in de browser: "Zet Shortclips op je beginscherm" (naar de uitleg);
 *  - in de geïnstalleerde app zonder meldingen: "Zet meldingen aan".
 * Wegklikken onthoudt de keuze twee weken op dit apparaat.
 */
export function InstallBanner({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const pathname = usePathname();
  const detected = useSyncExternalStore(
    noopSubscribe,
    () => {
      try {
        const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
        if (until > Date.now()) return null;
      } catch {
        /* geen opslag: gewoon tonen */
      }
      if (detectPlatform() === "desktop") return null;
      if (!isStandalone()) return "install" as const;
      if (vapidPublicKey && pushSupported() && Notification.permission === "default") return "push" as const;
      return null;
    },
    () => null,
  );
  const [hidden, setHidden] = useState(false);
  const mode = hidden ? null : detected;

  // Alleen op Home: niet op elke pagina ruimte innemen.
  if (!mode || pathname !== "/portal") return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86_400_000));
    } catch {
      /* negeren */
    }
    setHidden(true);
  }

  if (mode === "install") {
    return (
      <div className="mb-5 flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] py-2.5 pl-3.5 pr-2 text-white lg:hidden">
        <Smartphone className="size-5 shrink-0" />
        <p className="min-w-0 flex-1 text-sm font-semibold leading-tight">Zet Shortclips op je beginscherm</p>
        <Link
          href="/portal/app"
          className="inline-flex h-9 shrink-0 items-center rounded-[var(--radius-sm)] bg-white px-3 text-sm font-semibold text-[var(--color-indigo-ink)]"
        >
          Hoe?
        </Link>
        <button type="button" onClick={dismiss} aria-label="Sluiten" className="p-1.5 text-white/70 hover:text-white">
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] p-4 text-white lg:hidden">
      <div className="flex items-start gap-3">
        <Bell className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Mis niets van je content</p>
          <p className="mt-0.5 text-xs text-white/75">Krijg een melding als er video&apos;s of scripts op je wachten.</p>
          <div className="mt-3 [&_button]:bg-white [&_button]:text-[var(--color-indigo-ink)] [&_p]:text-white/80">
            <PushToggle vapidPublicKey={vapidPublicKey} compact onEnabled={() => setTimeout(() => setHidden(true), 2500)} />
          </div>
        </div>
        <button type="button" onClick={dismiss} aria-label="Sluiten" className="-m-1 p-1 text-white/70 hover:text-white">
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}
