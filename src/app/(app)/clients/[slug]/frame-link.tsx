"use client";

import { useState, useTransition } from "react";
import { Check, Clapperboard, ExternalLink, Loader2 } from "lucide-react";
import { setClientFrameUrl } from "@/server/actions/clients";
import { Card } from "@/components/ui";

/**
 * Frame.io-link van de klant instellen (owner + coördinatoren). Deze link stuurt
 * het klantportaal naar de juiste Frame.io-omgeving van déze klant. Leeg = wissen.
 */
export function ClientFrameLink({ clientId, current }: { clientId: string; current: string | null }) {
  const [url, setUrl] = useState(current ?? "");
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null); setDone(false);
    start(async () => {
      try {
        const r = await setClientFrameUrl(clientId, url);
        if (r.ok) { setDone(true); setTimeout(() => setDone(false), 2000); }
        else setErr(r.message ?? "Er ging iets mis.");
      } catch { setErr("Opslaan mislukt. Probeer het later opnieuw."); }
    });
  }

  return (
    <Card>
      <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--color-ink)]">
        <Clapperboard className="size-4 text-[var(--color-brand-600)]" /> Frame.io-link
      </h3>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        De Frame.io-omgeving van deze klant. Hiermee wijzen de knop &quot;Bekijk je video&apos;s&quot; en de videopagina
        in het klantportaal naar de juiste Frame.io-pagina. Leeg laten = geen directe link.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://next.frame.io/project/…"
          className="min-w-[240px] flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand-500)]"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending || url === (current ?? "")}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : done ? <Check className="size-4" /> : null}
          {done ? "Opgeslagen" : "Opslaan"}
        </button>
        {current ? (
          <a href={current} target="_blank" rel="noopener" className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] px-3 py-2 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">
            <ExternalLink className="size-4" /> Openen
          </a>
        ) : null}
      </div>
      {err ? <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[var(--color-bad)]">{err}</p> : null}
    </Card>
  );
}
