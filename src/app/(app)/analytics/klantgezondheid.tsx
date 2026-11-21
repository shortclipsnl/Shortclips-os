"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ClipboardList } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import type { StaffOption } from "@/server/result-alerts";
import { pickUpDecline } from "@/server/actions/result-alerts";
import { ACTIES, baselineY, sparkPoints, STATUS_LABEL, type GezondheidRow, type GezondheidStatus } from "@/lib/klantgezondheid";

/**
 * Klantgezondheid: één lijst met alle klanten, urgentste bovenaan. Tabs
 * Aandacht (standaard) en Alle klanten, filters op status en eigenaar. De
 * status werkt met vaste vensters en volgt de periodekeuze van de pagina niet.
 * Oppakken gebruikt dezelfde actie en takenpagina als de bestaande alerts.
 */

const TONE: Record<GezondheidStatus, { text: string; bg: string }> = {
  spoed: { text: "var(--color-bad)", bg: "var(--color-bad-soft)" },
  bijsturen: { text: "var(--color-warn)", bg: "var(--color-warn-soft)" },
  inhalen: { text: "var(--color-info)", bg: "var(--color-info-soft)" },
  koers: { text: "var(--color-good)", bg: "var(--color-good-soft)" },
  geen_data: { text: "var(--color-ink-muted)", bg: "var(--color-neutral-soft)" },
};

const ATTENTION: GezondheidStatus[] = ["spoed", "bijsturen", "inhalen"];

