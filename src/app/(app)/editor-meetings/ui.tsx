"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, ListChecks, Loader2, MessageSquarePlus, Pencil, Plus, RotateCcw, Target, Trash2, Wand2, X } from "lucide-react";
import {
  addEditorMeetingItem,
  deleteEditorMeetingItem,
  updateEditorMeetingItem,
  cancelEditorMeeting,
  planEditorMeeting,
  saveEditorMeetingReport,
  saveEditorMeetingTopics,
  setEditorMeetingAction,
  setEditorMeetingOwner,
  setEditorMeetingPoint,
} from "@/server/actions/editor-meetings";
import { Badge, Button, ErrorNote, TeamAvatar } from "@/components/ui";
import {
  EDITOR_THEMES,
  ITEM_OUTCOME_LABEL,
  MAX_ITEM_LENGTH,
  OWNER_TYPE_LABEL,
  SHORTCLIPS_THEMES,
  STATUS_LABEL,
  STATUS_TONE,
  type DisplayStatus,
  type ItemOutcome,
  type OwnerType,
  type PointKind,
} from "@/lib/editor-meetings";

/* ------------------------------ plannen ------------------------------ */

export type PlanDefaults = {
  meetingId?: string | null;
  editorId: string;
  date: string;
  time: string;
  location: string;
  meetingUrl: string;
  topics: string[];
};

const linesOf = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

export function PlanForm({ defaults, editorName, onDone, submitLabel = "Inplannen", withTopics = true }: { defaults: PlanDefaults; editorName: string; onDone?: () => void; submitLabel?: string; withTopics?: boolean }) {
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [location, setLocation] = useState(defaults.location);
  const [meetingUrl, setMeetingUrl] = useState(defaults.meetingUrl);
  const [topics, setTopics] = useState(defaults.topics.join("\n"));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setErr(null);
    start(async () => {
      const res = await planEditorMeeting({
        meetingId: defaults.meetingId ?? null,
        editorId: defaults.editorId,
        date,
        time,
        location: location || null,
        meetingUrl: meetingUrl || null,
        ...(withTopics ? { topics: linesOf(topics) } : {}),
      });
      if (!res.ok) return setErr(res.message ?? "Plannen is niet gelukt.");
      router.refresh();
      onDone?.();
    });
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="sc-label">Datum</label>
          <input type="date" className="sc-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="sc-label">Tijd</label>
          <input type="time" className="sc-input" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div>
          <label className="sc-label">Locatie (optioneel)</label>
          <input className="sc-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Online of kantoor Sneek" />
        </div>
        <div>
          <label className="sc-label">Vergaderlink (optioneel)</label>
          <input className="sc-input" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://meet.google.com/..." />
        </div>
      </div>
      {withTopics ? (
        <div className="mt-3">
          <label className="sc-label">Onderwerpen voor de meeting (één per regel, zichtbaar voor {editorName})</label>
          <textarea className="sc-input resize-y" rows={3} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="Terugblik afgelopen maand" />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={submit} disabled={pending || !date || !time}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <CalendarPlus className="size-4" />} {submitLabel}
        </Button>
        {onDone ? (
          <Button size="sm" variant="ghost" onClick={onDone}>Annuleren</Button>
        ) : null}
        {err ? <ErrorNote>{err}</ErrorNote> : null}
      </div>
    </div>
  );
}

/* ------------------------------ overzicht ------------------------------ */

export type OverviewRowData = {
  editorId: string;
  editorName: string;
  editorAvatar: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerSource: "vast" | "voorstel" | null;
  canManage: boolean;
  meetingId: string | null;
  scheduledLabel: string | null;
  status: DisplayStatus;
  overdue: boolean;
  reportPublished: boolean;
  lastLabel: string | null;
  lastId: string | null;
  nextLabel: string | null;
  nextId: string | null;
  openActions: number;
  openItems: number;
  defaults: PlanDefaults;
};

type OwnerOption = { id: string; fullName: string };

