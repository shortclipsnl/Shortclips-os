"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, ArrowUpRight, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { domainState, OPS_DOMAINS, type DomainState, type OpsDomain } from "@/lib/ops-control/plan";
import type { OpsOverview } from "@/server/ops-control/overview";
import { escalateToJarno, runOpsControlNow } from "@/server/actions/ops-control";

const STATE: Record<DomainState, { label: string; color: string; soft: string }> = {
  groen: { label: "Alles in orde", color: "var(--color-good)", soft: "var(--color-good-soft)" },
  oranje: { label: "Actie nodig", color: "var(--color-warn)", soft: "var(--color-warn-soft)" },
  rood: { label: "Deadline verstreken of kritiek", color: "var(--color-bad)", soft: "var(--color-bad-soft)" },
  grijs: { label: "Niet gecontroleerd", color: "var(--color-ink-faint)", soft: "var(--color-surface)" },
};

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function dueLabel(d: string | null, today: string): string {
  if (!d) return "";
  if (d < today) return "te laat";
  if (d === today) return "vandaag";
  const [, m, day] = d.split("-").map(Number);
  return `${day}-${m}`;
}

/**
 * Operationele controle op het dashboard: zeven onderdelen met één status,
 * filters op medewerker, klant en type, en de open punten eronder. Medewerkers
 * zien standaard hun eigen punten; de operationeel verantwoordelijke en Jarno het
 * hele team. Groen verschijnt alleen als de controle vandaag gedraaid heeft en de
 * bron bereikbaar was.
 */
