import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, CircleDashed, Hand, Minus } from "lucide-react";
import { STATE_LABEL, type Checklist, type ChecklistItem, type ChecklistState } from "@/lib/content-planning-status";
import { StatusPill, type StatusTone } from "@/components/portal/status-pill";

/**
 * "Jouw contentplanning" bovenaan de contentplanningpagina. Elke kaart volgt de
 * echte status uit de planning (zelfde bron als de PDF): groen = afgerond,
 * blauw = in voorbereiding, oranje = actie van de klant, grijs = n.v.t.
 * Links wat Shortclips regelt, rechts wat er (eventueel) bij de klant ligt.
 */
const TONE: Record<ChecklistState, StatusTone> = { done: "green", preparing: "blue", action: "orange", na: "grey" };
const ICON: Record<ChecklistState, typeof Check> = { done: Check, preparing: CircleDashed, action: Hand, na: Minus };
const ICON_BG: Record<ChecklistState, string> = {
  done: "bg-[var(--st-green-bg)] text-[var(--st-green)]",
  preparing: "bg-[var(--st-blue-bg)] text-[var(--st-blue)]",
  action: "bg-[var(--st-orange-bg)] text-[var(--st-orange)]",
  na: "bg-[var(--st-grey-bg)] text-[var(--st-grey)]",
};

function Item({ item }: { item: ChecklistItem }) {
  const Icon = ICON[item.state];
  return (
    <li className={`flex items-start gap-3 py-3 ${item.state === "na" ? "opacity-75" : ""}`}>
      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${ICON_BG[item.state]}`} aria-hidden>
        <Icon className="size-3.5" strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-[14px] font-semibold leading-snug">{item.title}</span>
          <StatusPill tone={TONE[item.state]}>{STATE_LABEL[item.state]}</StatusPill>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-[var(--color-ink-muted)]">{item.detail}</p>
        {item.href && item.state === "action" ? (
          <Link href={item.href} className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--sc-accent)] hover:underline">
            Bekijken <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function PlanningChecklist({ checklist, action }: { checklist: Checklist; action?: ReactNode }) {
  const ours = checklist.items.filter((i) => i.owner === "shortclips");
  const theirs = checklist.items.filter((i) => i.owner === "klant");
  const doneCount = ours.filter((i) => i.state === "done" || i.state === "na").length;
  return (
    <section aria-labelledby="jouw-contentplanning" className="overflow-hidden rounded-[18px] border border-[var(--sc-line)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-end justify-between gap-3 bg-[#00003b] px-5 py-5 text-white sm:px-6">
        <div>
          <p className="text-[13px] font-bold tracking-wide text-[#5b9bff]">Jouw contentplanning</p>
          <h2 id="jouw-contentplanning" className="mt-0.5 text-[24px] font-bold leading-tight tracking-tight">{checklist.headline}</h2>
          <p className="mt-1 max-w-xl text-[13.5px] text-white/70">{checklist.subline}</p>
        </div>
        {action}
      </div>
      <div className="grid gap-0 md:grid-cols-[1.6fr_1fr]">
        <div className="px-5 pb-2 pt-4 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Geregeld door Shortclips</h3>
            <span className="text-[12px] font-medium tabular-nums text-[var(--color-ink-muted)]">{doneCount} van {ours.length} afgerond</span>
          </div>
          <ul className="mt-1 divide-y divide-[var(--sc-line)]">{ours.map((i) => <Item key={i.key} item={i} />)}</ul>
        </div>
        {/* Op mobiel staat een openstaande klantactie bovenaan, zodat die direct opvalt. */}
        <div className={`border-[var(--sc-line)] px-5 pb-2 pt-4 sm:px-6 md:border-l md:border-t-0 ${checklist.needsClient ? "order-first border-b bg-[var(--st-orange-bg)]/40 md:order-none md:border-b-0" : "border-t bg-[var(--sc-fill)]"}`}>
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-muted)]">Jouw acties</h3>
          <ul className="mt-1">{theirs.map((i) => <Item key={i.key} item={i} />)}</ul>
        </div>
      </div>
    </section>
  );
}
