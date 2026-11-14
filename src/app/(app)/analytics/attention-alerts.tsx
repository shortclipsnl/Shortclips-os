"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, ClipboardList, ListPlus, RefreshCw, Sparkles } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import type { AlertCard, LastRun, StaffOption } from "@/server/result-alerts";
import { EFFECT_LABEL, platformName, type Cause, type Level } from "@/lib/result-alerts";
import { createResultAlertTask, rerunResultAlerts, resolveResultAlert } from "@/server/actions/result-alerts";

/* ------------------------------------------------------------------ *
 * Opmaak
 * ------------------------------------------------------------------ */

const LEVEL: Record<Level, { label: string; color: string; soft: string }> = {
  rood: { label: "Direct aandacht nodig", color: "var(--color-bad)", soft: "var(--color-bad-soft)" },
  oranje: { label: "Verbetering aanbevolen", color: "var(--color-warn)", soft: "var(--color-warn-soft)" },
  groen: { label: "Positieve ontwikkeling", color: "var(--color-good)", soft: "var(--color-good-soft)" },
};

const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" });
const fmtDate = (d: string | null) => (d ? dateFmt.format(new Date(d.length === 10 ? `${d}T12:00:00Z` : d)) : "");
const TASK_STATUS: Record<string, string> = { todo: "Te doen", in_progress: "Bezig", blocked: "Geblokkeerd", done: "Afgerond" };

/** Werkdagen optellen (za/zo overslaan) voor de standaarddeadline. */
function addWorkdays(n: number): string {
  const d = new Date();
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Korte vorm van het advies voor alerts van vóór de compacte weergave. */
function shortAdvice(a: AlertCard): string {
  if (a.analysis.adviceShort) return a.analysis.adviceShort;
  const first = a.analysis.advice.split(/[:,]/)[0]?.trim() ?? a.analysis.advice;
  return first.length > 60 ? `${first.slice(0, 57)}...` : first;
}

function causeLabel(c: Cause | undefined): string {
  if (!c) return "Onbekend";
  if (c.label) return c.label;
  const t = c.text.split(/[:.]/)[0] ?? c.text;
  return t.length > 32 ? `${t.slice(0, 30)}...` : t;
}

/** Klein label: onderbouwd (gevuld) of hypothese (omlijnd). */
function EvidenceDot({ kind }: { kind: Cause["kind"] }) {
  const proven = kind === "onderbouwd";
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={proven ? { background: "var(--color-indigo-ink)" } : { border: "1.5px solid var(--color-ink-faint)" }}
      title={proven ? "Onderbouwd door de eigen data van deze klant" : "Hypothese: nog testen"}
      aria-label={proven ? "Onderbouwd" : "Hypothese"}
    />
  );
}

function CauseTag({ c }: { c: Cause }) {
  const proven = c.kind === "onderbouwd";
  return (
    <span
      className="mr-1.5 inline-block shrink-0 rounded px-1.5 py-px align-[1px] text-[10.5px] font-semibold uppercase tracking-wide"
      style={{ background: proven ? "var(--color-indigo-ink)" : "var(--color-surface-sunken)", color: proven ? "#fff" : "var(--color-ink-muted)" }}
    >
      {proven ? "Onderbouwd" : "Hypothese"}
    </span>
  );
}

const firstName = (n: string | null | undefined) => (n ? n.split(" ")[0] : null);
const initials = (n: string | null | undefined) => (n ? n.split(/\s+/).slice(0, 1).map((p) => p[0]!.toUpperCase()).join("") : "?");

const METRIC_LABEL: Record<string, string> = {
  bereik: "bereik",
  groei: "bereik",
  retentie: "kijktijd",
  interactie: "interactie",
  volgers: "volgers",
  reeks: "op rij onder niveau",
  platform: "bereik",
  format: "format zwakker",
  succes: "topformat onbenut",
};

