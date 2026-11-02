"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, CircleAlert, Clapperboard, MessagesSquare, PenLine, Plus, Scissors, Search, TrendingDown, X } from "lucide-react";
import { ClientLogo, TeamAvatar } from "@/components/ui";
import type { AttentionItem, TeamMember } from "@/server/attention";
import type { AttentionArea, AttentionPriority } from "@/server/quality";
import { addAttentionNote, assignAttention, createAttentionItem, setAttentionStatus } from "@/server/actions/attention";

type Scope = "mine" | "all";
type View = "actief" | "hoog" | "bezig" | "klaar";

const AREAS: { key: AttentionArea; label: string; icon: typeof Scissors }[] = [
  { key: "editing", label: "Editing", icon: Scissors },
  { key: "klant", label: "Klantcontact", icon: MessagesSquare },
  { key: "opname", label: "Opnames", icon: Clapperboard },
  { key: "script", label: "Scripting", icon: PenLine },
  { key: "resultaat", label: "Resultaten", icon: TrendingDown },
  { key: "overig", label: "Overig", icon: CircleAlert },
];
const AREA_ICON = Object.fromEntries(AREAS.map((a) => [a.key, a.icon])) as Record<AttentionArea, typeof Scissors>;
const GROUPS: { p: AttentionPriority; label: string; color: string }[] = [
  { p: "hoog", label: "Vandaag", color: "var(--color-bad)" },
  { p: "normaal", label: "Deze week", color: "var(--color-warn)" },
  { p: "laag", label: "Later", color: "var(--color-ink-faint)" },
];
const P_RANK: Record<AttentionPriority, number> = { hoog: 0, normaal: 1, laag: 2 };

const daysOpen = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));
const ageLabel = (n: number) => (n === 0 ? "vandaag" : n === 1 ? "1 dag" : `${n} dagen`);