export function OpsControlCard({ data }: { data: OpsOverview }) {
  const [scope, setScope] = useState<"mine" | "team">(data.defaultScope);
  const [person, setPerson] = useState<string>("");
  const [client, setClient] = useState<string>("");
  const [domain, setDomain] = useState<OpsDomain | "deadlines" | "">("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [escalating, setEscalating] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const clientsList = useMemo(() => [...new Set(data.items.map((i) => i.clientLabel).filter((x): x is string => Boolean(x)))].sort(), [data.items]);

  const scoped = data.items.filter((i) =>
    (scope === "team" ? (!person || i.ownerId === person) : i.ownerId === data.me) &&
    (!client || i.clientLabel === client));
  const listed = scoped.filter((i) => {
    if (!domain) return true;
    if (domain === "deadlines") return i.dueOn != null && i.dueOn <= data.today; // vandaag of te laat
    return i.domain === domain;
  });

  const healthOf = (key: string) => data.health.find((h) => h.domain === key);
  const perPerson = data.people.map((p) => ({ ...p, n: data.items.filter((i) => i.ownerId === p.id).length, esc: data.items.filter((i) => i.ownerId === p.id && i.escalationLevel > 0).length }));
  const gapsTotal = data.gaps.coordinator.length + data.gaps.videographer.length + data.gaps.editor.length;

  const runNow = () => start(async () => {
    setMsg(null);
    const r = await runOpsControlNow();
    setMsg(r.ok ? `Gecontroleerd: ${r.message ?? ""}` : r.message);
  });
  const sendJarno = (id: string) => start(async () => {
    const r = await escalateToJarno(id, reason);
    if (r.ok) { setEscalating(null); setReason(""); setMsg("Doorgezet naar Jarno."); } else setMsg(r.message);
  });

  return (
    <section id="operationele-controle" className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-[var(--color-ink)]">
          <ShieldCheck className="size-4 text-[var(--color-brand-600)]" /> Operationele controle
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-2xs text-[var(--color-ink-faint)]">
          <span>
            {data.lastRun ? `Laatste controle: ${timeLabel(data.lastRun.at)}${data.lastRun.slot === "handmatig" ? " (handmatig)" : ""}` : "Nog geen controle uitgevoerd"}
            {" · "}vaste momenten {data.times.morning} en {data.times.afternoon}{data.enabled ? "" : " (staat uit)"}
          </span>
          {data.canRun ? (
            <button type="button" onClick={runNow} disabled={pending} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface)] disabled:opacity-50">
              {pending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Nu controleren
            </button>
          ) : null}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line-strong)]">
          {(["mine", "team"] as const).map((s) => (
            <button key={s} type="button" onClick={() => { setScope(s); setPerson(""); }}
              className={`px-2.5 py-1 font-semibold ${scope === s ? "bg-[var(--color-brand-600)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
              {s === "mine" ? "Mijn punten" : "Hele team"}
            </button>
          ))}
        </div>
        {scope === "team" ? (
          <select value={person} onChange={(e) => setPerson(e.target.value)} className="h-7 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2">
            <option value="">Alle medewerkers</option>
            {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : null}
        <select value={client} onChange={(e) => setClient(e.target.value)} className="h-7 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2">
          <option value="">Alle klanten</option>
          {clientsList.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={domain} onChange={(e) => setDomain(e.target.value as OpsDomain | "deadlines" | "")} className="h-7 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2">
          <option value="">Alle werkzaamheden</option>
          {OPS_DOMAINS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
      </div>

      {/* Zeven onderdelen */}
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {OPS_DOMAINS.map((d) => {
          const h = d.key === "deadlines" ? { check: "checked" as const, note: undefined } : healthOf(d.key);
          const check = h?.check ?? "unavailable";
          const st = domainState(d.key, scoped, { today: data.today, checkedToday: data.checkedToday, check });
          const n = d.key === "deadlines" ? scoped.filter((i) => i.dueOn != null && i.dueOn <= data.today).length : scoped.filter((i) => i.domain === d.key).length;
          const sub = st === "grijs"
            ? (check === "unavailable" ? "Controle niet mogelijk" : "Niet gecontroleerd")
            : st === "groen" ? (check === "partial" ? "In orde (deels gecontroleerd)" : "In orde") : `${n} ${n === 1 ? "punt" : "punten"}`;
          return (
            <button key={d.key} type="button" onClick={() => setDomain(domain === d.key ? "" : d.key)} title={h?.note ?? STATE[st].label}
              className={`flex items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left ${domain === d.key ? "border-[var(--color-brand-500)]" : "border-[var(--color-line)]"} bg-[var(--color-surface)] hover:brightness-[0.99]`}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATE[st].color }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[var(--color-ink)]">{d.label}</span>
                <span className="block text-2xs" style={{ color: st === "grijs" ? "var(--color-ink-faint)" : STATE[st].color }}>{sub}</span>
              </span>
            </button>
          );
        })}
        {/* Per medewerker (teamweergave) */}
        {scope === "team" ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
            <span className="block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Open per medewerker</span>
            <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {perPerson.map((p) => (
                <button key={p.id} type="button" onClick={() => setPerson(person === p.id ? "" : p.id)} className={`${person === p.id ? "font-bold" : ""} text-[var(--color-ink)]`}>
                  {p.name} <span className="tabular-nums text-[var(--color-ink-muted)]">{p.n}</span>
                  {p.esc > 0 ? <span className="ml-0.5 text-[var(--color-bad)]">({p.esc} geëscaleerd)</span> : null}
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </div>

      {msg ? <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{msg}</p> : null}

      {/* Open punten */}
      {listed.length > 0 ? (
        <ul className="mt-3 divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
          {listed.slice(0, 12).map((i) => (
            <li key={i.id} className="px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="size-2 shrink-0 rounded-full" style={{ background: i.severity === "rood" || (i.dueOn && i.dueOn < data.today) ? "var(--color-bad)" : "var(--color-warn)" }} />
                <Link href={i.href} className="min-w-0 flex-1 truncate hover:underline">
                  {i.clientLabel ? <span className="font-semibold text-[var(--color-ink)]">{i.clientLabel}: </span> : null}
                  <span className="text-[var(--color-ink)]">{i.action}</span>
                  <span className="text-[var(--color-ink-muted)]"> · {i.reason}</span>
                </Link>
                {i.escalationLevel > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[var(--color-bad-soft)] px-1.5 py-0.5 text-2xs font-semibold text-[var(--color-bad)]">
                    <AlertTriangle className="size-3" /> {i.escalationLevel >= 2 ? "Bij Jarno" : `Bij ${i.escalatedToName ?? "operationeel verantwoordelijke"}`}
                  </span>
                ) : null}
                {i.manualDoneCount > 0 ? <span className="shrink-0 text-2xs text-[var(--color-warn)]" title="Afgevinkt terwijl het probleem in de Hub nog openstond">heropend</span> : null}
                <span className="w-14 shrink-0 text-right text-2xs text-[var(--color-ink-muted)]">{i.ownerName ?? "-"}</span>
                <span className="w-14 shrink-0 text-right text-2xs font-semibold" style={{ color: i.dueOn && i.dueOn < data.today ? "var(--color-bad)" : "var(--color-ink-muted)" }}>{dueLabel(i.dueOn, data.today)}</span>
                {data.canRun && i.escalationLevel < 2 ? (
                  <button type="button" onClick={() => { setEscalating(escalating === i.id ? null : i.id); setReason(""); }} className="shrink-0 text-2xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]" title="Alleen voor zaken die je niet zelf mag oplossen (Zone C)">
                    Naar Jarno
                  </button>
                ) : null}
                <Link href={i.href} className="shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><ArrowUpRight className="size-3.5" /></Link>
              </div>
              {escalating === i.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Probleem en jouw voorstel (Zone C)"
                    className="h-8 min-w-[240px] flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 text-xs" />
                  <button type="button" disabled={pending} onClick={() => sendJarno(i.id)} className="rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Versturen</button>
                </div>
              ) : null}
            </li>
          ))}
          {listed.length > 12 ? <li className="px-3 py-2 text-xs text-[var(--color-ink-muted)]"><Link href="/tasks" className="hover:underline">+{listed.length - 12} meer op de takenpagina</Link></li> : null}
        </ul>
      ) : data.checkedToday ? (
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">Geen open punten in deze selectie.</p>
      ) : null}

      {/* Onderkant: afgerond vandaag + ontbrekende verantwoordelijken */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-[var(--color-ink-faint)]">
        <span>Vandaag afgerond: {data.resolvedToday.auto} bevestigd door de Hub · {data.resolvedToday.manual} handmatig gemarkeerd</span>
        {data.leadName ? <span>Operationeel verantwoordelijke: {data.leadName}</span> : null}
        {gapsTotal > 0 ? (
          <span className="text-[var(--color-warn)]" title={[
            data.gaps.coordinator.length ? `Geen verantwoordelijke: ${data.gaps.coordinator.join(", ")}` : "",
            data.gaps.videographer.length ? `Geen videograaf: ${data.gaps.videographer.join(", ")}` : "",
            data.gaps.editor.length ? `Geen vaste editor: ${data.gaps.editor.join(", ")}` : "",
          ].filter(Boolean).join("\n")}>
            Verantwoordelijkheden ontbreken: {data.gaps.coordinator.length} zonder verantwoordelijke, {data.gaps.videographer.length} zonder videograaf, {data.gaps.editor.length} zonder vaste editor (<Link href="/klantenbeheer" className="underline">Klantbeheer</Link>)
          </span>
        ) : null}
      </div>
    </section>
  );
}