function OwnerPicker({ row, owners, canSet }: { row: OverviewRowData; owners: OwnerOption[]; canSet: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  if (!canSet) {
    return <span className="text-sm text-[var(--color-ink)]">{row.ownerName ? row.ownerName.split(" ")[0] : "Nog niemand"}</span>;
  }
  const save = (ownerId: string) => {
    setErr(null);
    start(async () => {
      const res = await setEditorMeetingOwner(row.editorId, ownerId);
      if (!res.ok) setErr(res.message ?? "Opslaan is niet gelukt.");
      router.refresh();
    });
  };
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <select
          className="sc-input h-8 w-32 py-0 text-xs"
          value={row.ownerId ?? ""}
          disabled={pending}
          aria-label={`Verantwoordelijke voor ${row.editorName}`}
          onChange={(e) => {
            if (e.target.value) save(e.target.value);
          }}
        >
          <option value="">Kies…</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.fullName.split(" ")[0]}</option>
          ))}
        </select>
        {row.ownerSource === "voorstel" && row.ownerId ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => save(row.ownerId!)}
            title="Voorstel op basis van de klanten waar deze editor voor werkt. Klik om vast te leggen."
            className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warn-soft)] px-2.5 py-1 text-xs font-medium text-[#8a5300] hover:brightness-95"
          >
            {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Voorstel bevestigen
          </button>
        ) : null}
      </span>
      {err ? <span className="text-2xs text-[var(--color-bad)]">{err}</span> : null}
    </span>
  );
}

