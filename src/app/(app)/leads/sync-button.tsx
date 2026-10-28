"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { syncLeadsFromMail } from "@/server/actions/leads";

/** Hoe vaak de pagina automatisch de mailmap opnieuw uitleest (ms). */
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function relative(iso: string | null): string {
  if (!iso) return "nog niet gesynchroniseerd";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "zojuist";
  if (mins < 60) return `${mins} min geleden`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} uur geleden`;
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function SyncLeadsButton({ lastSyncAt, configured }: { lastSyncAt: string | null; configured: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    setMsg(null);
    start(async () => {
      const res = await syncLeadsFromMail();
      if (res.ok) { setMsg("Synchronisatie voltooid."); router.refresh(); }
      else setMsg(res.message ?? "Mislukt");
    });
  }

  // Automatisch verversen zolang de leadspagina open staat: elke paar minuten de
  // mailmap stil opnieuw uitlezen en de lijst bijwerken (zonder melding/spinner).
  useEffect(() => {
    if (!configured) return;
    const id = setInterval(() => {
      start(async () => {
        const res = await syncLeadsFromMail();
        if (res.ok) router.refresh();
      });
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [configured, router, start]);

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3">
      <div className="flex items-start gap-2.5 text-sm">
        <Mail className="mt-0.5 size-4 shrink-0 text-[var(--color-brand-600)]" strokeWidth={1.75} />
        <div>
          <p className="font-medium text-[var(--color-ink)]">Leads komen binnen via de mail</p>
          <p className="text-xs text-[var(--color-ink-muted)]">
            Nieuwe aanvragen worden automatisch uit de mailmap &apos;Leads - Shortclips&apos; opgehaald.{" "}
            {configured ? `Automatisch bijgewerkt terwijl je hier bent · laatste synchronisatie: ${relative(lastSyncAt)}.` : "Mailkoppeling nog niet ingesteld."}
            {msg ? <span className="ml-1 font-medium text-[var(--color-good)]">{msg}</span> : null}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={pending || !configured}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        title="Leest de mailmap 'Leads - Shortclips' uit en voegt nieuwe aanvragen toe"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Nu synchroniseren
      </button>
    </div>
  );
}
