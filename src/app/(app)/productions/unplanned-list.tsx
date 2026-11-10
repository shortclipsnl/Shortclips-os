"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Badge, Card, ClientLogo, type Tone } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { setShootPickup, type ShootPickupStatus } from "@/server/actions/shoot-pickup";
import type { UnplannedClient, UnplannedPriority } from "@/server/productions";

const PRIORITY_LABEL: Record<UnplannedPriority, { label: string; tone: Tone }> = {
  eerste: { label: "Eerste opname", tone: "bad" },
  achterstallig: { label: "Te laat", tone: "bad" },
  nu: { label: "Nu inplannen", tone: "warn" },
  binnenkort: { label: "Binnenkort", tone: "info" },
};

function intervalLabel(days: number): string {
  if (days >= 26 && days <= 35) return "maandelijks";
  if (days >= 12 && days <= 16) return "elke 2 weken";
  if (days % 7 === 0) return `elke ${days / 7} weken`;
  return `elke ${days} dagen`;
}

const STATUS_OPTS: { key: ShootPickupStatus; label: string }[] = [
  { key: "nieuw", label: "Nog niet opgepakt" },
  { key: "opgepakt", label: "Gezien, ik ga ermee aan de slag" },
  { key: "afgehandeld", label: "Afgehandeld" },
];
const DOT: Record<ShootPickupStatus, string> = {
  nieuw: "bg-[var(--color-ink-faint)]",
  opgepakt: "bg-[var(--color-warn)]",
  afgehandeld: "bg-[var(--color-good)]",
};

/**
 * "Nog niet ingepland"-werklijst met per klant een oppak-status. Standaard tonen
 * we alleen klanten die nog niet zijn opgepakt; opgepakte/afgehandelde klanten
 * zijn terug te vinden via het filter (met wie ze oppakte). De echte
 * opnameplanning en klantgegevens blijven ongemoeid.
 */
export function UnplannedList({ items, canWrite }: { items: UnplannedClient[]; canWrite: boolean }) {
  const [toonOpgepakt, setToonOpgepakt] = useState(false);
  const nieuw = items.filter((u) => u.pickupStatus === "nieuw");
  const opgepakt = items.filter((u) => u.pickupStatus !== "nieuw");
  const zichtbaar = toonOpgepakt ? items : nieuw;

  return (
    <div id="nog-niet-ingepland" className="mb-5 scroll-mt-4">
      <Card className="overflow-hidden" padded={false}>
        <div className="flex flex-wrap items-center gap-2 bg-[var(--color-indigo-ink)] px-4 py-2.5 text-white">
          <span className="text-sm font-bold tracking-tight">
            Nog niet ingepland · {nieuw.length} te doen
          </span>
          {opgepakt.length > 0 ? (
            <button
              type="button"
              onClick={() => setToonOpgepakt((v) => !v)}
              className="ml-auto rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-white/25"
            >
              {toonOpgepakt ? "Verberg opgepakte" : `Toon opgepakte (${opgepakt.length})`}
            </button>
          ) : null}
        </div>

        {zichtbaar.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">
            {items.length === 0 ? "Geen klanten om in te plannen." : "Alle klanten zijn opgepakt. Gebruik “Toon opgepakte” om ze terug te zien."}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {zichtbaar.map((u) => <Row key={u.clientId} u={u} canWrite={canWrite} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({ u, canWrite }: { u: UnplannedClient; canWrite: boolean }) {
  const p = PRIORITY_LABEL[u.priority];
  const laatste = u.lastShootOn ? `Laatste opname ${formatDate(u.lastShootOn)}` : "Nog geen opname";
  const periode = u.windowFrom && u.windowTo
    ? `gewenst ${formatDate(u.windowFrom)}–${formatDate(u.windowTo)} · ritme ${intervalLabel(u.intervalDays)}`
    : "zo snel mogelijk inplannen";

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <ClientLogo name={u.clientName} logoUrl={u.clientLogo} color={u.clientColor} size={26} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/clients/${u.clientSlug}?tab=opnames`} className="truncate font-medium text-[var(--color-ink)] hover:underline">
              {u.clientName}
            </Link>
            <Badge tone={p.tone}>{u.priority === "achterstallig" && u.daysLate > 0 ? `${p.label} · ${u.daysLate}d` : p.label}</Badge>
            {u.pickupStatus !== "nieuw" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-2xs font-semibold text-[var(--color-ink-muted)]">
                <span className={`size-1.5 rounded-full ${DOT[u.pickupStatus]}`} />
                {u.pickupStatus === "afgehandeld" ? "Afgehandeld" : "Opgepakt"}{u.pickupByName ? ` · ${u.pickupByName}` : ""}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{laatste} · {periode}</div>
        </div>
        {canWrite ? <StatusControl u={u} /> : null}
      </div>
    </li>
  );
}

function StatusControl({ u }: { u: UnplannedClient }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const current = STATUS_OPTS.find((o) => o.key === u.pickupStatus)!;

  const set = (status: ShootPickupStatus) => {
    setOpen(false);
    start(async () => { await setShootPickup(u.clientId, status); router.refresh(); });
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        title="Oppak-status wijzigen"
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <span className={`size-2 rounded-full ${DOT[u.pickupStatus]}`} />}
        <span className="hidden max-w-[150px] truncate sm:inline">{current.label}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-64 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-raised)]">
            {STATUS_OPTS.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => set(o.key)}
                className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-sm hover:bg-[var(--color-surface-sunken)] ${o.key === u.pickupStatus ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}
              >
                <span className={`size-2 shrink-0 rounded-full ${DOT[o.key]}`} />
                <span className="min-w-0 flex-1">{o.label}</span>
                {o.key === u.pickupStatus ? <Check className="size-3.5 shrink-0 text-[var(--color-good)]" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