/** Eén groot cijfer met één woord erbij, zoals "−22% kijktijd". */
function bigMetric(a: AlertCard): { value: string; label: string } {
  const f = a.analysis.findings[0];
  if (!f) return { value: "", label: a.headline };
  const label = f.key === "platform" && f.platform ? `${platformName(f.platform)}` : METRIC_LABEL[f.key] ?? "";
  if (f.key === "reeks") return { value: `${f.headline.match(/\d+/)?.[0] ?? ""}x`, label };
  if (f.deltaPct == null) return { value: "", label: f.headline };
  const v = f.deltaPct;
  return { value: `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`, label };
}

/* ------------------------------------------------------------------ *
 * Hoofdblok: één regel per klant
 * ------------------------------------------------------------------ */

type Filters = { persoon: string; platform: string; status: string };

export function AttentionAlerts({ active, closed, lastRun, staff, viewerId }: { active: AlertCard[]; closed: AlertCard[]; lastRun: LastRun | null; staff: StaffOption[]; viewerId: string }) {
  const [filters, setFilters] = useState<Filters>({ persoon: "", platform: "", status: "" });
  const [open, setOpenState] = useState<{ id: string; actie: boolean } | null>(null);
  const setOpen = (id: string | null, actie = false) => setOpenState(id ? { id, actie } : null);
  const [showAll, setShowAll] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const platforms = useMemo(() => [...new Set(active.flatMap((a) => a.platforms))].sort(), [active]);
  const match = (a: AlertCard) => {
    const owner = a.task?.assigneeId ?? a.assigneeId;
    if (filters.persoon && owner !== filters.persoon) return false;
    if (filters.platform && !a.platforms.includes(filters.platform)) return false;
    if (filters.status === "open" && a.status !== "open") return false;
    if (filters.status === "actie" && a.status !== "actie") return false;
    return true;
  };
  const negatives = active.filter((a) => a.kind === "negatief" && match(a));
  const positives = active.filter((a) => a.kind === "positief" && match(a));
  const shown = showAll ? negatives : negatives.slice(0, 8);
  const rood = active.filter((a) => a.level === "rood").length;
  const oranje = active.filter((a) => a.level === "oranje").length;
  const openPositive = positives.find((p) => p.id === open?.id);

  const rerun = () =>
    start(async () => {
      await rerunResultAlerts();
      router.refresh();
    });

  return (
    <section id="aandacht" className="mb-5 scroll-mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      {/* Kop */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <h2 className="text-base font-semibold tracking-tight">Klanten die aandacht nodig hebben</h2>
        {rood ? <Count n={rood} color="var(--color-bad)" soft="var(--color-bad-soft)" /> : null}
        {oranje ? <Count n={oranje} color="var(--color-warn)" soft="var(--color-warn-soft)" /> : null}
        <div className="ml-auto flex items-center gap-1.5">
          <MiniSelect value={filters.persoon} onChange={(v) => setFilters({ ...filters, persoon: v })} options={[["", "Iedereen"], ...staff.map((s) => [s.id, s.id === viewerId ? "Ik" : firstName(s.name)!] as [string, string])]} />
          {platforms.length > 1 ? <MiniSelect value={filters.platform} onChange={(v) => setFilters({ ...filters, platform: v })} options={[["", "Alle platforms"], ...platforms.map((p) => [p, platformName(p)] as [string, string])]} /> : null}
          <MiniSelect value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} options={[["", "Alle"], ["open", "Actie nodig"], ["actie", "Opgepakt"]]} />
          <button type="button" onClick={rerun} disabled={pending} className="inline-flex size-7 items-center justify-center rounded-full text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)] disabled:opacity-60" title={lastRun ? `Opnieuw analyseren (laatst ${fmtDate(lastRun.at)})` : "Analyseren"}>
            <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Regels */}
      {negatives.length ? (
        <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {shown.map((a) => (
            <AlertRow key={a.id} a={a} open={open?.id === a.id} actie={open?.id === a.id && open.actie} onToggle={() => setOpen(open?.id === a.id ? null : a.id)} onPickUp={() => setOpen(a.id, true)} staff={staff} viewerId={viewerId} />
          ))}
          {negatives.length > shown.length ? (
            <li><button type="button" onClick={() => setShowAll(true)} className="w-full py-2 text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Toon alle {negatives.length}</button></li>
          ) : null}
        </ul>
      ) : (
        <p className="border-t border-[var(--color-line)] px-4 py-4 text-sm text-[var(--color-ink-muted)]">
          {lastRun ? "Geen klanten met tegenvallende resultaten." : "De eerste analyse draait morgenochtend vanzelf."}
        </p>
      )}

      {/* Gaat goed */}
      {positives.length ? (
        <div className="border-t border-[var(--color-line)] bg-[var(--color-good-soft)]">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="mr-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-good)]">Gaat goed</span>
            {positives.map((p) => {
              const m = bigMetric(p);
              return (
                <button key={p.id} type="button" onClick={() => setOpen(open?.id === p.id ? null : p.id)} className={`inline-flex items-center gap-1.5 rounded-full border bg-[var(--color-surface)] py-0.5 pl-0.5 pr-3 text-[13px] ${open?.id === p.id ? "border-[var(--color-good)]" : "border-transparent hover:border-[var(--color-good)]"}`}>
                  <ClientLogo name={p.clientName} logoUrl={p.logoUrl} color={p.color} size={22} />
                  <span className="font-semibold">{p.clientName}</span>
                  {m.value ? <span className="font-bold text-[var(--color-good)]">{m.value}</span> : null}
                </button>
              );
            })}
          </div>
          {openPositive ? <div className="px-4 pb-3"><Detail key={openPositive.id} a={openPositive} staff={staff} viewerId={viewerId} startWithAction={false} /></div> : null}
        </div>
      ) : null}

      {/* Onderaan, klein */}
      {closed.length || lastRun?.insufficient.length ? (
        <div className="flex flex-col gap-1.5 border-t border-[var(--color-line)] px-4 py-2">
          {closed.length ? <ClosedList closed={closed} /> : null}
          {lastRun?.insufficient.length ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-[var(--color-ink-faint)] [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                {lastRun.insufficient.length} klanten met te weinig data
              </summary>
              <ul className="mt-1 grid gap-x-6 gap-y-0.5 pl-5 text-xs sm:grid-cols-2">
                {lastRun.insufficient.map((i) => (
                  <li key={i.clientId} className="truncate" title={i.reason}>
                    <Link href={`/analytics/${i.slug}`} className="font-medium hover:underline">{i.name}</Link>
                    <span className="text-[var(--color-ink-faint)]"> · {i.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Count({ n, color, soft }: { n: number; color: string; soft: string }) {
  return <span className="grid h-6 min-w-6 place-items-center rounded-full px-2 text-xs font-bold" style={{ background: soft, color }}>{n}</span>;
}

function MiniSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`rounded-full border px-2.5 py-1 text-xs ${value ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] font-semibold text-white" : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink-muted)]"}`}>
      {options.map(([v, l]) => <option key={v || "_"} value={v} className="bg-white text-[var(--color-ink)]">{l}</option>)}
    </select>
  );
}

function OwnerAvatar({ name, title }: { name: string | null; title?: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-white" style={{ background: name ? "var(--color-indigo-ink)" : "var(--color-line-strong)" }} title={title ?? name ?? "Niemand toegewezen"}>
      {name ? initials(name) : "?"}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Regel
 * ------------------------------------------------------------------ */

function AlertRow({ a, open, actie, onToggle, onPickUp, staff, viewerId }: { a: AlertCard; open: boolean; actie: boolean; onToggle: () => void; onPickUp: () => void; staff: StaffOption[]; viewerId: string }) {
  const lv = LEVEL[a.level];
  const m = bigMetric(a);
  const owner = a.task?.assigneeName ?? a.assigneeName;
  const picked = a.status === "actie";
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}
        className={`grid cursor-pointer grid-cols-[10px_30px_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-[var(--color-surface-2)] md:grid-cols-[10px_30px_minmax(0,1.2fr)_150px_minmax(0,1.4fr)_28px_96px] ${open ? "bg-[var(--color-surface-2)]" : ""}`}
      >
        <span className="size-2.5 rounded-full" style={{ background: lv.color }} title={lv.label} />
        <ClientLogo name={a.clientName} logoUrl={a.logoUrl} color={a.color} size={30} />
        <span className="min-w-0 truncate text-sm font-semibold">{a.clientName}</span>
        <span className="whitespace-nowrap text-right md:text-left">
          {m.value ? <span className="text-lg font-bold" style={{ color: lv.color }}>{m.value}</span> : null}
          <span className={`text-[13px] ${m.value ? "ml-1 text-[var(--color-ink-muted)]" : "font-semibold"}`} style={m.value ? undefined : { color: lv.color }}>{m.label}</span>
        </span>
        <span className="col-span-3 col-start-2 min-w-0 truncate text-[13px] font-semibold md:col-span-1 md:col-start-auto" title={a.analysis.advice}>→ {shortAdvice(a)}</span>
        <span className="hidden md:block"><OwnerAvatar name={owner} title={owner ? `${owner}${picked ? " (opgepakt)" : ""}` : undefined} /></span>
        <span className="hidden justify-end md:flex">
          {picked ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-ink-muted)]"><CheckCircle2 className="size-3.5" /> Opgepakt</span>
          ) : (
            <button type="button" onClick={(e) => { e.stopPropagation(); onPickUp(); }} className="w-full rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-2.5 py-1.5 text-xs font-semibold text-white hover:opacity-90">Oppakken</button>
          )}
        </span>
      </div>
      {open ? <div className="px-4 pb-3 pt-1"><Detail key={`${a.id}-${actie}`} a={a} staff={staff} viewerId={viewerId} startWithAction={actie} /></div> : null}
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Klikvenster: Probleem / Waarom / Doen
 * ------------------------------------------------------------------ */

function Detail({ a, staff, viewerId, startWithAction }: { a: AlertCard; staff: StaffOption[]; viewerId: string; startWithAction: boolean }) {
  const [panel, setPanel] = useState<null | "actie" | "oplossen" | "uitleg">(startWithAction ? "actie" : null);
  const lv = LEVEL[a.level];
  const f = a.analysis.findings[0];
  const c = a.analysis.causes[0];
  const example = a.analysis.memory?.find((mi) => mi.key === "hooks")?.items[0];
  const hasOpenTask = a.task && a.task.status !== "done";
  const toggle = (p: NonNullable<typeof panel>) => setPanel(panel === p ? null : p);
  return (
    <div className="max-w-[720px] rounded-[var(--radius-md)] border border-[var(--color-line)] border-t-[3px] bg-[var(--color-surface)] p-4" style={{ borderTopColor: lv.color }}>
      <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-[var(--color-ink-faint)]">Probleem</dt>
        <dd className="font-semibold">{f ? `${f.headline}${f.metric ? ` (${f.metric})` : ""}` : a.headline}</dd>
        <dt className="text-[var(--color-ink-faint)]">Waarom</dt>
        <dd className="flex items-center gap-2">{c ? <EvidenceDot kind={c.kind} /> : null}{causeLabel(c)}{c?.kind === "hypothese" ? <span className="text-xs text-[var(--color-ink-faint)]">(nog testen)</span> : null}</dd>
        <dt className="text-[var(--color-ink-faint)]">Doen</dt>
        <dd className="font-semibold">{shortAdvice(a)}</dd>
        {example ? (
          <>
            <dt className="text-[var(--color-ink-faint)]">Voorbeeld</dt>
            <dd className="italic text-[var(--color-ink-muted)]">{example}</dd>
          </>
        ) : null}
        {a.task ? (
          <>
            <dt className="text-[var(--color-ink-faint)]">Taak</dt>
            <dd>{firstName(a.task.assigneeName) ?? "Niemand"} · {TASK_STATUS[a.task.status] ?? a.task.status}{a.task.dueOn ? ` · ${fmtDate(a.task.dueOn)}` : ""}</dd>
          </>
        ) : null}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {hasOpenTask ? (
          <Link href={`/tasks?persoon=${a.task!.assigneeId ?? ""}`} className={btn(false, true)}><ClipboardList className="size-3.5" /> Bekijk taak</Link>
        ) : (
          <button type="button" onClick={() => toggle("actie")} className={btn(panel === "actie", panel !== "actie")}><ListPlus className="size-3.5" /> Actie aanmaken</button>
        )}
        <Link href={`/analytics/${a.clientSlug}`} className={btn(false)}>Resultaten</Link>
        <Link href={`/contentgeheugen?klant=${a.clientSlug}`} className={btn(false)}>Contentgeheugen</Link>
        <button type="button" onClick={() => toggle("oplossen")} className={btn(panel === "oplossen")}><CheckCircle2 className="size-3.5" /> Opgelost</button>
        <button type="button" onClick={() => toggle("uitleg")} className="ml-auto text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">{panel === "uitleg" ? "Minder uitleg ‹" : "Meer uitleg ›"}</button>
      </div>

      {panel === "actie" && !hasOpenTask ? <div className="mt-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]"><ActionPanel a={a} staff={staff} viewerId={viewerId} onDone={() => setPanel(null)} /></div> : null}
      {panel === "oplossen" ? <div className="mt-3 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]"><ResolvePanel a={a} onDone={() => setPanel(null)} /></div> : null}
      {panel === "uitleg" ? <div className="mt-3 border-t border-[var(--color-line)] pt-3"><AnalysePanel a={a} /></div> : null}
    </div>
  );
}

const btn = (active: boolean, primary = false) =>
  `inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-semibold transition ${
    primary ? "bg-[var(--color-indigo-ink)] text-white hover:opacity-90" : active ? "bg-[var(--color-surface-sunken)] text-[var(--color-ink)]" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
  }`;

function Block({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">
        <span className="grid size-4 place-items-center rounded-full bg-[var(--color-indigo-ink)] text-[10px] text-white">{n}</span>{title}
      </h4>
      {children}
    </div>
  );
}

function AnalysePanel({ a }: { a: AlertCard }) {
  const m = a.analysis;
  const mem = (m.memory ?? []).filter((mi) => mi.items.length && ["hooks", "formats", "lengte", "verschil", "cta"].includes(mi.key)).slice(0, 4);
  return (
    <div className="space-y-3 text-[13px] leading-snug">
      <div className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
        <Block n={1} title="Wat valt op?">
          <ul className="space-y-1">
            {m.findings.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: LEVEL[f.level].color }} />
                <span title={f.detail}><span className="font-semibold">{f.headline}{f.platform ? ` (${platformName(f.platform)})` : ""}</span>{f.metric ? <span className="text-[var(--color-ink-muted)]">: {f.metric}</span> : <span className="text-[var(--color-ink-muted)]"> {f.detail}</span>}</span>
              </li>
            ))}
          </ul>
        </Block>
        <Block n={2} title={a.kind === "positief" ? "Waarom?" : "Mogelijke oorzaak"}>
          <ul className="space-y-1">{m.causes.slice(0, 2).map((c, i) => <li key={i}><CauseTag c={c} /><span className="text-[var(--color-ink-muted)]">{c.text}</span></li>)}</ul>
          {m.causes.length > 2 ? <p className="mt-0.5 text-2xs text-[var(--color-ink-faint)]">+ {m.causes.length - 2} {m.causes.length - 2 === 1 ? "andere mogelijke oorzaak" : "andere mogelijke oorzaken"}: {m.causes.slice(2).map((c) => causeLabel(c).toLowerCase()).join(", ")}</p> : null}
        </Block>
        <Block n={3} title="Advies">
          <p className="font-semibold">{shortAdvice(a)}</p>
          {m.adviceShort ? <p className="mt-0.5 text-[var(--color-ink-muted)]">{m.advice}</p> : null}
        </Block>
        <Block n={4} title="Wat doet het team?">
          <ul className="space-y-0.5">{m.actions.slice(0, 4).map((t, i) => <li key={i} className="flex gap-2"><span className="text-[var(--color-ink-faint)]">{i + 1}.</span><span>{t}</span></li>)}</ul>
        </Block>
      </div>
      {mem.length ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)]"><Sparkles className="size-3.5" /> Uit het Contentgeheugen</div>
          <dl className="grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
            {mem.map((mi) => (
              <div key={mi.key} className="flex min-w-0 gap-2">
                <dt className="w-[118px] shrink-0 text-[var(--color-ink-faint)]">{MEM_SHORT[mi.key] ?? mi.label}</dt>
                <dd className="min-w-0 truncate" title={mi.items.join(" · ")}>{mi.items.join(" · ")}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {a.effect && a.status === "actie" ? <p className="text-xs"><EffectLine a={a} /></p> : null}
    </div>
  );
}

const MEM_SHORT: Record<string, string> = {
  hooks: "Beste hooks",
  formats: "Beste formats",
  lengte: "Ideale lengte",
  onderwerpen: "Meeste interactie",
  cta: "Beste CTA",
  filmstijl: "Filmstijl",
  verschil: "Nu anders",
};

function ActionPanel({ a, staff, viewerId, onDone }: { a: AlertCard; staff: StaffOption[]; viewerId: string; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const defaultAssignee = a.assigneeId && staff.some((s) => s.id === a.assigneeId) ? a.assigneeId : staff.find((s) => s.id === viewerId)?.id ?? staff[0]?.id ?? "";
  const [assignee, setAssignee] = useState(defaultAssignee);
  const [due, setDue] = useState(addWorkdays(a.level === "rood" ? 2 : 5));

  const submit = () =>
    start(async () => {
      // De volledige analyse gaat mee in de taakomschrijving; op het scherm blijft het kort.
      const description = [
        `Probleem: ${a.analysis.findings.map((f) => f.detail).join(" ")}`,
        `Oorzaak: ${a.analysis.causes.map((c) => `[${c.kind}] ${c.text}`).join(" ")}`,
        `Advies: ${a.analysis.advice}`,
        `Stappen:\n${a.analysis.actions.map((t) => `- ${t}`).join("\n")}`,
        "(Uit Klanten die aandacht nodig hebben op de Resultatenpagina.)",
      ].join("\n\n");
      const r = await createResultAlertTask({ alertId: a.id, assigneeId: assignee, dueOn: due, title: `${a.clientName}: ${shortAdvice(a)}`.slice(0, 240), description });
      setMsg(r.message ?? null);
      if (r.ok) {
        router.refresh();
        onDone();
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[var(--color-surface-2)] px-3 py-2.5 text-[13px]">
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
      <button type="button" onClick={submit} disabled={pending || !assignee} className={`${btn(false, true)} ml-auto`}>{pending ? "Bezig..." : "Taak aanmaken"}</button>
      {msg ? <span className="w-full text-xs font-medium text-[var(--color-bad)]">{msg}</span> : null}
    </div>
  );
}

function ResolvePanel({ a, onDone }: { a: AlertCard; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"opgelost" | "geen_actie">(a.actionText ? "opgelost" : a.kind === "positief" ? "geen_actie" : "opgelost");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const submit = () =>
    start(async () => {
      const r = await resolveResultAlert({ alertId: a.id, mode, note: note || undefined });
      setMsg(r.message ?? null);
      if (r.ok) {
        router.refresh();
        onDone();
      }
    });
  return (
    <div className="space-y-2 border-t border-[var(--color-line)] bg-[var(--color-surface-2)] px-3.5 py-3 text-[13px]">
      <div className="flex flex-wrap gap-1.5">
        {([["opgelost", "Verbeteractie uitgevoerd"], ["geen_actie", "Bewust afgehandeld, geen actie"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setMode(v)} className={`rounded-full px-3 py-1 text-xs font-semibold ${mode === v ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)]"}`}>{l}</button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder={mode === "opgelost" ? (a.actionText ? `Actie: ${a.actionText}. Optioneel: wat hebben we precies veranderd?` : "Welke actie hebben we uitgevoerd? Bijvoorbeeld: drie nieuwe vraag-hooks getest in de sessie van 20 nov.") : "Waarom is geen actie nodig? (optioneel)"}
        className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[13px]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={submit} disabled={pending} className={btn(false, true)}>{pending ? "Bezig..." : "Afhandelen"}</button>
        {mode === "opgelost" && a.kind === "negatief" ? <span className="text-xs text-[var(--color-ink-muted)]">Het systeem meet daarna automatisch of de nieuwe video&apos;s beter presteren.</span> : null}
        {msg ? <span className="text-xs font-medium text-[var(--color-bad)]">{msg}</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Afgehandeld + effectmeting
 * ------------------------------------------------------------------ */

function EffectLine({ a }: { a: AlertCard }) {
  const e = a.effect;
  if (!e) return <span className="text-[var(--color-ink-faint)]">Effect wordt gemeten zodra er nieuwe video&apos;s online staan.</span>;
  if (e.status === "wachten") return <span className="text-[var(--color-ink-muted)]">Effect wordt gemeten: {e.videosAfter} van {e.needed} nieuwe video&apos;s gemeten.</span>;
  const color = e.verdict === "verbeterd" ? "var(--color-good)" : e.verdict === "verslechterd" ? "var(--color-bad)" : "var(--color-ink-muted)";
  return (
    <span>
      <span className="font-semibold" style={{ color }}>{EFFECT_LABEL[e.verdict!]}</span>
      {e.changePct != null ? <span className="text-[var(--color-ink-muted)]"> · weergaven t.o.v. normaal {e.changePct > 0 ? "+" : ""}{e.changePct}% ({(e.before ?? 0).toFixed(1).replace(".", ",")}x naar {(e.after ?? 0).toFixed(1).replace(".", ",")}x)</span> : null}
      {e.retentionBefore != null && e.retentionAfter != null ? <span className="text-[var(--color-ink-muted)]"> · retentie {Math.round(e.retentionBefore * 100)}% naar {Math.round(e.retentionAfter * 100)}%</span> : null}
      <span className="text-[var(--color-ink-faint)]"> · {e.videosAfter} video&apos;s na de actie</span>
    </span>
  );
}

function ClosedList({ closed }: { closed: AlertCard[] }) {
  return (
    <details className="group mt-3 rounded-[var(--radius-md)] border border-[var(--color-line)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-[var(--color-ink-muted)] [&::-webkit-details-marker]:hidden">
        <span>Afgehandeld en effect van onze verbeteracties ({closed.length})</span>
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
        {closed.map((a) => (
          <li key={a.id} className="grid gap-x-4 gap-y-1 px-3 py-2.5 text-[12.5px] leading-snug md:grid-cols-[180px_1fr]">
            <div className="flex items-center gap-2">
              <ClientLogo name={a.clientName} logoUrl={a.logoUrl} color={a.color} size={24} />
              <span className="min-w-0">
                <Link href={`/analytics/${a.clientSlug}`} className="block truncate font-semibold hover:underline">{a.clientName}</Link>
                <span className="text-2xs text-[var(--color-ink-faint)]">{fmtDate(a.resolvedAt)}{a.resolvedByName ? ` · ${a.resolvedByName.split(" ")[0]}` : ""}</span>
              </span>
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              <div><span className="text-[var(--color-ink-faint)]">Probleem: </span>{a.headline}</div>
              <div><span className="text-[var(--color-ink-faint)]">Actie: </span>{a.status === "afgehandeld" ? `Geen actie nodig${a.resolutionNote ? ` (${a.resolutionNote})` : ""}` : a.actionText ?? a.resolutionNote ?? "Verbeteractie uitgevoerd"}</div>
              {a.status === "opgelost" && a.kind === "negatief" ? (
                <>
                  <div className="sm:col-span-2"><span className="text-[var(--color-ink-faint)]">Resultaat: </span><EffectLine a={a} /></div>
                  {a.effect?.videos.length ? (
                    <div className="sm:col-span-2 truncate text-[var(--color-ink-muted)]" title={a.effect.videos.map((v) => v.title).join(" · ")}>
                      <span className="text-[var(--color-ink-faint)]">Nieuwe video&apos;s: </span>
                      {a.effect.videos.slice(0, 4).map((v) => `${v.title} (${v.perf.toFixed(1).replace(".", ",")}x)`).join(" · ")}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-[var(--color-line)] px-3 py-2 text-2xs text-[var(--color-ink-faint)]">
        Het effect vergelijkt alle video&apos;s die na de actie online kwamen op dezelfde platforms met het niveau tijdens het probleem. Het systeem kan niet zien welke video specifiek voor de actie is gemaakt. De uitkomst staat ook in het Contentgeheugen en gaat mee in de Script Engine.
      </p>
    </details>
  );
}
