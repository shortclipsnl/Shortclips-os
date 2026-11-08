"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, Check, CheckCircle2, Clapperboard, HardDrive, Loader2, Search, Sparkles, X } from "lucide-react";
import { Badge, Card, ClientLogo, Stat } from "@/components/ui";
import { confirmDriveScriptSource, dismissDriveScriptSource } from "@/server/actions/captions";
import { CAPTION_STATUS, type CaptionListStatus } from "./caption-status";
import { DriveScriptPicker } from "./drive-script-picker";

export type ShootCaptionRow = {
  productionDayId: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  clientColor: string | null;
  clientLogo: string | null;
  scheduledOn: string;
  title: string;
  scriptCount: number;
  captionCount: number;
  hasPdf: boolean;
  status: CaptionListStatus;
  generatedAt: string | null;
  driveStatus: "gekoppeld" | "suggestie" | "afgewezen" | null;
  driveFileName: string | null;
  driveReason: string | null;
};

/** Bevestig/verwerp-knoppen voor een automatische Drive-suggestie. */
function DriveSuggestion({ row }: { row: ShootCaptionRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<"bevestigd" | "verworpen" | null>(null);

  if (done) {
    return (
      <span className="text-2xs text-[var(--color-ink-faint)]">
        {done === "bevestigd" ? "Gekoppeld — captions worden voorbereid." : "Suggestie verworpen."}
      </span>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-warn)]/50 bg-[var(--color-warn-soft)]/40 px-2.5 py-1.5">
      <HardDrive className="size-3.5 shrink-0 text-[var(--color-warn)]" />
      <span className="min-w-0 flex-1 text-2xs text-[var(--color-ink-muted)]">
        Mogelijke match in Drive: <span className="font-semibold text-[var(--color-ink)]">{row.driveFileName}</span>
        {row.driveReason ? <span className="text-[var(--color-ink-faint)]"> — {row.driveReason}</span> : null}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await confirmDriveScriptSource(row.productionDayId); if (r.ok) { setDone("bevestigd"); router.refresh(); } })}
        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good)] px-2.5 py-1 text-2xs font-semibold text-white disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Bevestig
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await dismissDriveScriptSource(row.productionDayId); if (r.ok) { setDone("verworpen"); router.refresh(); } })}
        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-ink-muted)] ring-1 ring-[var(--color-line)] hover:text-[var(--color-bad)] disabled:opacity-50"
      >
        <X className="size-3" /> Niet deze
      </button>
    </div>
  );
}

type Stats = { komend: number; klaar: number; teGenereren: number; gecontroleerd: number };

function fmtNl(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

const STATUS_ORDER: (CaptionListStatus | "alle")[] = [
  "alle",
  "klaar_controle",
  "bijgewerkt_script",
  "wacht",
  "bezig",
  "gecontroleerd",
  "gedeeltelijk",
  "mislukt",
  "pdf_ontbreekt",
];

export function ShootCaptionsOverview({ rows, stats }: { rows: ShootCaptionRow[]; stats: Stats }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CaptionListStatus | "alle">("alle");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "alle" && r.status !== status) return false;
      if (!q) return true;
      return (
        r.clientName.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        fmtNl(r.scheduledOn).toLowerCase().includes(q)
      );
    });
  }, [rows, search, status]);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clapperboard className="size-4 text-[var(--color-brand-600)]" />
          <h2 className="text-sm font-semibold">Captions voor geplande opnames</h2>
        </div>
        <p className="text-xs text-[var(--color-ink-faint)]">
          Captions worden automatisch gemaakt zodra de scripts klaarstaan — uit de scriptcontrole óf automatisch gekoppeld uit Google Drive.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Aankomende opnames" value={stats.komend} icon={<CalendarDays />} tone="info" />
        <Stat label="Klaar voor controle" value={stats.klaar} icon={<Sparkles />} tone="warn" />
        <Stat label="Nog te genereren" value={stats.teGenereren} icon={<Clapperboard />} tone="neutral" />
        <Stat label="Gecontroleerd" value={stats.gecontroleerd} icon={<CheckCircle2 />} tone="good" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input
            className="sc-input pl-8"
            placeholder="Zoek op klant, opnamedatum of titel…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="sc-input w-auto" value={status} onChange={(e) => setStatus(e.target.value as CaptionListStatus | "alle")}>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {s === "alle" ? "Alle statussen" : CAPTION_STATUS[s].label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 space-y-2">
        {filtered.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">
            Geen aankomende opnames gevonden.
          </p>
        ) : (
          filtered.map((r) => {
            const st = CAPTION_STATUS[r.status];
            const canOpen = r.captionCount > 0 || r.status === "bezig" || r.status === "mislukt";
            return (
              <div
                key={r.productionDayId}
                className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5"
              >
                {/* Vaste kolommen (md+) zodat datum, klant, captions, status en
                    acties per rij netjes onder elkaar uitlijnen — scanbaar. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:grid md:grid-cols-[5rem_minmax(0,1fr)_5rem_9.5rem_15rem] md:items-center md:gap-3">
                  {/* Datum */}
                  <span className="text-sm font-semibold tabular-nums">{fmtNl(r.scheduledOn)}</span>

                  {/* Klant */}
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 md:flex-none">
                    <ClientLogo name={r.clientName} logoUrl={r.clientLogo} color={r.clientColor} size={28} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.clientName}</p>
                      <p className="truncate text-xs text-[var(--color-ink-faint)]">{r.title}</p>
                    </div>
                  </div>

                  {/* Aantal captions */}
                  <span className="hidden text-xs tabular-nums text-[var(--color-ink-muted)] md:block">
                    {r.captionCount} caption{r.captionCount === 1 ? "" : "s"}
                  </span>

                  {/* Status */}
                  <div className="md:justify-self-start">
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>

                  {/* Acties rechts: script uit Drive kiezen + captions bekijken of
                      wachtmelding — in één vaste kolom, rechts uitgelijnd. */}
                  <div className="flex flex-wrap items-center justify-end gap-2 md:justify-self-end">
                    {r.driveStatus !== "suggestie" ? (
                      <DriveScriptPicker productionDayId={r.productionDayId} variant="chip" hasCoupledSource={r.driveStatus === "gekoppeld"} />
                    ) : null}
                    {canOpen ? (
                      <Link
                        href={`/ai/caption/opname/${r.productionDayId}`}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
                      >
                        Bekijk captions <ArrowRight className="size-3.5" />
                      </Link>
                    ) : (
                      <span className="px-2.5 py-1.5 text-xs text-[var(--color-ink-faint)]">
                        {r.status === "pdf_ontbreekt" ? "Wacht op scripts" : "—"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Onzekere automatische match: eigen regel onder de rij, zodat de
                    kolommen uitgelijnd blijven. */}
                {r.driveStatus === "suggestie" ? <div className="mt-2"><DriveSuggestion row={r} /></div> : null}
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
