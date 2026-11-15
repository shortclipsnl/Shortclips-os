"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Check, ChevronDown, CircleAlert, Download, Eye, Globe, Loader2, Lock, RefreshCw, Send, Sparkles, TriangleAlert } from "lucide-react";
import { Badge, ClientLogo, buttonClass } from "@/components/ui";
import { approveQuarter, createQuarterReport, generateQuarter, planQuarters, publishQuarter } from "@/server/actions/quarterly-reports";
import type { QuarterOverview, QuarterRow } from "@/server/quarterly/service";
import { QUARTER_STATUSES, QUARTER_STATUS_META, kortDatum, type QuarterStatus } from "@/lib/kwartaal";

type Groep = "alle" | "binnenkort" | "automatisch" | "wachten" | "controleren" | "goedkeuren" | "goedgekeurd" | "gepubliceerd" | "achter";

/** In welke werkgroep een rapportage valt (voor de tellers bovenaan). */
function groepVan(r: QuarterRow): Exclude<Groep, "alle" | "achter"> {
  switch (r.status) {
    case "gepland": return "binnenkort";
    case "in_voorbereiding":
    case "concept_gegenereerd": return "automatisch";
    case "wachten_op_data": return "wachten";
    case "klaar_voor_controle": return r.gecontroleerd ? "goedkeuren" : "controleren";
    case "aanpassingen_nodig": return "controleren";
    case "goedgekeurd": return "goedgekeurd";
    default: return "gepubliceerd";
  }
}

const VOLGORDE: Record<QuarterStatus, number> = {
  aanpassingen_nodig: 0, klaar_voor_controle: 1, goedgekeurd: 2, wachten_op_data: 3, concept_gegenereerd: 4, in_voorbereiding: 5, gepland: 6, gepubliceerd: 7,
};

function Chip({ label, value, tone, active, onClick, title }: { label: string; value: number; tone?: "warn" | "bad" | "good"; active: boolean; onClick: () => void; title?: string }) {
  const kleur = tone === "bad" ? "text-[var(--color-bad)]" : tone === "warn" ? "text-[var(--color-warn)]" : tone === "good" ? "text-[var(--color-good)]" : "text-[var(--color-ink)]";
  return (
    <button type="button" onClick={onClick} title={title} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${active ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] hover:brightness-[0.98]"}`}>
      <span className={active ? "font-medium" : "text-[var(--color-ink-muted)]"}>{label}</span>
      <span className={`font-semibold tabular-nums ${active ? "" : value > 0 ? kleur : "text-[var(--color-ink-faint)]"}`}>{value}</span>
    </button>
  );
}