function addWorkdays(n: number): string {
  const d = new Date();
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const chip = (on: boolean) =>
  `inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition ${on ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`;

function Pill({ status }: { status: GezondheidStatus }) {
  const t = TONE[status];
  return (
    <span className="inline-block min-w-[5.5rem] rounded-full px-3 py-1 text-center text-xs font-semibold" style={{ color: t.text, background: t.bg }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Spark({ r }: { r: GezondheidRow }) {
  const pts = sparkPoints(r.series);
  const color = r.status === "koers" || r.status === "geen_data" ? "var(--color-ink-muted)" : TONE[r.status].text;
  if (!pts) return <span className="inline-block w-[84px] text-center text-2xs text-[var(--color-ink-faint)]" title="Te weinig weken met data voor een trend">geen trend</span>;
  const y = baselineY();
  return (
    <svg width="84" height="28" viewBox="0 0 84 28" fill="none" role="img" aria-label="Weergaven per week, laatste 8 weken, ten opzichte van het eigen gemiddelde">
      <line x1="2" y1={y} x2="82" y2={y} stroke="var(--color-line-strong)" strokeWidth="1" strokeDasharray="3 3" />
      <polyline points={pts} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function PickUp({ r, staff, viewerId, onDone }: { r: GezondheidRow; staff: StaffOption[]; viewerId: string; onDone: () => void }) {
  const router = useRouter();
  const actie = r.status === "spoed" || r.status === "bijsturen" || r.status === "inhalen" ? ACTIES[r.status] : null;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const preferred = [r.ownerId, viewerId].find((id) => id && staff.some((s) => s.id === id));
  const [assignee, setAssignee] = useState(preferred ?? staff[0]?.id ?? "");
  const [due, setDue] = useState(addWorkdays(actie?.werkdagen ?? 3));
  if (!actie) return null;

  const submit = () =>
    start(async () => {
      const first = actie.stappen[0]!;
      const res = await pickUpDecline({
        clientId: r.clientId,
        assigneeId: assignee,
        dueOn: due,
        headline: `${STATUS_LABEL[r.status]}: ${r.reden}`.slice(0, 200),
        action: first.slice(0, 240),
        title: `${r.name}: ${STATUS_LABEL[r.status].toLowerCase()}, ${r.reden}`.slice(0, 240),
        urgent: r.status === "spoed",
        note: [`Reden: ${r.reden}`, ...actie.stappen.map((s, i) => `${i + 1}. ${s}`), "(Opgepakt vanuit Klantgezondheid op de Resultatenpagina.)"].join("\n").slice(0, 600),
      });
      setMsg(res.message ?? null);
      if (res.ok) {
        router.refresh();
        onDone();
      }
    });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-0.5 text-xs text-[var(--color-ink-faint)]">Wie</span>
        {staff.map((s) => (
          <button key={s.id} type="button" onClick={() => setAssignee(s.id)} className={`rounded-full px-3 py-1 text-xs font-semibold ${assignee === s.id ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)]"}`}>
            {s.name.split(" ")[0]}
          </button>
        ))}
      </div>
      <label className="inline-flex items-center gap-1.5">
        <span className="text-xs text-[var(--color-ink-faint)]">Wanneer</span>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs" />
      </label>
      <button type="button" onClick={submit} disabled={pending || !assignee} className="ml-auto inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
        <ClipboardList className="size-3.5" /> {pending ? "Bezig..." : "Taak aanmaken"}
      </button>
      {msg ? <span className="w-full text-xs font-medium text-[var(--color-bad)]">{msg}</span> : null}
    </div>
  );
}

const GRID = "grid grid-cols-[7rem_minmax(14rem,1.7fr)_11rem_7.5rem_8rem_5.5rem_7.5rem] items-center gap-x-4";

export function Klantgezondheid({ rows, staff, viewerId }: { rows: GezondheidRow[]; staff: StaffOption[]; viewerId: string }) {
  const [tab, setTab] = useState<"aandacht" | "alle">("aandacht");
  const [status, setStatus] = useState<GezondheidStatus | "alle">("alle");
  const [owner, setOwner] = useState<string>("Alle");
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const owners = useMemo(() => ["Alle", ...[...new Set(rows.map((r) => r.ownerName).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b, "nl"))], [rows]);
  const ownerOk = (r: GezondheidRow) => owner === "Alle" || r.ownerName === owner;
  const attention = rows.filter((r) => ATTENTION.includes(r.status));
  const statuses: GezondheidStatus[] = tab === "aandacht" ? ATTENTION : ["spoed", "bijsturen", "inhalen", "geen_data", "koers"];
  const shown = (tab === "aandacht" ? attention : rows).filter((r) => (status === "alle" || r.status === status) && ownerOk(r));
  const count = (s: GezondheidStatus) => rows.filter((r) => r.status === s && ownerOk(r)).length;

  return (
    <section className="mb-5" aria-labelledby="klantgezondheid-kop">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="klantgezondheid-kop" className="text-base font-bold tracking-tight">Klantgezondheid</h2>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            De status werkt met vaste vensters (laatste 30 dagen tegenover de 30 daarvoor) en volgt de periodekeuze hierboven niet.
          </p>
        </div>
        <button type="button" onClick={() => setHelp(!help)} aria-expanded={help} className="rounded-full border border-[var(--color-line-strong)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          Hoe werkt de status?
        </button>
      </div>

      {help ? (
        <div className="mb-3 grid gap-3 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 text-[13px] leading-relaxed sm:grid-cols-2">
          <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-2 text-xs">
            <span />
            <span className="text-[var(--color-ink-faint)]">Levering op schema</span>
            <span className="text-[var(--color-ink-faint)]">Levering achter</span>
            <span className="self-center text-[var(--color-ink-faint)]">Resultaten dalen</span>
            <Pill status="bijsturen" />
            <Pill status="spoed" />
            <span className="self-center text-[var(--color-ink-faint)]">Resultaten stabiel</span>
            <Pill status="koers" />
            <Pill status="inhalen" />
          </div>
          <div className="space-y-2">
            <p><b>Spoed:</b> de klant ziet slechte cijfers en krijgt te weinig nieuws. Ook een verlengmoment binnen 60 dagen, een open klacht bij dalende resultaten of een ernstig klantsignaal maakt het spoed.</p>
            <p><b>Inhalen</b> ligt aan ons tempo, niet aan de klant. <b>Geen oordeel</b> betekent dat er geen betrouwbare data is (geen koppeling, verouderd of te weinig).</p>
            <p className="text-[var(--color-ink-muted)]">Resultaten gaan altijd tegen de eigen historie van de klant, met de mediaan per video, zodat één uitschieter geen status verandert.</p>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="inline-flex rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5" role="tablist">
          {([["aandacht", `Aandacht · ${attention.length}`], ["alle", `Alle klanten · ${rows.length}`]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setStatus("alle"); }} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${tab === k ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {statuses.map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(status === s ? "alle" : s)} className={chip(status === s)}>
              <span className="size-2 rounded-full" style={{ background: TONE[s].text }} />
              {STATUS_LABEL[s]} <span className="opacity-70">{count(s)}</span>
            </button>
          ))}
        </div>
        {owners.length > 2 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Eigenaar</span>
            {owners.map((o) => (
              <button key={o} type="button" aria-pressed={owner === o} onClick={() => setOwner(o)} className={chip(owner === o)}>{o}</button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="min-w-[68rem]">
          <div className={`${GRID} border-b border-[var(--color-line)] px-4 py-2.5 text-2xs font-semibold text-[var(--color-ink-faint)]`}>
            <span>Gezondheid</span><span>Klant</span><span>Weergaven, 8 weken</span><span>Levering</span><span>Verlenging</span><span>Eigenaar</span><span />
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
              {tab === "aandacht" ? "Geen klanten die aandacht nodig hebben met deze filters." : "Geen klanten met deze filters."}
            </p>
          ) : null}
          {shown.map((r) => {
            const isOpen = open === r.clientId;
            const hasActie = r.status === "spoed" || r.status === "bijsturen" || r.status === "inhalen";
            const actie = hasActie ? ACTIES[r.status as "spoed" | "bijsturen" | "inhalen"] : null;
            return (
              <div key={r.clientId} className="border-b border-[var(--color-line)] last:border-b-0">
                <div className={`${GRID} px-4 py-1.5`}>
                  <span><Pill status={r.status} /></span>
                  <button type="button" onClick={() => { setOpen(isOpen ? null : r.clientId); setPicking(null); }} aria-expanded={isOpen} className="flex min-h-11 min-w-0 items-center gap-2.5 text-left">
                    <ClientLogo name={r.name} logoUrl={r.logoUrl} color={r.color} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{r.name}</span>
                      {hasActie ? <span className="block truncate text-xs text-[var(--color-ink-muted)]">{r.reden}</span> : null}
                    </span>
                    <ChevronDown className={`size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  <span className="flex items-center gap-2">
                    <Spark r={r} />
                    <span className="min-w-[2.75rem] text-sm font-semibold tabular-nums" style={{ color: r.status === "spoed" || r.status === "bijsturen" ? TONE[r.status].text : undefined }}>
                      {r.viewsPct == null ? "" : `${r.viewsPct > 0 ? "+" : r.viewsPct < 0 ? "-" : ""}${Math.abs(Math.round(r.viewsPct))}%`}
                    </span>
                  </span>
                  <span className="text-sm" style={{ color: r.lateCount > 0 ? TONE[r.status === "spoed" ? "spoed" : "inhalen"].text : "var(--color-ink-muted)", fontWeight: r.lateCount > 0 ? 600 : 400 }}>
                    {r.lateCount > 0 ? `${r.lateDays} d te laat` : "Op schema"}
                  </span>
                  <span className={`text-sm ${r.renewalSoon ? "font-semibold" : "text-[var(--color-ink-muted)]"}`}>{r.renewalSoon ? "Binnen 60 d" : "Later"}</span>
                  <span className="text-sm">{r.ownerName ?? ""}</span>
                  <span className="flex justify-end">
                    {hasActie ? (
                      <button type="button" onClick={() => { setOpen(r.clientId); setPicking(picking === r.clientId ? null : r.clientId); }} className="min-h-9 rounded-full bg-[var(--color-indigo-ink)] px-4 text-xs font-semibold text-white hover:opacity-90">
                        Oppakken
                      </button>
                    ) : null}
                  </span>
                </div>
                {isOpen ? (
                  <div className="px-4 pb-4 pl-[8.25rem]">
                    <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                      <span><b className="text-[var(--color-ink)]">Waarom:</b> {r.reden}</span>
                      <Link href={`/analytics/${r.slug}`} className="font-semibold text-[var(--color-ink)] underline-offset-2 hover:underline">Bekijk resultaten</Link>
                    </div>
                    {actie ? (
                      <div>
                        <div className="mb-2 text-[13px] font-bold">Wat nu: {actie.titel}</div>
                        <ol className="space-y-1.5">
                          {actie.stappen.map((s, i) => (
                            <li key={i} className="flex items-start gap-3 text-[13px] leading-relaxed">
                              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-line-strong)] text-2xs font-semibold">{i + 1}</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ol>
                        {picking === r.clientId ? <PickUp r={r} staff={staff} viewerId={viewerId} onDone={() => setPicking(null)} /> : null}
                      </div>
                    ) : (
                      <p className="text-[13px] text-[var(--color-ink-muted)]">{r.status === "geen_data" ? "Er is geen betrouwbaar oordeel mogelijk. Controleer de resultatenkoppeling van deze klant." : "Geen actie nodig."}</p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
