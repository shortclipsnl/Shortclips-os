"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift, Loader2 } from "lucide-react";
import { saveClientMoments } from "@/server/actions/klantmomenten";
import { longDate } from "@/lib/klantmomenten";
import type { ClientMomentsView } from "@/server/klantmomenten";

/**
 * Blok Momenten op de klantpagina: samenwerkingsjubilea en bedrijfsjubilea.
 * Een week vooraf krijgt de verantwoordelijke automatisch een taak en een
 * melding; hier ziet het team wat eraan komt, welke datums nog ontbreken en
 * wat er eerder is gedaan. Datums aanpassen gebeurt hier, in het blok zelf.
 */

const SOURCES = ["KvK-uittreksel", "Openbaar register", "Website klant", "Eigen opgave klant"];

export function ClientMoments({
  clientId,
  view,
  canEdit,
  today,
}: {
  clientId: string;
  view: ClientMomentsView;
  canEdit: boolean;
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState({
    startEstimate: view.data.startEstimate ?? "",
    foundedOn: view.data.foundedOn ?? "",
    foundedYear: view.data.foundedYear ? String(view.data.foundedYear) : "",
    foundedSource: view.data.foundedSource ?? "",
  });

  const save = () => {
    setError(null);
    start(async () => {
      const r = await saveClientMoments(clientId, {
        startEstimate: form.startEstimate || null,
        foundedOn: form.foundedOn || null,
        foundedYear: form.foundedYear ? Number(form.foundedYear) : null,
        foundedSource: form.foundedSource || null,
      });
      if (!r.ok) return setError(r.message ?? "Opslaan is niet gelukt.");
      setEditing(false);
      router.refresh();
    });
  };

  const empty = view.upcoming.length === 0 && !view.yearOnly;

  return (
    <section className="sc-card flex flex-col gap-3 p-6">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink)]">
          <Gift className="size-4" strokeWidth={1.8} /> Momenten
        </h2>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition hover:border-[var(--color-ink-faint)]"
          >
            {editing ? "Sluiten" : "Datums aanpassen"}
          </button>
        ) : null}
      </div>

      {view.note ? (
        <p className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[#8a5300]">{view.note}</p>
      ) : null}

      <ul className="divide-y divide-[var(--color-line)] text-sm">
        {view.upcoming.map((m) => {
          const days = Math.round((Date.parse(`${m.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
          return (
            <li key={`${m.kind}-${m.years}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
              <span className="inline-flex items-center gap-2 font-medium">
                <span className={`size-2 shrink-0 rounded-full ${m.kind === "samenwerking" ? "bg-[var(--color-indigo-ink)]" : "bg-[var(--color-ink-faint)]"}`} />
                {m.label}
              </span>
              <span className="hidden text-[var(--color-ink-muted)] sm:block">{longDate(m.date)}</span>
              <span className="justify-self-end">
                {m.taskOpen ? (
                  <Pill tone="ink">Taak staat klaar</Pill>
                ) : days <= 7 ? (
                  <Pill tone="ink">{days === 0 ? "Vandaag" : `Over ${days} ${days === 1 ? "dag" : "dagen"}`}</Pill>
                ) : m.status === "indicatie" ? (
                  <Pill tone="warn">Indicatie, taak {shortDate(m.taskOn)}</Pill>
                ) : (
                  <span className="text-xs text-[var(--color-ink-muted)]">Taak op {shortDate(m.taskOn)}</span>
                )}
              </span>
            </li>
          );
        })}
        {view.yearOnly ? (
          <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
            <span className="inline-flex items-center gap-2 font-medium">
              <span className="size-2 shrink-0 rounded-full bg-[var(--color-ink-faint)]" />
              {view.yearOnly.years} jaar bestaan
            </span>
            <span className="hidden text-[var(--color-ink-muted)] sm:block">{view.yearOnly.year}</span>
            <span className="justify-self-end">
              <Pill tone="warn">Dag en maand aanvullen</Pill>
            </span>
          </li>
        ) : null}
        {view.missingStart ? (
          <li className="py-2.5 text-[var(--color-ink-muted)]">
            <Pill tone="bad">Startdatum onbekend</Pill> <span className="ml-1 text-xs">Zonder startdatum geen samenwerkingsjubileum. Vul &quot;Klant sinds&quot; in bij Bewerken.</span>
          </li>
        ) : null}
        {empty && !view.missingStart ? <li className="py-2.5 text-[var(--color-ink-muted)]">Geen momenten in de komende jaren bekend.</li> : null}
      </ul>

      {view.startSource === "indicatie" && !view.missingStart ? (
        <p className="text-2xs text-[var(--color-ink-faint)]">De startdatum is een indicatie uit eerdere bestanden. De taak vraagt eerst om die te bevestigen.</p>
      ) : null}

      {editing ? (
        <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] p-4 text-sm sm:grid-cols-2">
          <Label text="Startdatum (indicatie)" hint={view.startSource === "klantrecord" ? "Klant sinds is ingevuld en gaat voor." : "Alleen als Klant sinds nog leeg is."}>
            <input type="date" value={form.startEstimate} onChange={(e) => setForm({ ...form, startEstimate: e.target.value })} className={INPUT} />
          </Label>
          <Label text="Oprichtingsdatum" hint="Volledige datum, dan komt er een week vooraf een taak.">
            <input type="date" value={form.foundedOn} onChange={(e) => setForm({ ...form, foundedOn: e.target.value, foundedYear: e.target.value ? e.target.value.slice(0, 4) : form.foundedYear })} className={INPUT} />
          </Label>
          <Label text="Of alleen het jaar" hint="Als de exacte datum nog niet bekend is.">
            <input type="number" inputMode="numeric" min={1800} max={2100} value={form.foundedYear} disabled={!!form.foundedOn} onChange={(e) => setForm({ ...form, foundedYear: e.target.value })} className={INPUT} />
          </Label>
          <Label text="Bron oprichting">
            <span className="flex flex-wrap gap-1.5">
              {SOURCES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm({ ...form, foundedSource: form.foundedSource === s ? "" : s })}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${form.foundedSource === s ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
                >
                  {s}
                </button>
              ))}
            </span>
          </Label>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
            </button>
            {error ? <span className="text-xs text-[#a3271c]">{error}</span> : null}
          </div>
        </div>
      ) : null}

      <div className="border-t border-[var(--color-line)] pt-3">
        <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Eerder gedaan</span>
        {view.history.length ? (
          <ul className="mt-1.5 space-y-1 text-sm">
            {view.history.map((h) => (
              <li key={`${h.title}-${h.date}`} className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{h.title}</span>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {longDate(h.date)}
                  {h.by ? ` · ${h.by}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-[var(--color-ink-faint)]">Nog niets vastgelegd. Afgeronde momenttaken komen hier vanzelf te staan.</p>
        )}
      </div>
    </section>
  );
}

const INPUT = "w-full rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm disabled:opacity-50";

function Label({ text, hint, children }: { text: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--color-ink-muted)]">{text}</span>
      {children}
      {hint ? <span className="text-2xs text-[var(--color-ink-faint)]">{hint}</span> : null}
    </label>
  );
}

function Pill({ tone, children }: { tone: "ink" | "warn" | "bad"; children: React.ReactNode }) {
  const cls =
    tone === "ink"
      ? "bg-[var(--color-indigo-ink)] text-white"
      : tone === "warn"
        ? "bg-[var(--color-warn-soft)] text-[#8a5300]"
        : "bg-[var(--color-bad-soft)] text-[#a3271c]";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold ${cls}`}>{children}</span>;
}

const SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${SHORT[m - 1]}`;
}