export function OverviewTable({ rows, owners, viewerId, isManagement, defaultOwner, initialEditor = "", monthName }: { rows: OverviewRowData[]; owners: OwnerOption[]; viewerId: string; isManagement: boolean; defaultOwner: string; initialEditor?: string; monthName: string }) {
  // Doorgeklikt vanaf een editor op Editing: toon die editor, ongeacht de verantwoordelijke.
  const [owner, setOwner] = useState(initialEditor ? "" : defaultOwner);
  const [editor, setEditor] = useState(initialEditor);
  const [status, setStatus] = useState("");
  const [planning, setPlanning] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      rows.filter((r) => {
        // Editors zonder verantwoordelijke staan bij iedereen in beeld, zodat iemand ze oppakt.
        if (owner === "geen" ? r.ownerId !== null : owner && r.ownerId !== owner && r.ownerId !== null) return false;
        if (editor && r.editorId !== editor) return false;
        if (status === "over_tijd" ? !r.overdue : status && r.status !== status) return false;
        return true;
      }),
    [rows, owner, editor, status],
  );
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows]);
  const unassigned = rows.some((r) => r.ownerId === null);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 border-b border-[var(--color-line)] p-4">
        <div>
          <label className="sc-label">Verantwoordelijke</label>
          <div className="flex flex-wrap gap-1.5">
            {[{ id: "", fullName: "Iedereen" }, ...owners, ...(unassigned ? [{ id: "geen", fullName: "Nog niemand" }] : [])].map((o) => (
              <button
                key={o.id || "alle"}
                type="button"
                onClick={() => setOwner(o.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${owner === o.id ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
              >
                {o.fullName.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="sc-label">Editor</label>
          <select className="sc-input h-8 w-40 py-0 text-xs" value={editor} onChange={(e) => setEditor(e.target.value)}>
            <option value="">Alle editors</option>
            {rows.map((r) => (
              <option key={r.editorId} value={r.editorId}>{r.editorName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="sc-label">Status</label>
          <select className="sc-input h-8 w-44 py-0 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle statussen</option>
            <option value="over_tijd">Over tijd</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-[var(--color-ink-muted)]">
          {owner && owner !== "geen" && !editor && !status ? "Er staan nog geen editors op deze naam. Kies Iedereen om alle editors te zien." : "Geen editors met deze filters."}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {shown.map((r) => {
            const canSetOwner = isManagement || (r.ownerSource !== "vast" && owners.some((o) => o.id === viewerId));
            const open = planning === r.editorId;
            const needsPlan = r.status === "te_plannen" || r.status === "opnieuw_plannen";
            return (
              <li key={r.editorId} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <div className="flex w-44 min-w-0 items-center gap-2.5">
                    <TeamAvatar name={r.editorName} avatarUrl={r.editorAvatar} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[var(--color-ink)]">{r.editorName}</span>
                      {r.openItems > 0 ? (
                        <span className="block text-2xs font-medium text-[var(--color-info)]">{r.openItems} {r.openItems === 1 ? "eigen bespreekpunt" : "eigen bespreekpunten"}</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="w-72">
                    <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Verantwoordelijke</div>
                    <OwnerPicker row={r} owners={owners} canSet={canSetOwner} />
                  </div>
                  <div className="w-36">
                    <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Laatste meeting</div>
                    {r.lastLabel && r.lastId && r.canManage ? (
                      <Link href={`/editor-meetings/${r.lastId}`} className="text-sm text-[var(--color-ink)] hover:underline">{r.lastLabel}</Link>
                    ) : (
                      <span className="text-sm text-[var(--color-ink-muted)]">{r.lastLabel ?? "Nog geen"}</span>
                    )}
                  </div>
                  <div className="min-w-48 flex-1">
                    <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Meeting {monthName}</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      {r.overdue ? <Badge tone="bad">Over tijd</Badge> : null}
                      {r.scheduledLabel ? <span className="text-sm text-[var(--color-ink)]">{r.scheduledLabel}</span> : null}
                    </div>
                  </div>
                  <div className="w-28">
                    <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Actiepunten</div>
                    <span className="text-sm text-[var(--color-ink)]">{r.openActions > 0 ? `${r.openActions} open` : "Geen open"}</span>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {r.canManage && needsPlan ? (
                      <Button size="sm" variant={open ? "secondary" : "primary"} onClick={() => setPlanning(open ? null : r.editorId)}>
                        <CalendarPlus className="size-4" /> {open ? "Sluiten" : "Plannen"}
                      </Button>
                    ) : null}
                    {r.canManage && r.meetingId && !needsPlan ? (
                      <Link href={`/editor-meetings/${r.meetingId}`} className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">
                        Openen
                      </Link>
                    ) : null}
                    {!r.canManage && r.ownerId === null ? <span className="text-xs text-[var(--color-ink-faint)]">Kies eerst een verantwoordelijke</span> : null}
                  </div>
                </div>
                {open ? (
                  <div className="mt-3">
                    <PlanForm defaults={r.defaults} editorName={r.editorName.split(" ")[0] ?? r.editorName} onDone={() => setPlanning(null)} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------- afvinken en afronden ------------------------- */

export function ActionToggle({ id, done, disabled }: { id: string; done: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending || disabled}
      aria-label={done ? "Weer openzetten" : "Afronden"}
      title={disabled ? undefined : done ? "Weer openzetten" : "Afronden"}
      onClick={() => start(async () => { await setEditorMeetingAction(id, !done); router.refresh(); })}
      className={`flex size-5 shrink-0 items-center justify-center rounded-[5px] border ${done ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-transparent hover:border-[var(--color-good)]"} ${disabled ? "cursor-default opacity-70" : ""}`}
    >
      {pending ? <Loader2 className="size-3 animate-spin text-[var(--color-ink-faint)]" /> : <Check className="size-3.5" />}
    </button>
  );
}

export function PointToggle({ id, achieved }: { id: string; achieved: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await setEditorMeetingPoint(id, achieved ? "open" : "behaald"); router.refresh(); })}
      className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : achieved ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
      {achieved ? "Weer open" : "Behaald"}
    </button>
  );
}

/* --------------------- meeting verplaatsen en annuleren --------------------- */

export function MeetingControls({ defaults, editorName, planned, locked }: { defaults: PlanDefaults; editorName: string; planned: boolean; locked: boolean }) {
  const [open, setOpen] = useState(!planned && !locked);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (locked) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
          <CalendarPlus className="size-4" /> {planned ? "Verplaatsen" : "Opnieuw plannen"}
        </Button>
        {planned ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!confirm(`De meeting met ${editorName} annuleren? ${editorName} krijgt hiervan bericht.`)) return;
              start(async () => { await cancelEditorMeeting(defaults.meetingId!); router.refresh(); });
            }}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Annuleren
          </Button>
        ) : null}
      </div>
      {open ? <PlanForm defaults={defaults} editorName={editorName} submitLabel={planned ? "Verplaatsen" : "Inplannen"} withTopics={false} onDone={() => setOpen(false)} /> : null}
    </div>
  );
}

/* ------------------------------ bespreekpunten ------------------------------ */

export function TopicsEditor({ meetingId, topics, draft, editorName }: { meetingId: string; topics: string[]; draft: string[]; editorName: string }) {
  const [text, setText] = useState(topics.join("\n"));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = text.trim() !== topics.join("\n").trim();
  return (
    <div>
      <textarea className="sc-input resize-y" rows={Math.max(4, linesOf(text).length + 1)} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} placeholder="Eén bespreekpunt per regel" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !dirty}
          onClick={() => {
            setErr(null);
            start(async () => {
              const res = await saveEditorMeetingTopics(meetingId, linesOf(text));
              if (!res.ok) return setErr(res.message ?? "Opslaan is niet gelukt.");
              setSaved(true);
              router.refresh();
            });
          }}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Opslaan
        </Button>
        {draft.length ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const have = new Set(linesOf(text));
              setText([...linesOf(text), ...draft.filter((d) => !have.has(d))].join("\n"));
              setSaved(false);
            }}
          >
            <Wand2 className="size-4" /> Conceptagenda overnemen
          </Button>
        ) : null}
        <span className="text-xs text-[var(--color-ink-faint)]">{saved ? "Opgeslagen." : `Zichtbaar voor ${editorName}.`}</span>
        {err ? <ErrorNote>{err}</ErrorNote> : null}
      </div>
    </div>
  );
}

/* --------------------------------- verslag --------------------------------- */

type PointDraft = { key: string; id: string | null; kind: PointKind; theme: string; body: string; example: string };
type ActionDraft = { key: string; id: string | null; body: string; ownerType: OwnerType; assigneeId: string; dueOn: string };

export type ReportDefaults = {
  meetingId: string;
  published: boolean;
  insights: string;
  focusNext: string;
  internalNotes: string;
  points: { id: string; kind: PointKind; theme: string; body: string; example: string | null }[];
  actions: { id: string; body: string; ownerType: OwnerType; assigneeId: string | null; dueOn: string | null }[];
  ownerId: string | null;
  nextPlanned: string | null;
  /** Eigen bespreekpunten van de editor, met de uitkomst als die er al is. */
  items: { id: string; body: string; outcome: ItemOutcome | null }[];
};

let seq = 0;
const newKey = () => `n${++seq}`;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--color-line)] px-5 py-5 first:border-t-0">
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
      {hint ? <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PointList({ kind, points, setPoints, placeholder, withExample, addLabel }: { kind: PointKind; points: PointDraft[]; setPoints: (fn: (p: PointDraft[]) => PointDraft[]) => void; placeholder: string; withExample?: boolean; addLabel: string }) {
  const themes = kind === "shortclips" ? SHORTCLIPS_THEMES : EDITOR_THEMES;
  const mine = points.filter((p) => p.kind === kind);
  const patch = (key: string, data: Partial<PointDraft>) => setPoints((list) => list.map((p) => (p.key === key ? { ...p, ...data } : p)));
  return (
    <div className="space-y-2">
      {mine.map((p) => (
        <div key={p.key} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          <div className="flex flex-wrap items-start gap-2">
            <input className="sc-input min-w-56 flex-1" value={p.body} placeholder={placeholder} onChange={(e) => patch(p.key, { body: e.target.value })} />
            <select className="sc-input w-52" value={p.theme} onChange={(e) => patch(p.key, { theme: e.target.value })} aria-label="Thema">
              {Object.entries(themes).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <button type="button" onClick={() => setPoints((list) => list.filter((x) => x.key !== p.key))} className="rounded p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Verwijderen">
              <Trash2 className="size-4" />
            </button>
          </div>
          {withExample ? <input className="sc-input mt-2" value={p.example} placeholder="Concreet voorbeeld (video, klant of moment)" onChange={(e) => patch(p.key, { example: e.target.value })} /> : null}
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => setPoints((list) => [...list, { key: newKey(), id: null, kind, theme: "overig", body: "", example: "" }])}>
        <Plus className="size-4" /> {addLabel}
      </Button>
    </div>
  );
}

export function ReportForm({ defaults, editorName, assignees }: { defaults: ReportDefaults; editorName: string; assignees: { id: string; fullName: string }[] }) {
  const [insights, setInsights] = useState(defaults.insights);
  const [focusNext, setFocusNext] = useState(defaults.focusNext);
  const [internalNotes, setInternalNotes] = useState(defaults.internalNotes);
  const [points, setPointsState] = useState<PointDraft[]>(() => defaults.points.map((p) => ({ key: p.id, id: p.id, kind: p.kind, theme: p.theme, body: p.body, example: p.example ?? "" })));
  const [actions, setActions] = useState<ActionDraft[]>(() => defaults.actions.map((a) => ({ key: a.id, id: a.id, body: a.body, ownerType: a.ownerType, assigneeId: a.assigneeId ?? "", dueOn: a.dueOn ?? "" })));
  const [items, setItems] = useState(() => defaults.items.map((i) => ({ ...i, draftKey: null as string | null })));
  const [nextDate, setNextDate] = useState("");
  const [nextTime, setNextTime] = useState("10:00");
  const [nextTopics, setNextTopics] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const setPoints = (fn: (p: PointDraft[]) => PointDraft[]) => { setPointsState(fn); setMsg(null); };
  const patchAction = (key: string, data: Partial<ActionDraft>) => { setActions((list) => list.map((a) => (a.key === key ? { ...a, ...data } : a))); setMsg(null); };

  /**
   * Uitkomst van een eigen bespreekpunt. Omzetten maakt meteen een actiepunt of
   * verbeterpunt in dit verslag met dezelfde tekst; terugdraaien haalt dat punt
   * weer weg. Zo hoeft niemand iets dubbel in te voeren.
   */
  function setOutcome(id: string, outcome: ItemOutcome | null) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (item.draftKey) {
      const k = item.draftKey;
      setActions((list) => list.filter((a) => a.key !== k));
      setPointsState((list) => list.filter((p) => p.key !== k));
    }
    let draftKey: string | null = null;
    if (outcome === "actiepunt") {
      draftKey = newKey();
      const key = draftKey;
      setActions((list) => [...list, { key, id: null, body: item.body, ownerType: "editor", assigneeId: "", dueOn: "" }]);
    } else if (outcome === "verbeterpunt") {
      draftKey = newKey();
      const key = draftKey;
      setPointsState((list) => [...list, { key, id: null, kind: "verbeterpunt", theme: "overig", body: item.body, example: "" }]);
    }
    setItems((list) => list.map((i) => (i.id === id ? { ...i, outcome, draftKey } : i)));
    setMsg(null);
  }

  function save(publish: boolean) {
    if (publish && !confirm(`Het verslag publiceren? ${editorName} ziet het direct in het portaal en krijgt een melding. Elk actiepunt wordt een taak.`)) return;
    setMsg(null);
    start(async () => {
      const res = await saveEditorMeetingReport(
        defaults.meetingId,
        {
          insights,
          focusNext,
          internalNotes,
          points: points.filter((p) => p.body.trim()).map((p) => ({ id: p.id, kind: p.kind, theme: p.theme, body: p.body, example: p.example || null })),
          actions: actions.filter((a) => a.body.trim()).map((a) => ({ id: a.id, body: a.body, ownerType: a.ownerType, assigneeId: a.assigneeId || null, dueOn: a.dueOn || null })),
          next: nextDate ? { date: nextDate, time: nextTime, topics: linesOf(nextTopics) } : null,
          items: items.map((i) => ({ id: i.id, outcome: i.outcome })),
        },
        publish,
      );
      if (!res.ok) return setMsg({ ok: false, text: res.message ?? "Opslaan is niet gelukt." });
      setMsg({ ok: true, text: publish ? `Gepubliceerd. ${editorName} heeft een melding gekregen.` : defaults.published ? "Wijzigingen opgeslagen." : "Concept bewaard. Nog niet zichtbaar voor de editor." });
      setNextDate("");
      setNextTopics("");
      router.refresh();
    });
  }

  return (
    <div>
      {items.length ? (
        <Section title={`Inbreng van ${editorName}`} hint={`Wat ${editorName} zelf wilde bespreken. Leg per punt vast wat ermee is gebeurd; omzetten maakt hieronder direct een actiepunt of verbeterpunt aan. Niet behandelde punten schuiven door naar de volgende meeting.`}>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] border-l-[3px] border-l-[var(--color-info)] bg-[var(--color-surface)] px-3 py-2.5">
                <span className="min-w-56 flex-1 text-sm text-[var(--color-ink)]">{i.body}</span>
                {i.outcome ? (
                  <>
                    <Badge tone={i.outcome === "besproken" ? "good" : "info"}>{ITEM_OUTCOME_LABEL[i.outcome]}</Badge>
                    <button type="button" onClick={() => setOutcome(i.id, null)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                      <RotateCcw className="size-3.5" /> Terugdraaien
                    </button>
                  </>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    <OutcomeButton onClick={() => setOutcome(i.id, "besproken")} icon={<Check className="size-3.5" />} label="Besproken" />
                    <OutcomeButton onClick={() => setOutcome(i.id, "actiepunt")} icon={<ListChecks className="size-3.5" />} label="Actiepunt" />
                    <OutcomeButton onClick={() => setOutcome(i.id, "verbeterpunt")} icon={<Target className="size-3.5" />} label="Verbeterpunt" />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="Wat ging goed?" hint="Positieve ontwikkelingen en sterke prestaties.">
        <PointList kind="sterk" points={points} setPoints={setPoints} placeholder="Bijv. sterke hooks bij de video's van november" addLabel="Sterk punt toevoegen" />
      </Section>
      <Section title="Wat kan beter?" hint="Concrete verbeterpunten met een voorbeeld. Het thema maakt terugkerende punten zichtbaar.">
        <PointList kind="verbeterpunt" points={points} setPoints={setPoints} placeholder="Bijv. spelling in de ondertiteling controleren" withExample addLabel="Verbeterpunt toevoegen" />
      </Section>
      <Section title="Nieuwe vaardigheden" hint="Optioneel: wat gaat de editor de komende tijd ontwikkelen?">
        <PointList kind="vaardigheid" points={points} setPoints={setPoints} placeholder="Bijv. geluidseffecten subtieler inzetten" addLabel="Vaardigheid toevoegen" />
      </Section>
      <Section title="Feedback vanuit de editor" hint="Wat kan Shortclips verbeteren in de samenwerking?">
        <PointList kind="shortclips" points={points} setPoints={setPoints} placeholder="Bijv. briefings missen soms de gewenste lengte" addLabel="Feedback toevoegen" />
      </Section>
      <Section title="Belangrijkste inzichten" hint="De belangrijkste conclusies van deze meeting.">
        <textarea className="sc-input resize-y" rows={3} value={insights} onChange={(e) => { setInsights(e.target.value); setMsg(null); }} />
      </Section>
      <Section title="Actiepunten" hint="Per actiepunt een verantwoordelijke en een deadline. Na publiceren staat elk actiepunt als taak bij de verantwoordelijke.">
        <div className="space-y-2">
          {actions.map((a) => (
            <div key={a.key} className="flex flex-wrap items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
              <input className="sc-input min-w-56 flex-1" value={a.body} placeholder="Wat moet er gebeuren?" onChange={(e) => patchAction(a.key, { body: e.target.value })} />
              <select className="sc-input w-40" value={a.ownerType} aria-label="Verantwoordelijke" onChange={(e) => patchAction(a.key, { ownerType: e.target.value as OwnerType })}>
                <option value="editor">{editorName}</option>
                <option value="content_creator">{OWNER_TYPE_LABEL.content_creator}</option>
                <option value="shortclips">{OWNER_TYPE_LABEL.shortclips}</option>
              </select>
              {a.ownerType === "shortclips" ? (
                <select className="sc-input w-36" value={a.assigneeId || defaults.ownerId || ""} aria-label="Wie pakt dit op?" onChange={(e) => patchAction(a.key, { assigneeId: e.target.value })}>
                  {assignees.map((u) => (
                    <option key={u.id} value={u.id}>{u.fullName.split(" ")[0]}</option>
                  ))}
                </select>
              ) : null}
              <input type="date" className="sc-input w-40" value={a.dueOn} aria-label="Deadline" onChange={(e) => patchAction(a.key, { dueOn: e.target.value })} />
              <button type="button" onClick={() => { setActions((list) => list.filter((x) => x.key !== a.key)); setMsg(null); }} className="rounded p-2 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Verwijderen">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setActions((list) => [...list, { key: newKey(), id: null, body: "", ownerType: "editor", assigneeId: "", dueOn: "" }])}>
            <Plus className="size-4" /> Actiepunt toevoegen
          </Button>
        </div>
      </Section>
      <Section title="Aandachtspunten voor komende maand" hint="Waar moet tijdens nieuwe opdrachten rekening mee worden gehouden?">
        <textarea className="sc-input resize-y" rows={3} value={focusNext} onChange={(e) => { setFocusNext(e.target.value); setMsg(null); }} />
      </Section>
      <Section title="Volgende meeting" hint={defaults.nextPlanned ? `Staat gepland: ${defaults.nextPlanned}. Vul hier alleen iets in als je die wilt wijzigen.` : "Optioneel: leg de volgende meeting direct vast."}>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="sc-label">Datum</label>
            <input type="date" className="sc-input" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
          </div>
          <div>
            <label className="sc-label">Tijd</label>
            <input type="time" className="sc-input" value={nextTime} onChange={(e) => setNextTime(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="sc-label">Bespreekpunten (één per regel)</label>
            <textarea className="sc-input resize-y" rows={2} value={nextTopics} onChange={(e) => setNextTopics(e.target.value)} />
          </div>
        </div>
      </Section>
      <Section title="Interne notities" hint="Alleen voor de content creator en het management. Nooit zichtbaar voor de editor, ook niet na publiceren.">
        <textarea className="sc-input resize-y" rows={3} value={internalNotes} onChange={(e) => { setInternalNotes(e.target.value); setMsg(null); }} />
      </Section>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-4">
        {defaults.published ? (
          <Button onClick={() => save(false)} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Wijzigingen opslaan
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => save(false)} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Concept bewaren
            </Button>
            <Button onClick={() => save(true)} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Publiceren voor {editorName}
            </Button>
          </>
        )}
        {msg ? (
          msg.ok ? <span className="text-sm text-[#1d6b4c]">{msg.text}</span> : <ErrorNote>{msg.text}</ErrorNote>
        ) : (
          <span className="text-xs text-[var(--color-ink-faint)]">{defaults.published ? "Dit verslag is gepubliceerd; wijzigingen zijn direct zichtbaar voor de editor." : "Een concept is niet zichtbaar voor de editor."}</span>
        )}
      </div>
    </div>
  );
}

function OutcomeButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"
    >
      {icon} {label}
    </button>
  );
}

/* ------------------- "Wat wil ik bespreken?" (editor) ------------------- */

export type EditorItem = { id: string; body: string; state: "open" | "in_verslag" };

/**
 * De editor zet hier zelf bespreekpunten klaar voor de eerstvolgende meeting.
 * Open punten zijn aan te passen en te verwijderen; een punt dat in een verslag
 * wordt verwerkt is vergrendeld.
 */
export function ItemsEditor({ items, ownerFirst }: { items: EditorItem[]; ownerFirst: string | null }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!text.trim()) return;
    setErr(null);
    start(async () => {
      const res = await addEditorMeetingItem(text);
      if (!res.ok) return setErr(res.message ?? "Opslaan is niet gelukt.");
      setText("");
      router.refresh();
    });
  }
  function saveEdit(id: string) {
    setErr(null);
    start(async () => {
      const res = await updateEditorMeetingItem(id, editText);
      if (!res.ok) return setErr(res.message ?? "Opslaan is niet gelukt.");
      setEditing(null);
      router.refresh();
    });
  }
  function remove(id: string) {
    if (!confirm("Dit bespreekpunt verwijderen?")) return;
    setErr(null);
    start(async () => {
      const res = await deleteEditorMeetingItem(id);
      if (!res.ok) return setErr(res.message ?? "Verwijderen is niet gelukt.");
      router.refresh();
    });
  }

  return (
    <div>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((i, n) => (
            <li key={i.id} className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-info-soft)] text-2xs font-bold text-[var(--color-info)]">{n + 1}</span>
              {editing === i.id ? (
                <div className="min-w-0 flex-1">
                  <textarea
                    autoFocus
                    className="sc-input resize-y"
                    rows={2}
                    maxLength={MAX_ITEM_LENGTH}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(i.id); } if (e.key === "Escape") setEditing(null); }}
                  />
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={pending || !editText.trim()} onClick={() => saveEdit(i.id)}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Opslaan</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Annuleren</Button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-sm leading-relaxed text-[var(--color-ink)]">{i.body}</span>
                  {i.state === "open" ? (
                    <span className="flex shrink-0 items-center">
                      <Badge tone="info">Open</Badge>
                      <button type="button" onClick={() => { setEditing(i.id); setEditText(i.body); setErr(null); }} className="ml-1 rounded p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]" aria-label="Aanpassen"><Pencil className="size-3.5" /></button>
                      <button type="button" disabled={pending} onClick={() => remove(i.id)} className="rounded p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Verwijderen"><Trash2 className="size-3.5" /></button>
                    </span>
                  ) : (
                    <Badge tone="neutral">Besproken, verslag volgt</Badge>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : !adding ? (
        <p className="text-sm text-[var(--color-ink-muted)]">Nog niets klaargezet. Waar loop je tegenaan, wat wil je leren of wat kan Shortclips beter doen?</p>
      ) : null}

      {adding ? (
        <div className="mt-3">
          <textarea
            autoFocus
            className="sc-input resize-y"
            rows={2}
            maxLength={MAX_ITEM_LENGTH}
            value={text}
            placeholder="Bijv. ik wil meer variatie in mijn hooks leren"
            onChange={(e) => { setText(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); add(); } if (e.key === "Escape") setAdding(false); }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={pending || !text.trim()} onClick={add}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Toevoegen</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setText(""); }}>Klaar</Button>
            <span className="text-xs text-[var(--color-ink-faint)]">Enter om op te slaan, daarna direct het volgende punt.</span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setAdding(true); setErr(null); }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-info)] bg-[var(--color-info-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-info)] hover:brightness-105"
        >
          <MessageSquarePlus className="size-4" /> Bespreekpunt toevoegen
        </button>
      )}
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
      <p className="mt-3 text-xs text-[var(--color-ink-faint)]">{ownerFirst ? `${ownerFirst} ziet je punten vooraf.` : "Je content creative ziet je punten vooraf."} Wat besproken is, vind je terug in het verslag.</p>
    </div>
  );
}
