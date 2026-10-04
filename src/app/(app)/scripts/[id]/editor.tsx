"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { changeScriptStatus, saveScript } from "@/server/actions/scripts";
import { Button, ErrorNote, InfoNote } from "@/components/ui";
import { SCRIPT_STATUS } from "@/lib/statuses";

const FLOW: Record<string, string[]> = {
  idea: ["concept"],
  concept: ["internal_review"],
  internal_review: ["revising", "client_review"],
  client_review: ["revising", "approved"],
  revising: ["internal_review"],
  approved: ["ready_to_shoot"],
  ready_to_shoot: ["shot"],
  shot: [],
};

type Draft = {
  title: string;
  hook: string;
  body: string;
  cta: string;
  shotList: string;
  requirements: string;
  internalNotes: string;
};

export function ScriptEditor({
  scriptId,
  initial,
  canWrite,
}: {
  scriptId: string;
  initial: Draft;
  canWrite: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [summary, setSummary] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    start(async () => {
      const res = await saveScript(scriptId, { ...draft, changeSummary: summary });
      setResult(res);
      if (res.ok) {
        setSummary("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <Field label="Titel">
        <input className="sc-input" value={draft.title} disabled={!canWrite} onChange={(e) => set("title", e.target.value)} />
      </Field>
      <Field label="Hook" hint="De eerste twee seconden bepalen of iemand blijft kijken.">
        <textarea className="sc-input resize-y" rows={2} value={draft.hook} disabled={!canWrite} onChange={(e) => set("hook", e.target.value)} />
      </Field>
      <Field label="Tekst">
        <textarea className="sc-input resize-y font-mono text-xs leading-relaxed" rows={14} value={draft.body} disabled={!canWrite} onChange={(e) => set("body", e.target.value)} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Call to action">
          <textarea className="sc-input resize-y" rows={2} value={draft.cta} disabled={!canWrite} onChange={(e) => set("cta", e.target.value)} />
        </Field>
        <Field label="Benodigdheden">
          <textarea className="sc-input resize-y" rows={2} value={draft.requirements} disabled={!canWrite} onChange={(e) => set("requirements", e.target.value)} />
        </Field>
      </div>
      <Field label="Shotlist">
        <textarea className="sc-input resize-y font-mono text-xs" rows={6} value={draft.shotList} disabled={!canWrite} onChange={(e) => set("shotList", e.target.value)} />
      </Field>
      <Field label="Interne opmerkingen" hint="Niet zichtbaar voor de klant.">
        <textarea className="sc-input resize-y" rows={3} value={draft.internalNotes} disabled={!canWrite} onChange={(e) => set("internalNotes", e.target.value)} />
      </Field>

      {canWrite ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-[var(--color-line)] pt-4">
          <div className="min-w-56 flex-1">
            <label className="sc-label" htmlFor="summary">
              Wat is er veranderd? (komt in de versiegeschiedenis)
            </label>
            <input
              id="summary"
              className="sc-input"
              placeholder="Bijv. hook aangescherpt na interne controle"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <Button onClick={save} disabled={pending || !dirty}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {dirty ? "Opslaan als nieuwe versie" : "Geen wijzigingen"}
          </Button>
        </div>
      ) : null}

      {result ? (
        result.ok ? <InfoNote tone="good">{result.message}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="sc-label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{hint}</p> : null}
    </div>
  );
}

export function ScriptStatusControl({
  scriptId,
  status,
  canWrite,
}: {
  scriptId: string;
  status: string;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const router = useRouter();

  if (!canWrite) return null;
  const next = FLOW[status] ?? [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {next.length === 0 ? (
          <span className="text-sm text-[var(--color-ink-muted)]">Laatste stap bereikt.</span>
        ) : (
          next.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === "revising" ? "secondary" : "accent"}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await changeScriptStatus(scriptId, s);
                  setResult(res);
                  if (res.ok) router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {SCRIPT_STATUS[s]?.label ?? s}
            </Button>
          ))
        )}
      </div>
      {result && !result.ok ? <ErrorNote>{result.message}</ErrorNote> : null}
    </div>
  );
}
