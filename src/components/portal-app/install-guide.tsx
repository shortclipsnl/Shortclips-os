"use client";

import { useState, useSyncExternalStore } from "react";
import { CheckCircle2, Download, EllipsisVertical, Loader2, PlusSquare, Share, Smartphone } from "lucide-react";
import { detectPlatform, isIosSafari, isStandalone, noopSubscribe } from "@/lib/pwa-client";

function subscribeInstall(cb: () => void) {
  window.addEventListener("sc-install-available", cb);
  window.addEventListener("appinstalled", cb);
  return () => {
    window.removeEventListener("sc-install-available", cb);
    window.removeEventListener("appinstalled", cb);
  };
}
import { Button, Card } from "@/components/ui";
import { PushToggle } from "./push-toggle";

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-indigo-ink)] text-sm font-semibold text-white">
        {n}
      </span>
      <div className="min-w-0 pt-1">
        <p className="text-sm font-semibold text-[var(--color-ink)]">{title}</p>
        {children ? <div className="mt-1 text-sm text-[var(--color-ink-muted)]">{children}</div> : null}
      </div>
    </li>
  );
}

/** Herkent het toestel en toont alleen de stappen die daar gelden. */
export function InstallGuide({ vapidPublicKey, portalUrl }: { vapidPublicKey: string | null; portalUrl: string }) {
  const platform = useSyncExternalStore(noopSubscribe, detectPlatform, () => null);
  const standalone = useSyncExternalStore(subscribeInstall, isStandalone, () => false);
  const safari = useSyncExternalStore(noopSubscribe, isIosSafari, () => true);
  const promptAvailable = useSyncExternalStore(subscribeInstall, () => Boolean(window.__scInstallPrompt), () => false);
  const [accepted, setAccepted] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const installed = standalone || accepted;
  const canPrompt = promptAvailable;

  async function installAndroid() {
    const prompt = window.__scInstallPrompt;
    if (!prompt) return;
    setPrompting(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setAccepted(true);
      window.__scInstallPrompt = null;
    } finally {
      setPrompting(false);
    }
  }

  if (!platform) return <div className="sc-card h-48" aria-hidden />;

  if (installed) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-[var(--color-good)]" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[var(--color-ink)]">De Shortclips app staat op je telefoon</p>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
              Zet meldingen aan, dan krijg je een seintje zodra er video&apos;s of scripts voor je klaarstaan.
            </p>
            <div className="mt-4">
              <PushToggle vapidPublicKey={vapidPublicKey} />
            </div>
          </div>
        </div>
      </Card>
    );
  }

  if (platform === "ios") {
    return (
      <Card>
        <p className="mb-4 text-base font-semibold text-[var(--color-ink)]">Installeren op je iPhone</p>
        {!safari ? (
          <p className="mb-4 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[#8a5300]">
            Open deze pagina in Safari. Kopieer daarvoor dit adres en plak het in Safari: <strong>{portalUrl}/portal/app</strong>
          </p>
        ) : null}
        <ol className="space-y-4">
          <Step n={1} title="Tik op het deel-icoon">
            Het vierkantje met het pijltje omhoog <Share className="inline size-4 -translate-y-px align-middle" /> onderin of bovenin Safari.
          </Step>
          <Step n={2} title="Kies 'Zet op beginscherm'">
            Het icoon met het plusje <PlusSquare className="inline size-4 -translate-y-px align-middle" />. Scroll zo nodig iets naar beneden. Laat &quot;Open als web-app&quot; aan staan.
          </Step>
          <Step n={3} title="Tik op 'Voeg toe'">Het Shortclips-icoon staat nu op je beginscherm.</Step>
          <Step n={4} title="Open de app en log één keer in">
            Daarna vraagt de app of je meldingen wilt ontvangen. Tik op &quot;Meldingen aanzetten&quot;.
          </Step>
        </ol>
        <p className="mt-5 text-xs text-[var(--color-ink-faint)]">Werkt op iPhones met iOS 16.4 of nieuwer.</p>
      </Card>
    );
  }

  if (platform === "android") {
    return (
      <Card>
        <p className="mb-4 text-base font-semibold text-[var(--color-ink)]">Installeren op je Android-telefoon</p>
        {canPrompt ? (
          <>
            <Button size="lg" className="w-full" onClick={installAndroid} disabled={prompting}>
              {prompting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Installeer de Shortclips app
            </Button>
            <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Open daarna de app vanaf je beginscherm en zet meldingen aan.</p>
          </>
        ) : (
          <ol className="space-y-4">
            <Step n={1} title="Open het menu van Chrome">
              De drie puntjes <EllipsisVertical className="inline size-4 -translate-y-px align-middle" /> rechtsboven.
            </Step>
            <Step n={2} title="Kies 'App installeren' of 'Toevoegen aan startscherm'" />
            <Step n={3} title="Open de app en zet meldingen aan" />
          </ol>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 size-6 shrink-0 text-[var(--color-ink-muted)]" />
        <div>
          <p className="text-base font-semibold text-[var(--color-ink)]">Open deze pagina op je telefoon</p>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Ga op je iPhone (Safari) of Android-telefoon (Chrome) naar <strong>{portalUrl}/portal/app</strong> en log in. Je ziet
            dan precies hoe je de app op je beginscherm zet.
          </p>
        </div>
      </div>
    </Card>
  );
}