function PdfLinks({ id, versie, enabled, concept }: { id: string; versie: "intern" | "klant"; enabled: boolean; concept?: boolean }) {
  if (!enabled) return <span className="text-2xs text-[var(--color-ink-faint)]">Nog niet beschikbaar</span>;
  const href = `/api/reports/quarterly/${id}/pdf?versie=${versie}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <a href={href} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary", size: "sm", className: "!px-2" })} title={versie === "intern" ? "Interne versie bekijken" : "Klantversie bekijken"} aria-label={versie === "intern" ? "Interne versie bekijken" : "Klantversie bekijken"}><Eye className="size-3.5" /></a>
        <a href={`${href}&download=1`} className={buttonClass({ variant: "secondary", size: "sm", className: "!px-2" })} title={versie === "intern" ? "Interne versie downloaden" : "Klantversie downloaden"} aria-label={versie === "intern" ? "Interne versie downloaden" : "Klantversie downloaden"}><Download className="size-3.5" /></a>
      </div>
      {versie === "klant" && concept ? <span className="text-2xs text-[#8a5300]">Concept</span> : null}
    </div>
  );
}

export function QuarterList({ overview, viewerId, canWrite, canApprove, aiReady, initial }: {
  overview: QuarterOverview; viewerId: string; canWrite: boolean; canApprove: boolean; aiReady: boolean;
  initial: { status?: string; weergave?: string; klant?: string; jaar?: string; kwartaal?: string; medewerker?: string; klantstatus?: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [groep, setGroep] = useState<Groep>(initial.status === "actie" ? "controleren" : "alle");
  const [status, setStatus] = useState<string>(QUARTER_STATUSES.includes(initial.status as QuarterStatus) ? initial.status! : "alle");
  const [klant, setKlant] = useState(initial.klant ?? "alle");
  const [medewerker, setMedewerker] = useState(initial.medewerker ?? "alle");
  const [jaar, setJaar] = useState(initial.jaar ?? "alle");
  const [kwartaal, setKwartaal] = useState(initial.kwartaal ?? "alle");
  const [klantstatus, setKlantstatus] = useState<"actief" | "inactief" | "alle">(initial.klantstatus === "alle" || initial.klantstatus === "inactief" ? initial.klantstatus : "actief");
  const [weergave, setWeergave] = useState<"alles" | "mijn">(initial.weergave === "mijn" ? "mijn" : "alles");
  const [historieOpen, setHistorieOpen] = useState(false);
  const [nieuwKlant, setNieuwKlant] = useState("");
  const [nieuwWelk, setNieuwWelk] = useState<"huidig" | "vorig">("huidig");
  const { rows, teamOnly, today } = overview;

  // Zolang er iets wordt gegenereerd: de status vanzelf laten bijwerken.
  const loopt = rows.some((r) => r.bezig || r.inWachtrij);
  useEffect(() => {
    if (!loopt) return;
    const t = setInterval(() => router.refresh(), 20000);
    return () => clearInterval(t);
  }, [loopt, router]);

  const basis = useMemo(() => rows.filter((r) =>
    (klantstatus === "alle" || (klantstatus === "actief") === r.clientActive)
    && (klant === "alle" || r.clientId === klant)
    && (medewerker === "alle" || r.verantwoordelijkeId === medewerker)
    && (jaar === "alle" || String(r.year) === jaar)
    && (kwartaal === "alle" || r.kwartaalNaam === kwartaal)
    && (weergave === "alles" || r.mijn || r.verantwoordelijkeId === viewerId),
  ), [rows, klantstatus, klant, medewerker, jaar, kwartaal, weergave, viewerId]);

  const tel = (g: Groep) => basis.filter((r) => (g === "achter" ? r.achterstallig : groepVan(r) === g)).length;
  const zichtbaar = basis
    .filter((r) => (status === "alle" || r.status === status) && (groep === "alle" || (groep === "achter" ? r.achterstallig : groepVan(r) === groep)))
    .sort((a, b) => Number(b.achterstallig) - Number(a.achterstallig) || VOLGORDE[a.status] - VOLGORDE[b.status] || b.periodEnd.localeCompare(a.periodEnd) || a.clientName.localeCompare(b.clientName, "nl"));
  // Historie: gepubliceerde rapportages van afgelopen kwartalen. Al het andere is actueel werk.
  const historie = zichtbaar.filter((r) => r.status === "gepubliceerd" && r.afgelopen);
  const actueel = zichtbaar.filter((r) => !(r.status === "gepubliceerd" && r.afgelopen));
  const toggle = (g: Groep) => { setStatus("alle"); setGroep((cur) => (cur === g ? "alle" : g)); };

  const run = (key: string, fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) => {
    setBusy((b) => ({ ...b, [key]: true }));
    start(async () => {
      const res = await fn();
      setRowMsg((m) => ({ ...m, [key]: { ok: res.ok, text: res.ok ? okText : res.message ?? "Mislukt." } }));
      setBusy((b) => ({ ...b, [key]: false }));
      router.refresh();
    });
  };

  function renderActies(r: QuarterRow) {
    const m = rowMsg[r.id];
    const isBusy = Boolean(busy[r.id]) || r.bezig;
    const detail = `/analytics/kwartaalrapportages/${r.id}`;
    let hoofd: ReactNode;
    if (isBusy || r.inWachtrij) {
      hoofd = <span className={buttonClass({ variant: "secondary", size: "sm" })} aria-disabled><Loader2 className="size-3.5 animate-spin" /> {r.inWachtrij && !r.bezig ? "In de wachtrij" : "Wordt gegenereerd"}</span>;
    } else if (r.status === "gepubliceerd") {
      hoofd = <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-good)]"><Check className="size-3.5" /> Gepubliceerd{r.publishedAt ? ` · ${kortDatum(r.publishedAt.slice(0, 10))}` : ""}</span>;
    } else if (r.status === "goedgekeurd") {
      hoofd = canWrite
        ? <button type="button" disabled={pending} onClick={() => { if (confirm(`De klantversie van ${r.clientName} (${r.periodLabel}) publiceren naar het klantportaal?`)) run(r.id, () => publishQuarter(r.id), "Gepubliceerd in het klantportaal."); }} className={`${buttonClass({ variant: "primary", size: "sm" })} !border-[var(--color-good)] !bg-[var(--color-good)]`}><Send className="size-3.5" /> Publiceren naar klantportaal</button>
        : <span className="text-2xs text-[var(--color-ink-muted)]">Goedgekeurd, nog niet gepubliceerd</span>;
    } else if (r.status === "klaar_voor_controle" || r.status === "aanpassingen_nodig") {
      hoofd = canApprove && r.gecontroleerd
        ? <button type="button" disabled={pending} onClick={() => run(r.id, () => approveQuarter(r.id), "Goedgekeurd.")} className={buttonClass({ variant: "primary", size: "sm" })}><Check className="size-3.5" /> Goedkeuren</button>
        : <Link href={detail} className={buttonClass({ variant: canWrite ? "primary" : "secondary", size: "sm" })}><CircleAlert className="size-3.5" /> {r.status === "aanpassingen_nodig" ? "Aanpassen" : r.gecontroleerd ? "Bekijken" : "Controleren"}</Link>;
    } else if (r.status === "concept_gegenereerd") {
      hoofd = <Link href={detail} className={buttonClass({ variant: "secondary", size: "sm" })}><Eye className="size-3.5" /> Concept bekijken</Link>;
    } else if (r.status === "wachten_op_data") {
      hoofd = <Link href={detail} className={buttonClass({ variant: "secondary", size: "sm" })}><TriangleAlert className="size-3.5" /> Bekijk wat ontbreekt</Link>;
    } else {
      hoofd = canWrite
        ? <button type="button" disabled={pending || !aiReady} title={aiReady ? "Voorlopig concept met de cijfers tot nu toe" : "AI-sleutel ontbreekt"} onClick={() => run(r.id, () => generateQuarter(r.id), "Genereren gestart.")} className={buttonClass({ variant: "secondary", size: "sm" })}><Sparkles className="size-3.5" /> Rapportage genereren</button>
        : <span className="text-2xs text-[var(--color-ink-faint)]">Nog niet gestart</span>;
    }
    return (
      <div className="flex flex-col items-start gap-1">
        {hoofd}
        {r.hasContent && r.status !== "klaar_voor_controle" && r.status !== "aanpassingen_nodig" && r.status !== "concept_gegenereerd" ? <Link href={detail} className="text-2xs text-[var(--color-info)] hover:underline">Rapportage bekijken</Link> : null}
        {r.portaalLooptAchter ? <span className="text-2xs text-[#8a5300]" title="De klant ziet nog de vorige versie tot de nieuwe is gepubliceerd.">In portaal: versie {r.publishedVersion}</span> : null}
        {m ? <span className={`max-w-[230px] text-2xs ${m.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{m.text}</span> : null}
      </div>
    );
  }

  function renderStatus(r: QuarterRow) {
    const meta = QUARTER_STATUS_META[r.status];
    return (
      <div className="flex flex-col items-start gap-1">
        <span title={meta.uitleg}><Badge tone={meta.tone}>{meta.label}</Badge></span>
        {r.status === "klaar_voor_controle" && r.gecontroleerd ? <span className="text-2xs text-[var(--color-good)]">Gecontroleerd, wacht op goedkeuring</span> : null}
        {r.voorlopig && r.hasContent && !teamOnly ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-2xs font-medium text-[#8a5300]"><TriangleAlert className="size-3" /> Voorlopige cijfers</span> : null}
        {r.wachtReden && r.status === "wachten_op_data" ? <span className="max-w-[230px] text-2xs text-[var(--color-warn)]">{r.wachtReden}</span> : null}
        {r.ontbrekend > 0 && !teamOnly && r.status !== "gepland" ? <span className="inline-flex items-center gap-1 text-2xs font-medium text-[var(--color-warn)]"><CircleAlert className="size-3" /> {r.ontbrekend} {r.ontbrekend === 1 ? "gegeven ontbreekt" : "gegevens ontbreken"}</span> : null}
        {r.errorMessage ? <span className="max-w-[230px] text-2xs text-[var(--color-bad)]">Genereren mislukt: {r.errorMessage}</span> : null}
      </div>
    );
  }

  function renderDeadline(r: QuarterRow) {
    if (!r.deadline) return <span className="text-2xs text-[var(--color-ink-faint)]">–</span>;
    const laat = r.achterstallig || (r.deadline.teLaat && r.status !== "gepland" && r.status !== "in_voorbereiding");
    return (
      <div className={`max-w-[150px] text-xs ${laat ? "font-semibold text-[var(--color-bad)]" : "text-[var(--color-ink)]"}`}>
        {kortDatum(r.deadline.datum)}
        <span className={`block text-2xs font-normal ${laat ? "text-[var(--color-bad)]" : "text-[var(--color-ink-faint)]"}`}>{laat ? `Achterstallig · ${r.deadline.label.toLowerCase()}` : r.deadline.label}</span>
      </div>
    );
  }

  const renderKlant = (r: QuarterRow) => (
    <div className="flex items-center gap-2">
      <ClientLogo name={r.clientName} logoUrl={r.logoUrl} color={r.color} size={22} />
      <div className="min-w-0">
        <Link href={`/analytics/kwartaalrapportages/${r.id}`} className="font-medium text-[var(--color-ink)] hover:underline">{r.clientName}</Link>
        {!r.clientActive ? <span className="ml-1.5 align-middle"><Badge tone="neutral">Niet actief</Badge></span> : null}
      </div>
    </div>
  );

  function renderTabel(list: QuarterRow[], leeg: string) {
    if (list.length === 0) return <div className="sc-card p-6 text-center text-sm text-[var(--color-ink-muted)]">{leeg}</div>;
    const pdfOk = (r: QuarterRow) => r.hasContent && !r.bezig;
    return (
      <>
        {/* Desktop: tabel */}
        <div className="sc-card hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left">
                <th className="sc-th">Klant</th><th className="sc-th">Rapportageperiode</th><th className="sc-th">Verantwoordelijke</th><th className="sc-th">Contractvorm</th><th className="sc-th">Status</th><th className="sc-th">Deadline</th>
                <th className="sc-th"><span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-[var(--color-info)]"><Lock className="size-3" /> Intern</span></th>
                <th className="sc-th"><span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-[var(--color-good)]"><Globe className="size-3" /> Klant</span></th>
                <th className="sc-th">Acties</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className={`border-b border-[var(--color-line)] align-top last:border-0 ${r.achterstallig ? "bg-[var(--color-bad-soft,#fdeeee)]/40" : ""}`}>
                  <td className="sc-td min-w-[190px]">{renderKlant(r)}</td>
                  <td className="sc-td whitespace-nowrap"><span className="font-medium">{r.kwartaalNaam}{r.periodMode === "kalender" ? ` ${r.year}` : ""}</span><span className="block text-2xs text-[var(--color-ink-faint)]">{kortDatum(r.periodStart)} t/m {kortDatum(r.periodEnd)}</span></td>
                  <td className="sc-td whitespace-nowrap">{r.verantwoordelijke ?? <span className="text-[var(--color-warn)]">Geen verantwoordelijke</span>}</td>
                  <td className="sc-td max-w-[150px] text-xs">{r.contractvorm}</td>
                  <td className="sc-td">{renderStatus(r)}</td>
                  <td className="sc-td">{renderDeadline(r)}</td>
                  <td className="sc-td"><PdfLinks id={r.id} versie="intern" enabled={pdfOk(r)} /></td>
                  <td className="sc-td"><PdfLinks id={r.id} versie="klant" enabled={pdfOk(r)} concept={r.status !== "goedgekeurd" && r.status !== "gepubliceerd"} /></td>
                  <td className="sc-td">{renderActies(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobiel: één kaart per rapportage */}
        <ul className="flex flex-col gap-3 md:hidden">
          {list.map((r) => (
            <li key={r.id} className={`sc-card p-4 ${r.achterstallig ? "border-[var(--color-bad)]" : ""}`}>
              <div className="flex items-start justify-between gap-3">{renderKlant(r)}{renderDeadline(r)}</div>
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{r.kwartaalNaam}{r.periodMode === "kalender" ? ` ${r.year}` : ""} · {kortDatum(r.periodStart)} t/m {kortDatum(r.periodEnd)} · {r.verantwoordelijke ?? "Geen verantwoordelijke"}</p>
              <p className="text-2xs text-[var(--color-ink-faint)]">{r.contractvorm}</p>
              <div className="mt-2.5">{renderStatus(r)}</div>
              <div className="mt-3 flex flex-wrap items-start gap-4 border-t border-[var(--color-line)] pt-3">
                <div><p className="mb-1 text-2xs font-semibold uppercase text-[var(--color-ink-faint)]">Intern</p><PdfLinks id={r.id} versie="intern" enabled={pdfOk(r)} /></div>
                <div><p className="mb-1 text-2xs font-semibold uppercase text-[var(--color-ink-faint)]">Klant</p><PdfLinks id={r.id} versie="klant" enabled={pdfOk(r)} concept={r.status !== "goedgekeurd" && r.status !== "gepubliceerd"} /></div>
              </div>
              <div className="mt-3">{renderActies(r)}</div>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const label = (t: string) => <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{t}</span>;
  const pill = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-ink-muted)]"}`;
  const zonderRij = overview.clients.filter((c) => c.active && !rows.some((r) => r.clientId === c.id));

  return (
    <div className="space-y-4">
      {!teamOnly ? (
        <div className="flex flex-wrap items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-[var(--color-ink-muted)]" />
          <p className="min-w-0 flex-1 basis-[240px] text-[var(--color-ink-muted)]">
            <b className="text-[var(--color-ink)]">Zo loopt het vanzelf.</b> Op dag 1 van de derde maand krijgt de verantwoordelijke een taak. Halverwege die maand staat er een voorlopig concept. Na afloop worden de volledige cijfers opgehaald: uiterlijk <b className="text-[var(--color-ink)]">vijf werkdagen</b> later klaar voor controle, uiterlijk <b className="text-[var(--color-ink)]">zeven werkdagen</b> later in het klantportaal. Er gaat nooit iets naar een klant zonder goedkeuring.
          </p>
          {canWrite ? (
            <button type="button" disabled={pending} onClick={() => start(async () => { const res = await planQuarters(); setMsg({ ok: res.ok, text: res.ok ? "Planning bijgewerkt." : res.message ?? "Mislukt." }); router.refresh(); })} className={buttonClass({ variant: "secondary", size: "sm" })} title="Kwartalen inplannen en taken gelijkzetten. Dit gebeurt ook elke ochtend automatisch.">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Planning bijwerken
            </button>
          ) : null}
        </div>
      ) : null}

      {!teamOnly ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip label="Alle" value={basis.length} active={groep === "alle" && status === "alle"} onClick={() => { setGroep("alle"); setStatus("alle"); }} />
          <Chip label="Binnenkort voorbereiden" value={tel("binnenkort")} active={groep === "binnenkort"} onClick={() => toggle("binnenkort")} title="Het kwartaal loopt; de voorbereiding start op dag 1 van de derde maand" />
          <Chip label="Automatisch in voorbereiding" value={tel("automatisch")} active={groep === "automatisch"} onClick={() => toggle("automatisch")} title="Taak staat klaar of het voorlopige concept is gegenereerd" />
          <Chip label="Wacht op complete resultaten" value={tel("wachten")} tone="warn" active={groep === "wachten"} onClick={() => toggle("wachten")} />
          <Chip label="Intern controleren" value={tel("controleren")} tone="warn" active={groep === "controleren"} onClick={() => toggle("controleren")} />
          <Chip label="Klaar voor goedkeuring" value={tel("goedkeuren")} tone="warn" active={groep === "goedkeuren"} onClick={() => toggle("goedkeuren")} />
          <Chip label="Goedgekeurd, nog publiceren" value={tel("goedgekeurd")} tone="good" active={groep === "goedgekeurd"} onClick={() => toggle("goedgekeurd")} />
          <Chip label="Gepubliceerd" value={tel("gepubliceerd")} tone="good" active={groep === "gepubliceerd"} onClick={() => toggle("gepubliceerd")} />
          <Chip label="Achterstallig" value={tel("achter")} tone="bad" active={groep === "achter"} onClick={() => toggle("achter")} />
        </div>
      ) : null}

      <div className="sc-card flex flex-wrap items-end gap-3 p-3">
        <label>{label("Klant")}<select className="sc-input text-sm" value={klant} onChange={(e) => setKlant(e.target.value)}><option value="alle">Alle klanten</option>{overview.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>{label("Verantwoordelijke")}<select className="sc-input text-sm" value={medewerker} onChange={(e) => setMedewerker(e.target.value)}><option value="alle">Iedereen</option>{overview.medewerkers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>{label("Kwartaal")}<select className="sc-input text-sm" value={kwartaal} onChange={(e) => setKwartaal(e.target.value)}><option value="alle">Alle kwartalen</option>{overview.kwartalen.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <label>{label("Jaar")}<select className="sc-input text-sm" value={jaar} onChange={(e) => setJaar(e.target.value)}><option value="alle">Alle jaren</option>{overview.jaren.map((j) => <option key={j} value={String(j)}>{j}</option>)}</select></label>
        {!teamOnly ? <label>{label("Rapportagestatus")}<select className="sc-input text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setGroep("alle"); }}><option value="alle">Alle statussen</option>{QUARTER_STATUSES.map((s) => <option key={s} value={s}>{QUARTER_STATUS_META[s].label}</option>)}</select></label> : null}
        <div>{label("Klanten")}<div className="flex gap-1">{(["actief", "inactief", "alle"] as const).map((k) => <button key={k} type="button" className={pill(klantstatus === k)} onClick={() => setKlantstatus(k)}>{k === "alle" ? "Alle" : k === "actief" ? "Actief" : "Niet actief"}</button>)}</div></div>
        {!teamOnly ? <div>{label("Weergave")}<div className="flex gap-1"><button type="button" className={pill(weergave === "alles")} onClick={() => setWeergave("alles")}>Alles</button><button type="button" className={pill(weergave === "mijn")} onClick={() => setWeergave("mijn")}>Mijn rapportages</button></div></div> : null}
      </div>

      {msg ? <p className={`text-sm ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null}

      {renderTabel(actueel, rows.length === 0 ? (canWrite ? "Er zijn nog geen kwartalen ingepland. Klik op Planning bijwerken om voor elke actieve klant het lopende kwartaal in te plannen." : "Er zijn nog geen kwartaalrapportages.") : "Geen rapportages voor deze filters.")}

      {canWrite && zonderRij.length > 0 ? (
        <div className="sc-card flex flex-wrap items-end gap-3 p-3">
          <label>{label("Rapportage klaarzetten voor")}<select className="sc-input text-sm" value={nieuwKlant} onChange={(e) => setNieuwKlant(e.target.value)}><option value="">Kies een klant</option>{overview.clients.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{label("Kwartaal")}<select className="sc-input text-sm" value={nieuwWelk} onChange={(e) => setNieuwWelk(e.target.value as "huidig" | "vorig")}><option value="huidig">Lopend kwartaal</option><option value="vorig">Vorig kwartaal</option></select></label>
          <button type="button" disabled={!nieuwKlant || pending} onClick={() => start(async () => { const res = await createQuarterReport(nieuwKlant, nieuwWelk); setMsg({ ok: res.ok, text: res.ok ? "Rapportage klaargezet." : res.message ?? "Mislukt." }); if (res.ok && res.reportId) router.push(`/analytics/kwartaalrapportages/${res.reportId}`); else router.refresh(); })} className={buttonClass({ variant: "secondary", size: "sm" })}>Klaarzetten</button>
          <span className="text-2xs text-[var(--color-ink-faint)]">{zonderRij.length} actieve {zonderRij.length === 1 ? "klant heeft" : "klanten hebben"} nog geen kwartaalrapportage.</span>
        </div>
      ) : null}

      {historie.length > 0 ? (
        <div className="sc-card p-4">
          <button type="button" onClick={() => setHistorieOpen((o) => !o)} aria-expanded={historieOpen} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
            <ChevronDown className={`size-4 text-[var(--color-ink-faint)] transition-transform ${historieOpen ? "rotate-180" : "-rotate-90"}`} /> Historische rapportages ({historie.length})
          </button>
          <p className="mt-0.5 text-2xs text-[var(--color-ink-muted)]">Gepubliceerde rapportages van eerdere kwartalen. Een gepubliceerde versie verandert niet meer; een herpublicatie is altijd een nieuwe, vastgelegde versie.</p>
          {historieOpen ? <div className="mt-3">{renderTabel(historie, "")}</div> : null}
        </div>
      ) : null}

      <p className="text-2xs text-[var(--color-ink-faint)]">
        De interne versie is alleen voor het Shortclips-team en gaat nooit naar de klant of het klantportaal. Alleen de goedgekeurde klantversie kan worden gepubliceerd. Vandaag: {kortDatum(today)}.
      </p>
    </div>
  );
}
