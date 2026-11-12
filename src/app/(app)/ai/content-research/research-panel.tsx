"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import { StartResearchButton } from "./start-research-button";

export type RunView = {
  id: string;
  status: string;
  phase: string;
  summary: string | null;
  trends: string[];
  sources: { label: string; url: string }[];
  ideasCount: number;
  newCount: number;
  errorMessage: string | null;
  dataBasis: {
    posts?: number;
    postsPeriode?: string | null;
    platforms?: string[];
    postZekerheid?: string;
    driveScripts?: number;
    scriptsGelezen?: number;
    concurrenten?: number;
    klantgeheugen?: number;
    maandrapportage?: string | null;
    eerdereIdeeen?: number;
    afgewezen?: number;
    stijlBronnen?: string[];
    bewezenHooks?: number;
    kandidaten?: number;
    geslaagd?: number;
    getoond?: number;
  };
  /** Uitslag van de keuring per kandidaat (null bij oudere rondes). */
  keuring: Array<{ titel: string; totaal: number; stijlFit: number | null; oordeel: string; getoond: boolean; reden: string | null }> | null;
  finishedAt: string | null;
  createdAt: string;
};

const PHASE_LABEL: Record<string, string> = {
  stijl: "Stijl uit de scripts lezen",
  wacht_zoeken: "Stijl klaar, onderzoek start zo",
  zoeken: "Markt en concurrenten onderzoeken",
  wacht_ideeen: "Onderzoek klaar, ideeën starten zo",
  wacht: "Onderzoek klaar, ideeën starten zo",
  ideeen: "Kandidaat-ideeën schrijven",
  wacht_keuring: "Kandidaten klaar, keuring start zo",
  keuring: "Ideeën keuren (80+)",
  wacht_verbeteren: "Keuring klaar, verbeterronde start zo",
  verbeteren: "Bijna-goede ideeën verbeteren en herkeuren",
  opslaan: "Opslaan",
  klaar: "Klaar",
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  bezig: { label: "Bezig", tone: "info" },
  klaar: { label: "Klaar", tone: "good" },
  mislukt: { label: "Mislukt", tone: "bad" },
};