export function AttentionBoard({ items: initial, team, viewerId, defaultScope }: {
  items: AttentionItem[]; team: TeamMember[]; viewerId: string; defaultScope: Scope;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [items, setItems] = useState(initial);
  // Nieuwe serverdata (na router.refresh) vervangt de lokale, optimistische lijst.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) { setPrevInitial(initial); setItems(initial); }

  const [scope, setScope] = useState<Scope>(defaultScope);
  const [view, setView] = useState<View>("actief");
  const [area, setArea] = useState<AttentionArea | "">("");
  const [q, setQ] = useState("");
  const [showLater, setShowLater] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const member = (id: string | null) => team.find((t) => t.id === id) ?? null;
  const showToast = (text: string, undo?: () => void) => {
    setToast({ text, undo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };
  const patch = (key: string, p: Partial<AttentionItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) showToast(r.message ?? "Er ging iets mis.");
      router.refresh();
    });

  const label = (i: AttentionItem) => (i.clientName ? `${i.clientName} · ${i.action}` : i.action);

  function setStatus(i: AttentionItem, status: AttentionItem["status"]) {
    const prev = { status: i.status, ownerId: i.ownerId, doneAt: i.doneAt };
    patch(i.key, { status, doneAt: status === "klaar" ? new Date().toISOString() : null, ...(status === "bezig" ? { ownerId: viewerId } : {}) });
    run(() => setAttentionStatus({ key: i.key, status }));
    const msg = status === "klaar" ? `Afgerond: ${label(i)}` : status === "bezig" ? "Jij pakt dit op" : "Heropend";
    showToast(msg, () => {
      patch(i.key, prev);
      run(async () => {
        const r = await setAttentionStatus({ key: i.key, status: prev.status });
        if (r.ok && status === "bezig" && prev.ownerId && prev.ownerId !== viewerId) await assignAttention({ key: i.key, userId: prev.ownerId, title: label(i) });
        return r;
      });
    });
    if (status === "klaar" && openKey === i.key) setOpenKey(null);
  }
  function assign(i: AttentionItem, userId: string) {
    if (userId === i.ownerId) return;
    const prev = i.ownerId;
    patch(i.key, { ownerId: userId });
    run(() => assignAttention({ key: i.key, userId, title: label(i), href: i.href }));
    showToast(`Toegewezen aan ${member(userId)?.name ?? "teamlid"}`, prev ? () => { patch(i.key, { ownerId: prev }); run(() => assignAttention({ key: i.key, userId: prev, title: label(i) })); } : undefined);
  }

  /* ---------- afgeleide lijsten ---------- */
  const scoped = useMemo(() => items.filter((i) => scope === "all" || i.ownerId === viewerId), [items, scope, viewerId]);
  const active = scoped.filter((i) => i.status !== "klaar");
  const done = scoped.filter((i) => i.status === "klaar");
  const base = view === "klaar" ? done : view === "hoog" ? active.filter((i) => i.priority === "hoog") : view === "bezig" ? active.filter((i) => i.status === "bezig") : active;
  const term = q.trim().toLowerCase();
  const list = base
    .filter((i) => !area || i.area === area)
    .filter((i) => !term || `${i.clientName ?? ""} ${i.action} ${i.reason} ${member(i.ownerId)?.name ?? ""}`.toLowerCase().includes(term))
    .sort((a, b) => P_RANK[a.priority] - P_RANK[b.priority] || daysOpen(b.since) - daysOpen(a.since));

  const hi = active.filter((i) => i.priority === "hoog");
  const bz = active.filter((i) => i.status === "bezig");
  const old = active.filter((i) => daysOpen(i.since) > 5).length;
  const kpis: { v: View; n: number; label: string; sub: string; tone?: string }[] = [
    { v: "actief", n: active.length, label: "Open", sub: old ? `${old} langer dan 5 dagen` : "niets loopt achter" },
    { v: "hoog", n: hi.length, label: "Hoge prioriteit", sub: hi.length ? `${hi.filter((i) => i.status === "open").length} nog niet opgepakt` : "niets urgents", tone: hi.length ? "var(--color-bad)" : undefined },
    { v: "bezig", n: bz.length, label: "In behandeling", sub: scope === "mine" ? "door jou" : ((n) => (n === 0 ? "nog niemand" : n === 1 ? "door 1 persoon" : `door ${n} personen`))(new Set(bz.map((i) => i.ownerId)).size) },
    { v: "klaar", n: done.length, label: "Afgerond", sub: "afgelopen 7 dagen", tone: done.length ? "var(--color-good)" : undefined },
  ];
  const opened = items.find((i) => i.key === openKey) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpenKey(null); setAssignFor(null); setNewOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div>
      {/* Kop */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Aandachtspunten</h1>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="flex flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5 sm:flex-none">
            {(["mine", "all"] as Scope[]).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s}
                className={`flex-1 whitespace-nowrap rounded-[calc(var(--radius-sm)-2px)] px-3.5 py-1.5 text-sm font-medium transition sm:flex-none ${scope === s ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
                {s === "mine" ? "Mijn punten" : "Hele team"}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setNewOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-violet)] px-3.5 text-sm font-medium text-white hover:brightness-95">
            <Plus className="size-4" /> <span className="hidden sm:inline">Nieuw punt</span>
          </button>
        </div>
      </div>

      {/* Overzicht */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {kpis.map((k) => (
          <button key={k.v} type="button" onClick={() => setView(view === k.v && k.v !== "actief" ? "actief" : k.v)} aria-pressed={view === k.v}
            className={`rounded-[var(--radius-md)] border bg-[var(--color-surface)] px-4 py-3 text-left transition hover:border-[var(--color-line-strong)] ${view === k.v ? "border-[var(--color-violet)] ring-1 ring-[var(--color-violet)]" : "border-[var(--color-line)]"}`}>
            <span className="block text-2xl font-semibold tabular-nums leading-tight" style={k.tone ? { color: k.tone } : undefined}>{k.n}</span>
            <span className="block text-sm text-[var(--color-ink-muted)]">{k.label}</span>
            <span className="hidden text-xs text-[var(--color-ink-faint)] sm:block">{k.sub}</span>
          </button>
        ))}
      </div>

      {/* Categorieën + zoeken */}
      <div className="-mr-4 mb-5 flex items-center gap-1.5 overflow-x-auto pb-1 pr-4 sm:mr-0 sm:flex-wrap sm:pr-0">
        <Chip on={!area} onClick={() => setArea("")} label="Alles" n={base.length} />
        {AREAS.map((a) => {
          const n = base.filter((i) => i.area === a.key).length;
          return n ? <Chip key={a.key} on={area === a.key} onClick={() => setArea(area === a.key ? "" : a.key)} label={a.label} n={n} /> : null;
        })}
        <label className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3">
          <Search className="size-3.5 text-[var(--color-ink-faint)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek klant of punt" className="w-32 bg-transparent py-1.5 text-xs text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]" />
        </label>
      </div>

      {/* Lijst */}
      {list.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-12 text-center">
          <p className="font-semibold text-[var(--color-ink)]">{view === "klaar" ? "Nog niets afgerond deze week" : area || term ? "Geen punten met dit filter" : scope === "mine" ? "Je hebt geen openstaande punten" : "Niets open"}</p>
          {scope === "mine" && view !== "klaar" && !area && !term ? <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Kijk bij Hele team of iemand hulp kan gebruiken.</p> : null}
        </div>
      ) : view === "klaar" ? (
        <div className="space-y-1.5">{list.map((i) => row(i))}</div>
      ) : (
        <div className="space-y-6">
          {GROUPS.map((g) => {
            const rows = list.filter((i) => i.priority === g.p);
            if (!rows.length) return null;
            const folded = g.p === "laag" && !showLater && !term && !area;
            return (
              <section key={g.p}>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-muted)]">
                  <span className="size-2 rounded-full" style={{ background: g.color }} />
                  {g.label} <span className="font-normal text-[var(--color-ink-faint)]">{rows.length}</span>
                  {g.p === "laag" ? (
                    <button type="button" onClick={() => setShowLater(!showLater)} className="ml-auto text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">{folded ? "Tonen" : "Verbergen"}</button>
                  ) : null}
                </div>
                {folded ? null : <div className="space-y-1.5">{rows.map((i) => row(i))}</div>}
              </section>
            );
          })}
        </div>
      )}

      {/* Detailpaneel */}
      <div onClick={() => setOpenKey(null)} className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${opened ? "opacity-100" : "pointer-events-none opacity-0"}`} />
      <aside className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-2xl border-t border-[var(--color-line-strong)] bg-[var(--color-surface)] p-5 shadow-2xl transition-transform duration-200 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-[420px] sm:rounded-none sm:border-l sm:border-t-0 ${opened ? "translate-x-0 translate-y-0" : "translate-y-full sm:translate-x-full sm:translate-y-0"}`}>
        {opened ? detail(opened) : null}
      </aside>

      {/* Toewijzen */}
      {assignFor ? (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setAssignFor(null)} />
          <div className="fixed z-[60] min-w-[200px] rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-1.5 shadow-xl"
            style={{ top: Math.min(assignFor.rect.bottom + 6, window.innerHeight - 220), left: Math.max(8, Math.min(assignFor.rect.right - 210, window.innerWidth - 218)) }}>
            <p className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Toewijzen aan</p>
            {team.map((t) => {
              const it = items.find((x) => x.key === assignFor.key);
              return (
                <button key={t.id} type="button" onClick={() => { if (it) assign(it, t.id); setAssignFor(null); }}
                  className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface-sunken)] ${it?.ownerId === t.id ? "bg-[var(--color-surface-sunken)]" : ""}`}>
                  <TeamAvatar name={t.name} size={26} /> <span className="flex-1">{t.name}</span>
                  <span className="text-xs text-[var(--color-ink-faint)]">{t.role}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {newOpen ? <NewItem team={team} viewerId={viewerId} onClose={() => setNewOpen(false)} onSaved={(who) => { setNewOpen(false); showToast(who === viewerId ? "Punt toegevoegd" : `Punt toegevoegd voor ${member(who)?.name ?? "teamlid"}`); router.refresh(); }} /> : null}

      {/* Melding met ongedaan maken */}
      <div className={`fixed bottom-5 left-1/2 z-[70] flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-indigo-ink)] py-2 pl-4 pr-2 text-sm text-white shadow-xl transition ${toast ? "opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}>
        <span className="truncate">{toast?.text}</span>
        {toast?.undo ? <button type="button" onClick={() => { toast.undo?.(); setToast(null); }} className="shrink-0 rounded px-2 py-1 font-semibold text-[#c9bcff] hover:bg-white/10">Ongedaan maken</button> : null}
      </div>
    </div>
  );

  /* ---------- onderdelen ---------- */

  function row(i: AttentionItem) {
    const n = daysOpen(i.since);
    const doneRow = i.status === "klaar";
    const Icon = AREA_ICON[i.area];
    const owner = member(i.ownerId);
    return (
      <div key={i.key} onClick={() => setOpenKey(i.key)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setOpenKey(i.key); }}
        className="group flex min-h-[62px] cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 transition hover:border-[var(--color-line-strong)] sm:gap-3.5 sm:pl-3.5">
        <button type="button" title={doneRow ? "Heropenen" : "Afronden"} onClick={(e) => { e.stopPropagation(); setStatus(i, doneRow ? "open" : "klaar"); }}
          className={`grid size-[22px] shrink-0 place-items-center rounded-full border-2 transition ${doneRow ? "border-[var(--color-good)] bg-[var(--color-good)]" : "border-[var(--color-line-strong)] hover:border-[var(--color-good)] hover:bg-[var(--color-good-soft)]"}`}>
          <Check className={`size-3 text-white ${doneRow ? "" : "opacity-0 group-hover:opacity-0"}`} strokeWidth={3.5} />
        </button>
        <span className="hidden sm:block">
          {i.clientName ? <ClientLogo name={i.clientName} logoUrl={i.clientLogoUrl} color={i.clientColor} size={30} />
            : <span className="grid size-[30px] place-items-center rounded-lg bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]"><Icon className="size-4" /></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-sm font-medium sm:truncate ${doneRow ? "text-[var(--color-ink-muted)] line-through" : "text-[var(--color-ink)]"}`}>
            {i.clientName ? <span className="block font-normal text-[var(--color-ink-muted)] sm:inline">{i.clientName}<span className="hidden sm:inline"> · </span></span> : null}
            {i.action}{i.kids.length ? <span className="ml-1.5 rounded bg-[var(--color-neutral-soft)] px-1.5 py-px text-2xs font-semibold text-[var(--color-ink-muted)]">{i.kids.length}</span> : null}
          </span>
          <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)] sm:truncate">{i.reason}</span>
        </span>
        {i.status === "open" ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); setStatus(i, "bezig"); }}
            className="hidden shrink-0 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)] opacity-0 transition group-hover:opacity-100 sm:block">Oppakken</button>
        ) : null}
        {i.status === "bezig" ? <span className="shrink-0 rounded-full bg-[var(--color-violet-soft)] px-2 py-0.5 text-2xs font-semibold text-[var(--color-violet)]">Bezig</span> : null}
        {/* Hoe lang het punt al openstaat; pas vanaf 1 dag, zodat nieuwe punten rustig blijven. */}
        <span className={`hidden w-[56px] shrink-0 text-right text-xs sm:block ${n > 5 ? "font-medium text-[var(--color-warn)]" : "text-[var(--color-ink-faint)]"}`}>{!doneRow && n > 0 ? ageLabel(n) : ""}</span>
        <button type="button" title={owner ? `${owner.name} · toewijzen` : "Toewijzen"} onClick={(e) => { e.stopPropagation(); setAssignFor({ key: i.key, rect: e.currentTarget.getBoundingClientRect() }); }}
          className="shrink-0 rounded-full hover:ring-2 hover:ring-[var(--color-line-strong)]">
          {owner ? <TeamAvatar name={owner.name} size={28} /> : <span className="grid size-7 place-items-center rounded-full border border-dashed border-[var(--color-line-strong)] text-xs text-[var(--color-ink-faint)]">?</span>}
        </button>
      </div>
    );
  }

  function detail(i: AttentionItem) {
    const owner = member(i.ownerId);
    const g = GROUPS.find((x) => x.p === i.priority)!;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
          <span className="size-2 rounded-full" style={{ background: g.color }} /> {g.label}
          {i.clientName ? <> · {i.clientName}</> : null}
          {i.status === "bezig" ? <> · <span className="font-medium text-[var(--color-violet)]">Bezig</span></> : null}
          <button type="button" onClick={() => setOpenKey(null)} className="ml-auto grid size-8 place-items-center rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-sunken)]" aria-label="Sluiten"><X className="size-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <h2 className="mb-2 mt-2 text-lg font-semibold leading-snug text-[var(--color-ink)]">{i.action}</h2>
          <p className="mb-4 text-sm leading-relaxed text-[var(--color-ink-muted)]">{i.why.replace(/ → .*$/, "")}</p>
          {i.kids.length ? (
            <ul className="mb-4 divide-y divide-[var(--color-line)] rounded-[var(--radius-md)] border border-[var(--color-line)] text-sm">
              {i.kids.map((k) => (
                <li key={k.label} className="flex justify-between gap-3 px-3 py-2">
                  {k.href ? <Link href={k.href} className="truncate hover:underline">{k.label}</Link> : <span className="truncate">{k.label}</span>}
                  <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{k.sub}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-center gap-3 border-y border-[var(--color-line)] py-3">
            {owner ? <TeamAvatar name={owner.name} size={36} /> : null}
            <div className="flex-1 text-sm">{owner?.name ?? "Niet toegewezen"}<span className="block text-xs text-[var(--color-ink-muted)]">{owner?.role}</span></div>
            <button type="button" onClick={(e) => setAssignFor({ key: i.key, rect: e.currentTarget.getBoundingClientRect() })} className="text-sm font-medium text-[var(--color-violet)]">Wijzigen</button>
          </div>
          <p className="mb-2 mt-4 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Notities</p>
          <NoteBox onSave={(text) => { patch(i.key, { notes: [...i.notes, { at: new Date().toISOString(), userId: viewerId, name: member(viewerId)?.name ?? "Ik", text }] }); run(() => addAttentionNote({ key: i.key, text })); }} />
          {i.notes.length ? (
            <ul className="mt-2 space-y-1.5 text-xs">
              {[...i.notes].reverse().map((n) => (
                <li key={n.at} className="flex gap-2.5 text-[var(--color-ink)]">
                  <span className="w-12 shrink-0 text-[var(--color-ink-faint)]">{new Date(n.at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}</span>
                  <span><span className="font-medium">{n.name}:</span> {n.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="space-y-2 pt-4">
          {i.status === "klaar" ? (
            <button type="button" onClick={() => setStatus(i, "open")} className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-line-strong)] text-sm font-medium">Heropenen</button>
          ) : (
            <>
              {i.href ? <Link href={i.href} className="flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-violet)] text-sm font-medium text-white hover:brightness-95">Openen <ArrowRight className="size-4" /></Link> : null}
              {i.status === "open" ? <button type="button" onClick={() => setStatus(i, "bezig")} className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-line-strong)] text-sm font-medium">Ik pak dit op</button> : null}
              <button type="button" onClick={() => setStatus(i, "klaar")} className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--color-good)] bg-[var(--color-good-soft)] text-sm font-medium text-[var(--color-good)]">Afronden</button>
            </>
          )}
        </div>
      </div>
    );
  }
}

function Chip({ on, onClick, label, n }: { on: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"}`}>
      {label}<span className="ml-1 opacity-60">{n}</span>
    </button>
  );
}

function NoteBox({ onSave }: { onSave: (text: string) => void }) {
  const [v, setV] = useState("");
  return (
    <textarea value={v} onChange={(e) => setV(e.target.value)} rows={2}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (v.trim()) { onSave(v.trim()); setV(""); } } }}
      placeholder="Notitie typen en Enter. Bijv. klant gebeld, belt donderdag terug"
      className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--color-line-strong)]" />
  );
}

