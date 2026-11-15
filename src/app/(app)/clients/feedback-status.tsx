"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Clock } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import { FEEDBACK_STATUS, deadlineShortLabel, timeLeftLabel, type FeedbackStatusKey } from "@/lib/feedback-deadline";
import { nlHolidaySet } from "@/lib/holidays";
import type { FeedbackStatusRow } from "@/server/feedback-overview";

const TONE: Record<FeedbackStatusKey, Tone> = { verlopen: "bad", nadert: "warn", wacht: "info", ontvangen: "good", afgerond: "neutral" };
/** Statussen waarbij het team nu zelf iets moet doen. */
const ACTIE: FeedbackStatusKey[] = ["verlopen", "ontvangen"];

/**
 * Feedbackstatus per klant: scripts en video's die bij de klant liggen, met de
 * exacte deadline, de status en de verantwoordelijke. Bovenaan de klantenpagina,
 * standaard op je eigen klanten en gesorteerd op wat het eerst actie vraagt.
 */
export function FeedbackStatus({ rows, viewerId, today }: { rows: FeedbackStatusRow[]; viewerId: string; today: string }) {
  const hasOwn = rows.some((r) => r.responsibleId === viewerId);
  const [mine, setMine] = useState(hasOwn);
  const [filter, setFilter] = useState<"open" | "actie" | "alles">("open");
  const [open, setOpen] = useState(true);
  const holidays = useMemo(() => nlHolidaySet(), []);

  const scoped = useMemo(() => rows.filter((r) => !mine || r.responsibleId === viewerId), [rows, mine, viewerId]);
  const shown = useMemo(() => {
    const list = scoped.filter((r) => (filter === "alles" ? true : filter === "actie" ? ACTIE.includes(r.status) : r.status !== "afgerond"));
    return list.sort((a, b) => FEEDBACK_STATUS[a.status].order - FEEDBACK_STATUS[b.status].order || (a.dueDay ?? "9999").localeCompare(b.dueDay ?? "9999") || a.clientName.localeCompare(b.clientName));
  }, [scoped, filter]);

  if (rows.length === 0) return null;
  const count = (keys: FeedbackStatusKey[]) => scoped.filter((r) => keys.includes(r.status)).length;
  const verlopen = count(["verlopen"]);
  const nadert = count(["nadert"]);
  const ontvangen = count(["ontvangen"]);
  const wacht = count(["wacht"]);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-semibold ring-1 transition ${active ? "bg-[var(--color-indigo-ink)] text-white ring-[var(--color-indigo-ink)]" : "bg-[var(--color-surface)] text-[var(--color-ink)] ring-[var(--color-line-strong)] hover:bg-[var(--color-surface-2)]"}`;

  return (
    <section className="mb-5 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]" aria-label="Feedbackstatus">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left" aria-expanded={open}>
        <Clock className="size-4 text-[var(--color-ink-muted)]" />
        <span className="text-sm font-semibold text-[var(--color-ink)]">Feedbackstatus</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {verlopen > 0 ? <Badge tone="bad">{verlopen} verlopen</Badge> : null}
          {nadert > 0 ? <Badge tone="warn">{nadert} nadert</Badge> : null}
          {ontvangen > 0 ? <Badge tone="good">{ontvangen} ontvangen</Badge> : null}
          {wacht > 0 ? <Badge tone="info">{wacht} wacht</Badge> : null}
          {verlopen + nadert + ontvangen + wacht === 0 ? <span className="text-xs text-[var(--color-ink-muted)]">Er wacht nu niets op feedback.</span> : null}
        </span>
        <ChevronDown className={`ml-auto size-4 text-[var(--color-ink-muted)] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="border-t border-[var(--color-line)] px-4 pb-4 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {hasOwn ? (
              <>
                <button type="button" className={chip(mine)} onClick={() => setMine(true)}>Mijn klanten</button>
                <button type="button" className={chip(!mine)} onClick={() => setMine(false)}>Alle klanten</button>
                <span className="mx-1 h-4 w-px bg-[var(--color-line-strong)]" />
              </>
            ) : null}
            <button type="button" className={chip(filter === "open")} onClick={() => setFilter("open")}>Openstaand</button>
            <button type="button" className={chip(filter === "actie")} onClick={() => setFilter("actie")}>Actie nodig</button>
            <button type="button" className={chip(filter === "alles")} onClick={() => setFilter("alles")}>Ook afgerond</button>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                  <th className="py-1.5 pr-3">Klantnaam</th>
                  <th className="py-1.5 pr-3">Onderdeel</th>
                  <th className="py-1.5 pr-3">Feedbackdeadline</th>
                  <th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5">Verantwoordelijke</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className="border-t border-[var(--color-line)]">
                    <td className="py-2 pr-3 font-semibold text-[var(--color-ink)]">
                      <Link href={`/clients/${r.clientSlug}`} className="hover:underline">{r.clientName}</Link>
                    </td>
                    <td className="py-2 pr-3">
                      <Link href={r.href} className="text-[var(--color-ink)] hover:underline">{r.onderdeel}</Link>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {r.dueDay ? (
                        <>
                          <span className="text-[var(--color-ink)]">{deadlineShortLabel(r.dueDay)}</span>
                          <span className="ml-2 text-xs text-[var(--color-ink-muted)]">{timeLeftLabel(r.dueDay, today, holidays)}</span>
                        </>
                      ) : (
                        <span className="text-[var(--color-ink-faint)]">Klant heeft gereageerd</span>
                      )}
                    </td>
                    <td className="py-2 pr-3"><Badge tone={TONE[r.status]}>{FEEDBACK_STATUS[r.status].label}</Badge></td>
                    <td className="py-2 text-[var(--color-ink)]">{r.responsibleName?.split(" ")[0] ?? <span className="text-[var(--color-ink-faint)]">Geen</span>}</td>
                  </tr>
                ))}
                {shown.length === 0 ? (
                  <tr className="border-t border-[var(--color-line)]">
                    <td colSpan={5} className="py-3 text-[var(--color-ink-muted)]">Niets in deze selectie.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            Deadlines lopen tot 17:00 op de laatste werkdag van de termijn van de klant. Een verlopen deadline is geen akkoord: neem dan persoonlijk contact op.
          </p>
        </div>
      ) : null}
    </section>
  );
}
