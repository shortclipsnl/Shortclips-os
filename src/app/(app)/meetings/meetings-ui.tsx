"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ListPlus, Plus, Trash2 } from "lucide-react";
import { actionItemToTask, addMeetingItem, createMeeting, deleteMeeting, deleteMeetingItem, toggleMeetingItem } from "@/server/actions/meetings";
import { Button, ErrorNote } from "@/components/ui";

export type Member = { id: string; fullName: string };

export function NewMeetingForm({ members }: { members: Member[] }) {
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  const [location, setLocation] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function toggle(id: string) {
    setParticipants((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  function submit() {
    setErr(null);
    start(async () => {
      const res = await createMeeting({ title, scheduledAt: at, location, participantIds: participants });
      if (res.ok && res.id) router.push(`/meetings/${res.id}`);
      else setErr(res.message ?? "Mislukt");
    });
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)} size="sm"><Plus className="size-4" /> Nieuwe meeting</Button>;
  }
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="sc-label">Titel</label>
          <input className="sc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="bijv. Weekstart" />
        </div>
        <div>
          <label className="sc-label">Datum en tijd</label>
          <input type="datetime-local" className="sc-input" value={at} onChange={(e) => setAt(e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <label className="sc-label">Locatie (optioneel)</label>
          <input className="sc-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Kantoor Sneek / online" />
        </div>
      </div>
      <div className="mt-3">
        <label className="sc-label">Deelnemers</label>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button key={m.id} type="button" onClick={() => toggle(m.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${participants.includes(m.id) ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>
              {m.fullName.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={submit} disabled={pending || !title.trim() || !at} size="sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Aanmaken
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Annuleren</Button>
        {err ? <ErrorNote>{err}</ErrorNote> : null}
      </div>
    </div>
  );
}

export function AddItemForm({ meetingId, kind, members }: { meetingId: string; kind: "agenda" | "decision" | "action"; members: Member[] }) {
  const [body, setBody] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!body.trim()) return;
    start(async () => {
      const res = await addMeetingItem({ meetingId, kind, body, assigneeId: assigneeId || null, dueOn: dueOn || null });
      if (res.ok) { setBody(""); setAssigneeId(""); setDueOn(""); router.refresh(); }
    });
  }

  const placeholder = kind === "agenda" ? "Nieuw bespreekpunt…" : kind === "decision" ? "Genomen besluit…" : "Actiepunt…";
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-[var(--color-line)] p-3">
      <input className="sc-input h-8 min-w-48 flex-1 py-0 text-sm" value={body} placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
      {kind === "action" ? (
        <>
          <select className="sc-input h-8 w-32 py-0 text-xs" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Toewijzen">
            <option value="">Wie?</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
          </select>
          <input type="date" className="sc-input h-8 w-32 py-0 text-xs" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Deadline" />
        </>
      ) : null}
      <Button onClick={add} disabled={pending || !body.trim()} size="sm">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Toevoegen
      </Button>
    </div>
  );
}

export function DeleteMeetingButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button type="button" disabled={pending}
      onClick={() => start(async () => { await deleteMeeting(id); router.push("/meetings"); router.refresh(); })}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-bad)]">
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Meeting verwijderen
    </button>
  );
}

export function ItemActions({ id, kind, hasTask }: { id: string; kind: string; hasTask: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  return (
    <span className="flex shrink-0 items-center gap-1">
      {kind === "action" && !hasTask ? (
        <button type="button" disabled={pending} onClick={() => run(() => actionItemToTask(id))}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium text-[var(--color-brand-600)] hover:bg-[var(--color-surface-sunken)]" title="Maak er een taak van">
          <ListPlus className="size-3.5" /> Naar taken
        </button>
      ) : null}
      {kind === "action" || kind === "agenda" ? (
        <button type="button" disabled={pending} onClick={() => run(() => toggleMeetingItem(id))}
          className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-good)]" aria-label={kind === "agenda" ? "Behandeld" : "Afvinken"}>
          <Check className="size-4" />
        </button>
      ) : null}
      <button type="button" disabled={pending} onClick={() => run(() => deleteMeetingItem(id))}
        className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Verwijderen">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </button>
    </span>
  );
}