function NewItem({ team, viewerId, onClose, onSaved }: { team: TeamMember[]; viewerId: string; onClose: () => void; onSaved: (who: string) => void }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const field = "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm outline-none";
  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/40" onClick={onClose} />
      <form className="fixed left-1/2 top-1/2 z-[60] w-[420px] max-w-[calc(100%-24px)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-5 shadow-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const who = String(f.get("o"));
          start(async () => {
            const r = await createAttentionItem({
              client: String(f.get("k")), title: String(f.get("t")), area: String(f.get("c")) as AttentionArea,
              priority: String(f.get("p")) as AttentionPriority, assigneeId: who,
            });
            if (r.ok) onSaved(who); else setErr(r.message ?? "Opslaan mislukt.");
          });
        }}>
        <h3 className="mb-4 text-base font-semibold">Nieuw aandachtspunt</h3>
        <div className="space-y-3 text-xs text-[var(--color-ink-muted)]">
          <label className="block space-y-1">Klant of afdeling<input name="k" required autoFocus placeholder="Bijv. NAHV" className={field} /></label>
          <label className="block space-y-1">Wat moet er gebeuren?<input name="t" required maxLength={160} placeholder="Bijv. nieuwe opnamedatum afstemmen" className={field} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">Wie<select name="o" defaultValue={viewerId} className={field}>{team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label className="block space-y-1">Wanneer<select name="p" defaultValue="normaal" className={field}><option value="hoog">Vandaag</option><option value="normaal">Deze week</option><option value="laag">Later</option></select></label>
          </div>
          <label className="block space-y-1">Categorie<select name="c" defaultValue="klant" className={field}>{AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
        </div>
        {err ? <p className="mt-3 text-sm text-[var(--color-bad)]">{err}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-4 text-sm">Annuleren</button>
          <button disabled={pending} className="h-9 rounded-[var(--radius-sm)] bg-[var(--color-violet)] px-4 text-sm font-medium text-white disabled:opacity-60">Toevoegen</button>
        </div>
      </form>
    </>
  );
}
