"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlarmClock, AlertTriangle, CalendarClock, ChevronDown, FileClock, Loader2, MessageSquareText, UserPlus, ScrollText, ExternalLink, FileCheck2, X } from "lucide-react";
import { setScriptingNote, setScriptingStatus, setScriptWriter } from "@/server/actions/scripting";
import { SCRIPTING_ORDER, SCRIPTING_STATUS, SCRIPT_STATUS } from "@/lib/statuses";
import { ClientLogo, Stat, TeamAvatar } from "@/components/ui";
import type { ScriptingRow, WriterOption, LinkedScript } from "@/server/scripting";
import { PortalSendCell } from "./portal-send";
import { DriveSessionPicker } from "./drive-session-picker";
import { ScriptberichtRowButton } from "./scriptbericht";

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
  controle_jarno: "bg-[var(--color-warn-soft)] text-[#8a5300]",
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
  controle_jarno: "var(--color-warn)",
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
  controle_jarno: "Controle Jarno",
  feedback_jarno: "Feedback verwerken",
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

export function ScriptingBoard({ rows, clientOptions, writerOptions, canWrite, defaultFilter, defaultStatus, viewerId, viewerName, focusId }: { rows: ScriptingRow[]; clientOptions: string[]; writerOptions: WriterOption[]; canWrite: boolean; defaultFilter?: string; defaultStatus?: string; viewerId?: string; viewerName?: string; focusId?: string }) {
  // Vanuit een taak (?sessie=<opname>): alle filters open, zodat de regel zeker
  // zichtbaar is, en daarna ernaartoe scrollen en kort oplichten.
  const focusRow = focusId ? rows.find((r) => r.id === focusId) ?? null : null;
  const [filter, setFilter] = useState<string>(!focusRow && FILTERS.some((f) => f.key === defaultFilter) ? defaultFilter! : "alle");
  const [status, setStatus] = useState<string>(!focusRow && (SCRIPTING_ORDER as readonly string[]).includes(defaultStatus ?? "") ? defaultStatus! : "alle");
  const [client, setClient] = useState<string>("alle");
  // Filter op scriptschrijver via de profielfoto's bovenaan (Milou / Jarno / Jiska).
  // Standaard meteen op "Mijn scripts" als de viewer zelf opnames heeft — zo ziet
  // Milou/Jiska/Jarno direct hun eigen werk; met één klik switch je naar Iedereen.
  // Heb je zelf niks (bijv. geen scriptschrijver), dan begin je bij "Iedereen".
  const hasOwnScripts = viewerId ? rows.some((r) => r.scriptWriterId === viewerId) : false;
  const [writer, setWriter] = useState<string>(focusRow ? "alle" : hasOwnScripts ? viewerId! : "alle");
  const focusRef = useRef<HTMLTableRowElement | null>(null);
  const [flash, setFlash] = useState<string | null>(focusRow?.id ?? null);
  useEffect(() => {
    if (!focusRow) return;
    focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(t);
  }, [focusRow]);

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
      if (writer !== "alle" && r.scriptWriterId !== writer) return false;
      return true;
    });
  }, [rows, filter, status, client, writer]);

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

  // De statusblokken rekenen mee met de scriptschrijver-keuze: op "Mijn scripts"
  // zie je alleen jouw eigen deadlines/te laat/opnames — niet de teamtotalen.
  // (Status- en klantfilter tellen hier bewust niet mee; de blokken zijn zélf de
  // bovenliggende filters.)
  const scopeCounts = useMemo(() => {
    const scope = writer === "alle" ? rows : rows.filter((r) => r.scriptWriterId === writer);
    return {
      upcoming: scope.length,
      notDone: scope.filter((r) => !r.done).length,
      deadlineSoon: scope.filter((r) => r.flag === "amber").length,
      late: scope.filter((r) => r.flag === "red").length,
    };
  }, [rows, writer]);

  return (
    <div>
      {writerOptions.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="mr-0.5 text-xs text-[var(--color-ink-faint)]">Scriptschrijver</span>
          {/* "Mijn scripts": één klik → alleen de opnames waar jíj de verantwoordelijke
              scriptschrijver bent. Zo ziet iedereen meteen zijn eigen werk. */}
          {viewerId ? (() => {
            const me = writerOptions.find((w) => w.id === viewerId);
            const active = writer === viewerId;
            return (
              <button type="button" onClick={() => setWriter(active ? "alle" : viewerId)} aria-pressed={active}
                title="Alleen de scripts waar jij verantwoordelijk voor bent"
                className={`inline-flex min-h-[44px] items-center gap-2.5 rounded-full py-1 pl-1 pr-4 text-sm font-semibold transition ${active ? "bg-[var(--color-brand-600)] text-white" : "border border-[var(--color-brand-300)] text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)]"}`}>
                <span className={`block shrink-0 overflow-hidden rounded-full ring-2 ${active ? "ring-white/80" : "ring-[var(--color-brand-200)]"}`}>
                  <TeamAvatar name={me?.fullName ?? viewerName ?? "Ik"} avatarUrl={me?.avatarUrl ?? null} size={40} />
                </span>
                Mijn scripts
              </button>
            );
          })() : null}
          <button type="button" onClick={() => setWriter("alle")}
            className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-medium transition ${writer === "alle" ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"}`}>
            Iedereen
          </button>
          {/* Grote avatars, zelfde pill-stijl als de personenfilter op de
              klantenpagina — zo herken je het team in één oogopslag. */}
          {writerOptions.map((w) => {
            const active = writer === w.id;
            return (
              <button key={w.id} type="button" title={w.fullName} aria-pressed={active}
                onClick={() => setWriter(active ? "alle" : w.id)}
                className={`inline-flex min-h-[44px] items-center gap-2.5 rounded-full py-1 pl-1 pr-4 text-sm font-medium transition ${active ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"}`}>
                <span className={`block shrink-0 overflow-hidden rounded-full ${active ? "ring-2 ring-white/80" : "ring-1 ring-[var(--color-line)]"}`}>
                  <TeamAvatar name={w.fullName} avatarUrl={w.avatarUrl} size={40} />
                </span>
                {w.fullName.split(" ")[0]}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Statusblokken — klikbaar als filter, en per scriptschrijver (Mijn scripts). */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat compact label="Deadline nadert" value={String(scopeCounts.deadlineSoon)} tone={scopeCounts.deadlineSoon > 0 ? "lime" : "good"} icon={<AlarmClock />} hint="binnen 7 dagen" onClick={() => setFilter("nadert")} active={filter === "nadert"} />
        <Stat compact label="Te laat" value={String(scopeCounts.late)} tone={scopeCounts.late > 0 ? "bad" : "good"} icon={<AlertTriangle />} onClick={() => setFilter("te-laat")} active={filter === "te-laat"} />
        <Stat compact label="Aankomende opnames" value={String(scopeCounts.upcoming)} tone="info" icon={<CalendarClock />} onClick={() => setFilter("alle")} active={filter === "alle"} />
        <Stat compact label="Nog niet afgerond" value={String(scopeCounts.notDone)} tone={scopeCounts.notDone > 0 ? "warn" : "good"} icon={<FileClock />} onClick={() => setFilter("niet-afgerond")} active={filter === "niet-afgerond"} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* De filter-pillrij is verwijderd — de klikbare statusblokken hierboven
            zijn de filters. De status- en klantkeuze blijven rechts staan. */}
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

      {focusId && !focusRow ? (
        <p className="mb-2 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[#8a5300]">
          Deze scriptsessie staat niet meer in de lijst van aankomende opnames (opname is voorbij, verplaatst of vervallen).
        </p>
      ) : null}
      <div className="mb-2 text-xs text-[var(--color-ink-faint)]">{filtered.length} van {rows.length} opnames</div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-line)]">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-sunken)] text-left text-xs text-[var(--color-ink-faint)]">
              <th className="px-3 py-2 font-medium">Klant</th>
              <th className="px-2 py-2 font-medium">Opname</th>
              <th className="px-2 py-2 font-medium">Afteller</th>
              <th className="px-2 py-2 font-medium">Verantwoordelijke</th>
              <th className="px-2 py-2 font-medium">Scriptingstatus</th>
              <th className="px-2 py-2 font-medium">Klantportaal</th>
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
                  <tr key={r.id} id={`sessie-${r.id}`} ref={r.id === focusRow?.id ? focusRef : undefined}
                    className={`scroll-mt-24 border-b border-[var(--color-line)] transition-colors duration-700 hover:bg-[var(--color-surface-sunken)]/40 ${flash === r.id ? "bg-[var(--color-brand-50)]" : ""}`}
                    style={{ boxShadow: flash === r.id ? `inset 3px 0 0 ${FLAG_COLOR[r.flag]}, inset 0 0 0 2px var(--color-brand-500)` : `inset 3px 0 0 ${FLAG_COLOR[r.flag]}` }}>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1">
                        <Link href={`/productions/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
                          <ClientLogo name={r.clientName} logoUrl={r.clientLogo} color={r.clientColor} size={22} />
                          {r.clientName}
                        </Link>
                        <ScriptberichtRowButton productionDayId={r.id} clientName={r.clientName} />
                      </span>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{fmt(r.scheduledOn)}</td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: FLAG_COLOR[r.flag] }}>
                        <span className="size-2 rounded-full" style={{ background: FLAG_COLOR[r.flag] }} />
                        {countdown(r)}
                      </span>
                      <span className="mt-0.5 block text-2xs tabular-nums text-[var(--color-ink-faint)]">deadline {fmt(r.deadline)}</span>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <WriterCell id={r.id} writerId={r.scriptWriterId} writerName={r.scriptWriterName} writerAvatar={r.scriptWriterAvatar} options={writerOptions} canWrite={canWrite} urgent={!r.done && r.daysToDeadline <= 7} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <StatusPicker id={r.id} status={r.status} note={r.note} canWrite={canWrite} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <PortalSendCell row={r} canWrite={canWrite} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <ScriptsCell row={r} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <NoteCell id={r.id} note={r.note} status={r.status} canWrite={canWrite} />
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

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtLong(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** Kleine statuspil voor een script (SCRIPT_STATUS + tone-kleur). */
function ScriptStatusPill({ status }: { status: string }) {
  const meta = SCRIPT_STATUS[status];
  const color = TONE_COLOR[meta?.tone ?? "neutral"] ?? "var(--color-ink-muted)";
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-semibold" style={{ color, background: "color-mix(in srgb, " + color + " 14%, transparent)" }}>
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {meta?.label ?? status}
    </span>
  );
}

/**
 * "Bekijk scripts": een knop bij elke opname die een paneel opent met de volledig
 * leesbare, aan die opname gekoppelde scripts (titel, Shortclip uitleg, hook,
 * middenstuk, call to action), hun status en wanneer ze voor het laatst zijn
 * aangepast — zodat het team niet naar Drive of de generator hoeft. Is er nog
 * niets gekoppeld, dan toont het paneel een melding met een directe link naar de
 * Script Generator voor deze opname.
 */
function ScriptsCell({ row }: { row: ScriptingRow }) {
  const [open, setOpen] = useState(false);
  const n = row.scripts.length;
  const pdf = row.linkedPdf;
  const klaar = row.scripts.filter((s) => s.status === "approved" || s.status === "ready_to_shoot").length;
  // De knop is "gevuld" zodra er gekoppelde scripts óf een gekoppelde PDF is.
  const heeftIets = n > 0 || Boolean(pdf);
  // Final zonder script of PDF: Rutger en de editor hebben dan niets om mee te
  // werken. Duidelijk markeren in plaats van stil "Koppel script-PDF".
  const finalZonderScript = row.status === "final" && !heeftIets;
  const label = n > 0
    ? `${n} script${n === 1 ? "" : "s"}${klaar > 0 ? ` · ${klaar} klaar` : ""}`
    : pdf
      ? "PDF gekoppeld"
      : finalZonderScript
        ? "Final, maar geen PDF"
        : "Koppel script-PDF";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={pdf ? `Gekoppelde PDF: ${pdf.name}${pdf.sessionName ? ` (${pdf.sessionName})` : ""}` : "Bekijk de scripts van deze opname en koppel een script-PDF uit Google Drive"}
        className={`flex w-[132px] items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1.5 text-left text-xs font-medium hover:border-[var(--color-brand-500)] ${heeftIets ? "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-ink)]" : finalZonderScript ? "border-[var(--color-bad)]/40 bg-[var(--color-bad-soft)] text-[#a3271c]" : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)]"}`}
      >
        {pdf && n === 0 ? <FileCheck2 className="size-4 shrink-0 text-[var(--color-good)]" /> : <ScrollText className={`size-4 shrink-0 ${heeftIets ? "text-[var(--color-brand-600)]" : "text-[var(--color-ink-faint)]"}`} />}
        <span className="min-w-0">
          <span className="block truncate">{label}</span>
          {pdf ? <span className="block truncate text-2xs font-normal text-[var(--color-ink-muted)]">{n > 0 ? "+ PDF · " : ""}{pdf.sessionName ?? pdf.name}</span> : null}
        </span>
      </button>
      {open ? <ScriptsModal row={row} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Volledig, leesbaar overzicht van de gekoppelde scripts van één opname. */
function ScriptsModal({ row, onClose }: { row: ScriptingRow; onClose: () => void }) {
  const n = row.scripts.length;
  const scriptingMeta = SCRIPTING_STATUS[row.status];
  const scriptingColor = TONE_COLOR[scriptingMeta?.tone ?? "neutral"] ?? "var(--color-ink-muted)";

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 sm:p-8" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        {/* Kop: klant + opnamedatum + scriptingstatus + aantal */}
        <div className="sticky top-0 flex items-start gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <ClientLogo name={row.clientName} logoUrl={row.clientLogo} color={row.clientColor} size={34} />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-[var(--color-ink)]">{row.clientName}</h2>
            <p className="text-xs text-[var(--color-ink-muted)]">Opname: {fmtLong(row.scheduledOn)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold" style={{ color: scriptingColor, background: "color-mix(in srgb, " + scriptingColor + " 14%, transparent)" }}>
                <span className="size-1.5 rounded-full" style={{ background: scriptingColor }} />
                {scriptingMeta?.label ?? row.status}
              </span>
              <span className="text-2xs text-[var(--color-ink-faint)]">{n} gekoppeld{n === 1 ? " script" : "e scripts"}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><X className="size-5" /></button>
        </div>

        {n === 0 ? (
          <div className="p-6 text-center">
            <ScrollText className="mx-auto mb-2 size-7 text-[var(--color-ink-faint)]" />
            <p className="text-sm text-[var(--color-ink-muted)]">Er zijn nog geen scripts uit de Script Generator aan deze opname gekoppeld. Een script-PDF uit Drive koppel je hieronder.</p>
            <Link href={`/ai/scriptgenerator?client=${row.clientId}`} className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-good)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
              ✍️ Open de Script Generator voor deze opname
            </Link>
          </div>
        ) : (
          <>
          {n > 0 ? (
          <ul className="divide-y divide-[var(--color-line)]">
            {row.scripts.map((s, i) => {
              const isAd = /advertentie/i.test(s.format ?? "");
              return (
                <li key={s.id} className="p-4">
                  <div className="mb-2 flex items-start gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-brand-600)] text-2xs font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--color-ink)]">{s.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <ScriptStatusPill status={s.status} />
                        {isAd ? <span className="text-2xs font-semibold text-[var(--color-violet)]">{s.format}</span> : null}
                        <span className="text-2xs text-[var(--color-ink-faint)]">v{s.version} · bijgewerkt {fmtDateTime(s.updatedAt)}</span>
                      </div>
                    </div>
                    <Link href={`/scripts/${s.id}`} className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)]">
                      Open <ExternalLink className="size-3" />
                    </Link>
                  </div>
                  <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-xs">
                    <Block label="Shortclip uitleg" text={s.uitleg} italic />
                    <Block label={isAd ? "Hooks" : "Hook"} text={s.hook} />
                    <Block label={isAd ? "Probleem & oplossing" : "Middenstuk"} text={s.body} />
                    <Block label="Call to action" text={s.cta} />
                  </div>
                </li>
              );
            })}
          </ul>
          ) : null}
          </>
        )}
        {/* Script-PDF uit Google Drive: sessiemap → PDF → koppelen. */}
        <DriveSessionPicker productionDayId={row.id} />
      </div>
    </div>
  );
}

/** Eén leesbaar tekstblok in het scriptpaneel. */
function Block({ label, text, italic }: { label: string; text: string | null; italic?: boolean }) {
  if (!text || !text.trim()) return null;
  return (
    <div>
      <span className="mb-0.5 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</span>
      <p className={`whitespace-pre-wrap leading-relaxed text-[var(--color-ink)] ${italic ? "italic text-[var(--color-ink-muted)]" : ""}`}>{text}</p>
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
function NoteCell({ id, note, status, canWrite }: { id: string; note: string | null; status: string; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(note ?? "");
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Preview in de cel (ingekort); de volledige tekst zie je in het uitklapvlak.
  const shownNote = (canWrite ? val : note ?? "").trim();
  const heeftNotitie = Boolean(shownNote);
  // Bij Final/Afgerond blijft de notitie bewaard voor de historie, maar minder
  // prominent: de nadruk ligt op openstaande "Nog aanvullen"-opmerkingen.
  const prominent = heeftNotitie && status !== "final";

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
    <div className="relative w-[150px]">
      {/* Compacte knop met een korte preview; klik voor het volledige bericht. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={shownNote || "Notitie toevoegen"}
        className={`flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1.5 text-left text-xs ${
          prominent
            ? "border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-ink)]"
            : heeftNotitie
              ? "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)]"
              : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-faint)]"
        }`}
      >
        <MessageSquareText className={`size-4 shrink-0 ${prominent ? "text-[var(--color-brand-600)]" : "text-[var(--color-ink-faint)]"}`} />
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
function StatusPicker({ id, status, note, canWrite }: { id: string; status: string; note: string | null; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [val, setVal] = useState(status);
  const [open, setOpen] = useState(false);
  // "Nog aanvullen" vereist een notitie: zonder bestaande notitie vragen we die
  // eerst, zodat het team ziet wat er nog aangevuld of aangepast moet worden.
  const [vraagNotitie, setVraagNotitie] = useState(false);
  const [notitie, setNotitie] = useState(note ?? "");
  const router = useRouter();
  const meta = SCRIPTING_STATUS[val] ?? SCRIPTING_STATUS.concepting!;

  const opslaan = (v: string) => {
    setVal(v);
    setOpen(false);
    setVraagNotitie(false);
    start(async () => { await setScriptingStatus(id, v); router.refresh(); });
  };

  const choose = (v: string) => {
    if (v === "nog_aanvullen" && !(note ?? "").trim()) {
      setVal(v);
      setOpen(false);
      setNotitie(note ?? "");
      setVraagNotitie(true);
      return;
    }
    opslaan(v);
  };

  const bevestigMetNotitie = () => {
    const tekst = notitie.trim();
    if (!tekst) return;
    setVal("nog_aanvullen");
    setVraagNotitie(false);
    start(async () => {
      await setScriptingNote(id, tekst);
      await setScriptingStatus(id, "nog_aanvullen");
      router.refresh();
    });
  };

  if (!canWrite) {
    return (
      <span className={`inline-flex w-[150px] items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${STATUS_PILL[val] ?? "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>
        <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_ACCENT[val] ?? "var(--color-ink-faint)" }} />
        <span className="truncate">{STATUS_SHORT[val] ?? meta.label}</span>
      </span>
    );
  }

  // De opties klappen uit als een zwevende laag (absolute), zodat de tabel niet
  // verspringt. Een onzichtbare achtergrond vangt een klik ernaast op om te sluiten.
  return (
    <div className="relative w-[150px]">
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
          <div className="absolute left-0 top-full z-20 mt-1.5 flex w-[150px] flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-raised)]">
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
      {vraagNotitie ? (
        <>
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setVraagNotitie(false)} />
          <div className="absolute left-0 top-full z-20 mt-1.5 w-72 max-w-[85vw] rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 shadow-[var(--shadow-raised)]">
            <p className="text-xs font-semibold text-[var(--color-ink)]">Wat moet er nog aangevuld worden?</p>
            <p className="mb-2 mt-0.5 text-2xs text-[var(--color-ink-muted)]">Verplicht bij &quot;Nog aanvullen&quot; — zichtbaar voor het hele team.</p>
            <textarea
              value={notitie}
              onChange={(e) => setNotitie(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setVraagNotitie(false); }}
              maxLength={500}
              rows={4}
              autoFocus
              placeholder="Bijv. hook ontbreekt nog, call-to-action aanpassen…"
              aria-label="Wat moet er nog aangevuld worden"
              className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm leading-snug text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand-500)] focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              {pending ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : null}
              <button type="button" onClick={() => setVraagNotitie(false)} className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Annuleren</button>
              <button type="button" onClick={bevestigMetNotitie} disabled={!notitie.trim()} className="rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Opslaan</button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
