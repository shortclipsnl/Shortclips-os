"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Loader2, MessageSquareText, UserPlus, ScrollText, ExternalLink } from "lucide-react";
import { setScriptingNote, setScriptingStatus, setScriptWriter } from "@/server/actions/scripting";
import { SCRIPTING_ORDER, SCRIPTING_STATUS, SCRIPT_STATUS } from "@/lib/statuses";
import { ClientLogo, TeamAvatar } from "@/components/ui";
import type { ScriptingRow, WriterOption, LinkedScript } from "@/server/scripting";

/** Toon-kleur per status-tone, voor de kleine statuspillen van gekoppelde scripts. */
const TONE_COLOR: Record<string, string> = {
  neutral: "var(--color-ink-muted)",
  info: "var(--color-info)",
  lime: "var(--color-lime)",
  warn: "var(--color-warn)",
  bad: "var(--color-bad)",
  good: "var(--color-good)",
  violet: "var(--color-violet)",
  ink: "var(--color-ink)",
};

const FILTERS = [
  { key: "alle", label: "Alle aankomend" },
  { key: "niet-afgerond", label: "Nog niet afgerond" },
  { key: "deze-week", label: "Deze week" },
  { key: "volgende-week", label: "Volgende week" },
  { key: "nadert", label: "Deadline nadert" },
  { key: "te-laat", label: "Te laat" },
  { key: "afgerond", label: "Afgerond" },
] as const;

const STATUS_PILL: Record<string, string> = {
  concepting: "bg-[var(--color-info-soft)] text-[#0060a8]",
  scriptmeeting: "bg-[var(--color-warn-soft)] text-[#8a5300]",
  feedback_jarno: "bg-[var(--color-bad-soft)] text-[#a3271c]",
  afwachting_klant: "bg-[var(--color-violet-soft)] text-[#4a2fb8]",
  scripts_bij_klant: "bg-[var(--color-indigo-soft)] text-[var(--color-indigo-ink)]",
  nog_aanvullen: "bg-[var(--color-lime-soft)] text-[#54700a]",
  final: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
};

/** Volle accentkleur per status, voor de rand van de actieve knop. */
const STATUS_ACCENT: Record<string, string> = {
  concepting: "var(--color-info)",
  scriptmeeting: "var(--color-warn)",
  feedback_jarno: "var(--color-bad)",
  afwachting_klant: "var(--color-violet)",
  scripts_bij_klant: "var(--color-indigo-ink)",
  nog_aanvullen: "var(--color-lime)",
  final: "var(--color-good)",
};

/** Korte labels voor de knoppen (de volledige labels zijn soms lang). */
const STATUS_SHORT: Record<string, string> = {
  concepting: "Scripts opstellen",
  scriptmeeting: "Meeting plannen",
  feedback_jarno: "Feedback Jarno",
  afwachting_klant: "Afwachting klant",
  scripts_bij_klant: "Controle bij klant",
  nog_aanvullen: "Nog aanvullen",
  final: "Final",
};

/** Opname-week t.o.v. nu, voor de groepering. */
function weekBucket(days: number): { order: number; label: string } {
  if (days <= 7) return { order: 1, label: "Deze week" };
  if (days <= 14) return { order: 2, label: "Volgende week" };
  if (days <= 21) return { order: 3, label: "Over twee weken" };
  return { order: 4, label: "Later" };
}

/** Volle kleur per week-kop, zodat je van week naar week kunt scannen. "Deze
 *  week" krijgt bewust een afwijkende (violette) kleur, los van het blauw van de
 *  latere weken, zodat de huidige week er direct uitspringt. */
const WEEK_COLOR: Record<number, string> = {
  1: "var(--color-violet)",
  2: "var(--color-brand-600)",
  3: "var(--color-info)",
  4: "var(--color-ink-muted)",
};

