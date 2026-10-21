"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Check, Loader2, RotateCcw, X } from "lucide-react";
import { createHandoverNote, deleteHandoverNote, resolveHandoverNote } from "@/server/actions/handover";

export type HandoverNote = {
  id: string;
  body: string;
  authorName: string | null;
  forUserName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
};
type UserOption = { id: string; fullName: string };

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `vandaag ${time}`;
  if (isYest) return `gisteren ${time}`;
  return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" }) + ` ${time}`;
}

export function HandoverBoard({ notes, users, canWrite }: { notes: HandoverNote[]; users: UserOption[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [forUserId, setForUserId] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = notes.filter((n) => !n.resolvedAt);
  const done = notes.filter((n) => n.resolvedAt);

  function add() {
    setError(null);
    if (!body.trim()) return;
    start(async () => {
      const r = await createHandoverNote({ body, forUserId: forUserId || null });
      if (r.ok) {
        setBody("");
        setForUserId("");
        router.refresh();
      } else {
        setError(r.message ?? "Opslaan mislukt.");
      }
    });
  }
  function resolve(id: string, resolved: boolean) {
    start(async () => { await resolveHandoverNote(id, resolved); router.refresh(); });
  }
  function remove(id: string) {
    start(async () => { await deleteHandoverNote(id); router.refresh(); });
  }

  return (
    <section className="mb-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-bad)]/35 bg-[var(--color-bad-soft)] shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-bad)]/25 px-4 py-2.5">
        <ArrowRightLeft className="size-4 shrink-0 text-[var(--color-bad)]" />
        <h2 className="text-sm font-bold text-[#a3271c]">Overdracht</h2>
        <span className="text-2xs text-[var(--color-ink-muted)]">korte punten voor de volgende persoon of dag</span>
        {open.length > 0 ? <span className="ml-auto rounded-full bg-[var(--color-bad)] px-2 py-0.5 text-2xs font-bold text-white">{open.length} open</span> : null}
      </div>

      <div className="space-y-2.5 p-3">
        {/* Nieuwe overdracht */}
        {canWrite ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder="Bijv. Klant Jansen gebeld over de opname — moet maandag teruggebeld worden."
              className="sc-input w-full resize-y py-1.5 text-sm"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-2xs text-[var(--color-ink-muted)]">Voor</label>
              <select value={forUserId} onChange={(e) => setForUserId(e.target.value)} className="sc-input h-8 py-0 text-xs">
                <option value="">Iedereen</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.fullName.split(" ")[0]}</option>)}
              </select>
              <button
                type="button"
                disabled={pending || !body.trim()}
                onClick={add}
                className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Plaatsen
              </button>
            </div>
            {error ? <p className="mt-1 text-xs text-[var(--color-bad)]">{error}</p> : null}
          </div>
        ) : null}

        {/* Openstaande overdrachtspunten */}
        {open.length === 0 ? (
          <p className="px-1 py-2 text-xs text-[var(--color-ink-muted)]">Geen openstaande overdracht. Alles netjes overgedragen.</p>
        ) : (
          <ul className="space-y-2">
            {open.map((n) => (
              <li key={n.id} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5" style={{ boxShadow: "inset 3px 0 0 var(--color-bad)" }}>
                <p className="whitespace-pre-wrap text-sm text-[var(--color-ink)]">{n.body}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-[var(--color-ink-muted)]">
                  <span>{n.authorName ?? "Onbekend"}</span>
                  {n.forUserName ? <><span className="text-[var(--color-ink-faint)]">→</span><span className="font-medium text-[var(--color-ink)]">voor {n.forUserName}</span></> : null}
                  <span className="text-[var(--color-ink-faint)]">·</span>
                  <span>{when(n.createdAt)}</span>
                  {canWrite ? (
                    <span className="ml-auto flex items-center gap-2">
                      <button type="button" disabled={pending} onClick={() => resolve(n.id, true)} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 font-semibold text-[#1a6b3a] hover:brightness-95"><Check className="size-3" /> Gedaan</button>
                      <button type="button" disabled={pending} onClick={() => remove(n.id)} aria-label="Verwijderen" className="text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]"><X className="size-3.5" /></button>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Afgehandeld (ingeklapt) */}
        {done.length > 0 ? (
          <div>
            <button type="button" onClick={() => setShowDone((s) => !s)} className="text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
              {showDone ? "Verberg" : "Toon"} afgehandeld ({done.length})
            </button>
            {showDone ? (
              <ul className="mt-1.5 space-y-1.5">
                {done.map((n) => (
                  <li key={n.id} className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-xs opacity-75">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--color-good)]" />
                    <span className="min-w-0 flex-1">
                      <span className="text-[var(--color-ink-muted)] line-through">{n.body}</span>
                      <span className="mt-0.5 block text-2xs text-[var(--color-ink-faint)]">{n.authorName ?? "?"} · afgehandeld{n.resolvedByName ? ` door ${n.resolvedByName}` : ""}</span>
                    </span>
                    {canWrite ? <button type="button" disabled={pending} onClick={() => resolve(n.id, false)} aria-label="Terugzetten" className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><RotateCcw className="size-3.5" /></button> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