function fmt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Welke databronnen deze ronde écht had. Groen = gebruikt, grijs = niet beschikbaar. */
function DataBasis({ d }: { d: RunView["dataBasis"] }) {
  const items: Array<{ label: string; value: string; ok: boolean }> = [
    { label: "Eigen video's (Metricool)", value: d.posts ? `${d.posts} video's${d.postsPeriode ? ` (${d.postsPeriode})` : ""}${d.postZekerheid === "indicatie" ? ", indicatie" : ""}` : "geen videometingen", ok: Boolean(d.posts) },
    { label: "Stijl uit eigen scripts", value: d.scriptsGelezen ? `${d.scriptsGelezen} scripts gelezen${d.bewezenHooks ? `, ${d.bewezenHooks} bewezen hooks` : ""}` : d.driveScripts ? `${d.driveScripts} in Drive, nog niet gelezen` : "geen gevonden", ok: Boolean(d.scriptsGelezen) },
    { label: "Concurrenten", value: d.concurrenten ? `${d.concurrenten} in onderzoek` : "nog geen", ok: Boolean(d.concurrenten) },
    { label: "Klantgeheugen", value: d.klantgeheugen ? `${d.klantgeheugen} inzichten` : "nog leeg", ok: Boolean(d.klantgeheugen) },
    { label: "Maandrapportage", value: d.maandrapportage ?? "geen goedgekeurde", ok: Boolean(d.maandrapportage) },
    { label: "Eerdere ideeën", value: `${d.eerdereIdeeen ?? 0} (${d.afgewezen ?? 0} niet relevant)`, ok: Boolean(d.eerdereIdeeen) },
  ];
  return (
    <div className="grid gap-1.5 rounded-md bg-[var(--color-surface-sunken)] p-3 sm:grid-cols-2">
      {items.map((it) => (
        <p key={it.label} className="flex items-center gap-2 text-xs">
          <span className={`size-1.5 shrink-0 rounded-full ${it.ok ? "bg-[var(--color-good)]" : "bg-[var(--color-ink-faint)]"}`} />
          <span className="text-[var(--color-ink-muted)]">{it.label}:</span>
          <span className="text-[var(--color-ink)]">{it.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Alle kandidaten van een ronde met hun score: wat door de keuring kwam en waarom de rest niet. */
function KeuringUitslag({ items }: { items: NonNullable<RunView["keuring"]> }) {
  const afgewezen = items.filter((i) => !i.getoond);
  return (
    <details className="rounded-md border border-[var(--color-line)] p-3">
      <summary className="cursor-pointer text-xs font-medium text-[var(--color-ink)]">
        Keuring: {items.length - afgewezen.length} getoond, {afgewezen.length} afgewezen (minimaal 80 en stijl-fit 8)
      </summary>
      <ul className="mt-2 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className={`w-8 shrink-0 text-right font-semibold tabular-nums ${it.getoond ? "text-[var(--color-good)]" : "text-[var(--color-ink-faint)]"}`}>{it.totaal || "–"}</span>
            <span className="min-w-0">
              <span className={it.getoond ? "font-medium text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}>{it.titel}</span>
              {it.stijlFit != null ? <span className="text-[var(--color-ink-faint)]"> · stijl {it.stijlFit}/10</span> : null}
              {!it.getoond && it.reden ? <span className="block text-[var(--color-ink-faint)]">Niet getoond: {it.reden}</span> : null}
              {it.oordeel ? <span className="block text-[var(--color-ink-muted)]">{it.oordeel}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ResearchPanel({ clientId, runs }: { clientId: string; runs: RunView[] }) {
  const router = useRouter();
  const running = runs.some((r) => r.status === "bezig");

  // Terwijl een onderzoek loopt: ververs de echte voortgang automatisch.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [running, router]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-ink-muted)]">
          Elke maandag automatisch, of handmatig. Per ronde zie je welke data er echt was en welke bronnen zijn gebruikt. Alle eerdere ideeën blijven bewaard (filter Archief bij Ideeën).
        </p>
        <StartResearchButton clientId={clientId} running={running} variant="primary" label="Onderzoek opnieuw" />
      </div>

      {runs.length === 0 ? (
        <div className="sc-card p-5 text-sm text-[var(--color-ink-muted)]">Nog geen onderzoek gedaan. Start de eerste ronde.</div>
      ) : (
        <ul className="space-y-3">
          {runs.map((r) => {
            const st = STATUS[r.status] ?? STATUS.bezig;
            return (
              <li key={r.id} className="sc-card space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {r.status === "bezig" ? <Loader2 className="size-4 animate-spin text-[var(--color-info)]" /> : r.status === "klaar" ? <CheckCircle2 className="size-4 text-[var(--color-good)]" /> : <AlertTriangle className="size-4 text-[var(--color-bad)]" />}
                    <Badge tone={st.tone}>{r.status === "bezig" ? PHASE_LABEL[r.phase] ?? "Bezig" : st.label}</Badge>
                    <span className="text-xs text-[var(--color-ink-faint)]">{fmt(r.finishedAt ?? r.createdAt)}</span>
                  </div>
                  {r.status === "klaar" ? (
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      {r.keuring ? `${r.newCount} van ${r.ideasCount} kandidaten door de keuring` : `${r.newCount} nieuw · ${r.ideasCount} totaal`}
                    </span>
                  ) : null}
                </div>

                {r.status === "mislukt" && r.errorMessage ? (
                  <p className="text-xs text-[var(--color-bad)]">{r.errorMessage}</p>
                ) : null}

                {r.dataBasis && Object.keys(r.dataBasis).length > 0 ? <DataBasis d={r.dataBasis} /> : null}

                {r.keuring && r.keuring.length > 0 ? <KeuringUitslag items={r.keuring} /> : null}

                {r.trends.length > 0 ? (
                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Gevonden trends</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-muted)]">
                      {r.trends.slice(0, 8).map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                ) : null}

                {r.sources.length > 0 ? (
                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Bronnen</p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {r.sources.map((s, i) => (
                        <li key={i}>
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline">
                            {s.label} <ExternalLink className="size-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