function fmt(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/** Afteller-tekst tot de scriptingdeadline. */
function countdown(r: ScriptingRow): string {
  if (r.done) return "Afgerond";
  const d = r.daysToDeadline;
  if (d < 0) return `${Math.abs(d)} dag${Math.abs(d) === 1 ? "" : "en"} te laat`;
  if (d === 0) return "Vandaag deadline";
  if (d === 1) return "Morgen deadline";
  return `Nog ${d} dagen`;
}
const FLAG_COLOR: Record<string, string> = {
  green: "var(--color-good)",
  amber: "var(--color-warn)",
  red: "var(--color-bad)",
  done: "var(--color-good)",
};

export function ScriptingBoard({ rows, clientOptions, writerOptions, canWrite, defaultFilter }: { rows: ScriptingRow[]; clientOptions: string[]; writerOptions: WriterOption[]; canWrite: boolean; defaultFilter?: string }) {
  const [filter, setFilter] = useState<string>(FILTERS.some((f) => f.key === defaultFilter) ? defaultFilter! : "alle");
  const [status, setStatus] = useState<string>("alle");
  const [client, setClient] = useState<string>("alle");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "niet-afgerond" && r.done) return false;
      if (filter === "deze-week" && !(r.daysToShoot >= 0 && r.daysToShoot <= 7)) return false;
      if (filter === "volgende-week" && !(r.daysToShoot > 7 && r.daysToShoot <= 14)) return false;
      if (filter === "nadert" && !(r.flag === "amber")) return false;
      if (filter === "te-laat" && r.flag !== "red") return false;
      if (filter === "afgerond" && !r.done) return false;
      if (status !== "alle" && r.status !== status) return false;
      if (client !== "alle" && r.clientName !== client) return false;
      return true;
    });
  }, [rows, filter, status, client]);

  // Per week groeperen (deze week / volgende week / ...), gesorteerd op opnamedag.
  const groups = useMemo(() => {
    const m = new Map<number, { order: number; label: string; rows: ScriptingRow[] }>();
    for (const r of filtered) {
      const b = weekBucket(r.daysToShoot);
      const g = m.get(b.order) ?? { ...b, rows: [] };
      g.rows.push(r);
      m.set(b.order, g);
    }
    return [...m.values()]
      .sort((a, b) => a.order - b.order)
      .map((g) => ({ ...g, rows: [...g.rows].sort((x, y) => x.daysToShoot - y.daysToShoot) }));
  }, [filtered]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f.key ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="sc-input h-8 w-auto py-0 text-xs" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Scriptingstatus">
            <option value="alle">Alle statussen</option>
            {SCRIPTING_ORDER.map((s) => <option key={s} value={s}>{SCRIPTING_STATUS[s]!.label}</option>)}
          </select>
          <select className="sc-input h-8 w-auto py-0 text-xs" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Klant">
            <option value="alle">Alle klanten</option>
            {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-2 text-xs text-[var(--color-ink-faint)]">{filtered.length} van {rows.length} opnames</div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <table className="w-full min-w-[1200px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] text-left text-xs text-[var(--color-ink-faint)]">
              <th className="px-3 py-2 font-medium">Klant</th>
              <th className="px-2 py-2 font-medium">Opname</th>
              <th className="px-2 py-2 font-medium">Scriptdeadline</th>
              <th className="px-2 py-2 font-medium">Afteller</th>
              <th className="px-2 py-2 font-medium">Verantwoordelijke</th>
              <th className="px-2 py-2 font-medium">Scriptingstatus</th>
              <th className="px-2 py-2 font-medium">Scripts</th>
              <th className="px-2 py-2 font-medium">Notitie</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => (
              <Fragment key={g.label}>
                {/* Ruimte tussen de weekgroepen, zodat het beter scanbaar is. */}
                {gi > 0 ? (
                  <tr aria-hidden>
                    <td colSpan={8} className="h-6 bg-[var(--color-surface)]" />
                  </tr>
                ) : null}
                {/* Week-kop in volle kleur, zodat je van week naar week kunt scannen. */}
                <tr>
                  <td colSpan={8} className="p-0">
                    <div
                      className="flex items-center gap-2 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-white"
                      style={{ background: WEEK_COLOR[g.order] ?? "var(--color-ink-muted)" }}
                    >
                      {g.label}
                      <span className="rounded-full bg-white/25 px-2 py-0.5 text-2xs font-bold normal-case tabular-nums">{g.rows.length}</span>
                    </div>
                  </td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--color-line)] hover:bg-[var(--color-surface-sunken)]/40"
                    style={{ boxShadow: `inset 3px 0 0 ${FLAG_COLOR[r.flag]}` }}>
                    <td className="px-3 py-2">
                      <Link href={`/productions/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <ClientLogo name={r.clientName} logoUrl={r.clientLogo} color={r.clientColor} size={22} />
                        {r.clientName}
                      </Link>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{fmt(r.scheduledOn)}</td>
                    <td className="px-2 py-2 tabular-nums text-[var(--color-ink-muted)]">{fmt(r.deadline)}</td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: FLAG_COLOR[r.flag] }}>
                        <span className="size-2 rounded-full" style={{ background: FLAG_COLOR[r.flag] }} />
                        {countdown(r)}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <WriterCell id={r.id} writerId={r.scriptWriterId} writerName={r.scriptWriterName} writerAvatar={r.scriptWriterAvatar} options={writerOptions} canWrite={canWrite} urgent={!r.done && r.daysToDeadline <= 7} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <StatusPicker id={r.id} status={r.status} canWrite={canWrite} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <ScriptsCell scripts={r.scripts} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <NoteCell id={r.id} note={r.note} canWrite={canWrite} />
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {groups.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--color-ink-faint)]">Geen opnames met deze filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Aan de opname gekoppelde scripts: een knop met het aantal; klik voor een lijst
 * met elk script en zijn status, met een doorklik naar het script zelf. Zo zie je
 * op de scriptingpagina direct wat er al geschreven is en hoe ver het staat.
 */
function ScriptsCell({ scripts }: { scripts: LinkedScript[] }) {
  const [open, setOpen] = useState(false);
  const n = scripts.length;

  if (n === 0) {
    return <span className="text-xs text-[var(--color-ink-faint)]" title="Nog geen scripts gekoppeld aan deze opname">— nog geen</span>;
  }

  // Compacte voortgang: hoeveel scripts al goedgekeurd/klaar voor opname zijn.
  const klaar = scripts.filter((s) => s.status === "approved" || s.status === "ready_to_shoot").length;

  return (
    <div className="relative w-[150px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Bekijk de gekoppelde scripts en hun status"
        className="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-2 py-1.5 text-left text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)]"
      >
        <ScrollText className="size-4 shrink-0 text-[var(--color-brand-600)]" />
        <span className="truncate">{n} script{n === 1 ? "" : "s"}{klaar > 0 ? ` · ${klaar} klaar` : ""}</span>
        <ChevronDown className="ml-auto size-3.5 shrink-0 opacity-60" />
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-72 max-w-[85vw] rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-raised)]">
            <span className="mb-1 block px-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Gekoppelde scripts</span>
            <ul className="space-y-0.5">
              {scripts.map((s) => {
                const meta = SCRIPT_STATUS[s.status];
                const color = TONE_COLOR[meta?.tone ?? "neutral"] ?? "var(--color-ink-muted)";
                const isAd = /advertentie/i.test(s.format ?? "");
                return (
                  <li key={s.id}>
                    <Link href={`/scripts/${s.id}`} className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1.5 hover:bg-[var(--color-surface-sunken)]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--color-ink)]">{s.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-semibold" style={{ color, background: "color-mix(in srgb, " + color + " 14%, transparent)" }}>
                            <span className="size-1.5 rounded-full" style={{ background: color }} />
                            {meta?.label ?? s.status}
                          </span>
                          {isAd ? <span className="text-2xs font-semibold text-[var(--color-violet)]">{s.format}</span> : null}
                        </span>
                      </span>
                      <ExternalLink className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Verantwoordelijke scriptschrijver: alleen de (grotere) avatar, geen naam — het
 * team herkent elkaar aan het gezicht. Klik op de avatar om tussen de schrijvers
 * te wisselen. Niet toegewezen valt op als een stippelcirkel (oranje als de
 * deadline nadert), zodat meteen duidelijk is wie het nog moet oppakken.
 */
function WriterCell({ id, writerId, writerName, writerAvatar, options, canWrite, urgent }: { id: string; writerId: string | null; writerName: string | null; writerAvatar: string | null; options: WriterOption[]; canWrite: boolean; urgent: boolean }) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const warn = !writerId && urgent;

  const change = (next: string) => {
    setOpen(false);
    start(async () => { await setScriptWriter(id, next || null); router.refresh(); });
  };

  const face = writerName ? (
    <TeamAvatar name={writerName} avatarUrl={writerAvatar} size={48} />
  ) : (
    <span className={`grid size-12 place-items-center rounded-full border-2 border-dashed ${warn ? "border-[var(--color-warn)] text-[var(--color-warn)]" : "border-[var(--color-line-strong)] text-[var(--color-ink-faint)]"}`}>
      <UserPlus className="size-5" />
    </span>
  );

  if (!canWrite) return face;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        title={writerName ? `${writerName} — klik om te wisselen` : "Kies wie dit script schrijft"}
        className="relative inline-flex rounded-full ring-offset-2 ring-offset-[var(--color-surface)] transition hover:ring-2 hover:ring-[var(--color-brand-300)]"
      >
        {face}
        {pending ? (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-[var(--color-surface)]/70">
            <Loader2 className="size-4 animate-spin text-[var(--color-ink-faint)]" />
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1.5 flex w-max flex-col gap-0.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-raised)]">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => change(o.id)}
                className={`flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left text-sm hover:bg-[var(--color-surface-sunken)] ${o.id === writerId ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}
              >
                <TeamAvatar name={o.fullName} avatarUrl={o.avatarUrl} size={28} />
                {o.fullName.split(" ")[0]}
              </button>
            ))}
            {writerId ? (
              <button
                type="button"
                onClick={() => change("")}
                className="mt-0.5 border-t border-[var(--color-line)] px-2 pt-1.5 text-left text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-bad)]"
              >
                Niemand
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Vrije notitie in een eigen kolom rechts: context naast de korte status (bijv.
 * "nog beeld nodig van klant"), zodat de statuskolom schoon en op elkaar leesbaar
 * blijft. Een gevuld notitie-icoon maakt meteen duidelijk waar een opmerking bij
 * staat. Opslaan gebeurt bij verlaten van het veld of op Enter.
 */
function NoteCell({ id, note, canWrite }: { id: string; note: string | null; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(note ?? "");
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Preview in de cel (ingekort); de volledige tekst zie je in het uitklapvlak.
  const shownNote = (canWrite ? val : note ?? "").trim();
  const heeftNotitie = Boolean(shownNote);

  const save = () => {
    const next = val.trim();
    if (next !== (note ?? "").trim()) {
      start(async () => { await setScriptingNote(id, next); router.refresh(); });
    }
    setOpen(false);
  };

  // Alleen-lezen zonder notitie: rustig streepje, niet aanklikbaar.
  if (!canWrite && !heeftNotitie) return <span className="text-xs text-[var(--color-ink-faint)]">—</span>;

  return (
    <div className="relative w-[220px]">
      {/* Compacte knop met een korte preview; klik voor het volledige bericht. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={shownNote || "Notitie toevoegen"}
        className={`flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1.5 text-left text-xs ${
          heeftNotitie ? "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-ink)]" : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-faint)]"
        }`}
      >
        <MessageSquareText className={`size-4 shrink-0 ${heeftNotitie ? "text-[var(--color-brand-600)]" : "text-[var(--color-ink-faint)]"}`} />
        <span className="truncate">{shownNote || (canWrite ? "Opmerking voor team…" : "")}</span>
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={save} />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-72 max-w-[85vw] rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 shadow-[var(--shadow-raised)]">
            {canWrite ? (
              <>
                <textarea
                  value={val}
                  onChange={(e) => setVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setOpen(false);
                  }}
                  maxLength={500}
                  rows={5}
                  autoFocus
                  placeholder="Opmerking voor team…"
                  aria-label="Notitie bij scriptingstatus"
                  className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm leading-snug text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand-500)] focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  {pending ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : null}
                  <button type="button" onClick={save} className="rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-3 py-1.5 text-xs font-semibold text-white">Opslaan</button>
                </div>
              </>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-snug text-[var(--color-ink)]">{note}</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Gekleurde statuskiezer: de huidige status staat als grote gekleurde pil; bij
 * klikken klappen de opties (ook gekleurd, groter) eronder uit — zo ziet het
 * team in één oogopslag de status en kan het met één klik wisselen.
 */
function StatusPicker({ id, status, canWrite }: { id: string; status: string; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(status);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const meta = SCRIPTING_STATUS[val] ?? SCRIPTING_STATUS.concepting!;

  const choose = (v: string) => {
    setVal(v);
    setOpen(false);
    start(async () => { await setScriptingStatus(id, v); router.refresh(); });
  };

  if (!canWrite) {
    return (
      <span className={`inline-flex w-[200px] items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${STATUS_PILL[val] ?? "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>
        <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_ACCENT[val] ?? "var(--color-ink-faint)" }} />
        <span className="truncate">{STATUS_SHORT[val] ?? meta.label}</span>
      </span>
    );
  }

  // De opties klappen uit als een zwevende laag (absolute), zodat de tabel niet
  // verspringt. Een onzichtbare achtergrond vangt een klik ernaast op om te sluiten.
  return (
    <div className="relative w-[200px]">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={pending}
        title={meta.label}
        className={`flex w-full items-center justify-between gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${STATUS_PILL[val] ?? "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}
        style={open ? { boxShadow: `0 0 0 2px ${STATUS_ACCENT[val] ?? "var(--color-ink-faint)"}` } : undefined}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_ACCENT[val] ?? "var(--color-ink-faint)" }} />
          <span className="truncate">{STATUS_SHORT[val] ?? meta.label}</span>
        </span>
        {pending ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <ChevronDown className="size-3.5 shrink-0 opacity-60" />}
      </button>
      {open ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1.5 flex w-[200px] flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-raised)]">
            {SCRIPTING_ORDER.map((s) => (
              <button key={s} type="button" onClick={() => choose(s)} title={SCRIPTING_STATUS[s]!.label}
                className={`flex w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-left text-sm font-semibold ${STATUS_PILL[s]} ${s === val ? "" : "opacity-80 hover:opacity-100"}`}
                style={s === val ? { boxShadow: `0 0 0 2px ${STATUS_ACCENT[s]}` } : undefined}>
                <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_ACCENT[s] }} />
                <span className="truncate">{STATUS_SHORT[s]}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
