"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { saveExitInterview } from "@/server/actions/exit-interview";
import {
  EXIT_CAUSE, EXIT_QUESTIONS, EXIT_REASON_GROUPS, EXIT_TRI,
  type ExitAction, type ExitInterviewData, type ExitQuestionKey, type ExitScoreKey,
} from "@/lib/exit-interview";

const field = "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink-muted)]";
const small = "block space-y-1 text-xs text-[var(--color-ink-muted)]";
const primary = "h-9 rounded-[var(--radius-sm)] bg-[var(--color-violet)] px-4 text-sm font-medium text-white hover:brightness-95 disabled:opacity-60";

/** Keuzeknop: nogmaals klikken zet de keuze uit. */
function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        on
          ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white"
          : "border-[var(--color-line-strong)] text-[var(--color-ink)] hover:border-[var(--color-ink-muted)]",
      )}
    >
      {children}
    </button>
  );
}

function Section({ n, title, sub, children }: { n: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--color-line)] pt-5 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-baseline gap-3">
        <span className="text-xs font-semibold tabular-nums text-[var(--color-ink-faint)]">{n}</span>
        <div>
          <h2 className="text-base font-semibold text-[var(--color-ink)]">{title}</h2>
          {sub ? <p className="text-xs text-[var(--color-ink-muted)]">{sub}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Question({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
      {children}
    </div>
  );
}

export function ExitInterviewForm({
  clientId, initial, team, savedLabel,
}: {
  clientId: string;
  initial: ExitInterviewData;
  team: { id: string; name: string }[];
  savedLabel: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState<ExitInterviewData>(() => ({ ...initial, actions: initial.actions.length ? initial.actions : [{ action: "", ownerId: null, dueOn: null }] }));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof ExitInterviewData>(k: K, v: ExitInterviewData[K]) => {
    setD((p) => ({ ...p, [k]: v }));
    setDirty(true);
    setMsg(null);
  };
  const toggle = <K extends keyof ExitInterviewData>(k: K, v: ExitInterviewData[K]) => set(k, (d[k] === v ? null : v) as ExitInterviewData[K]);
  const setAnswer = (k: ExitQuestionKey, v: string) => set("answers", { ...d.answers, [k]: v });
  const setAction = (i: number, patch: Partial<ExitAction>) => set("actions", d.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const usesOther = d.primaryReason === "anders" || d.secondaryReason === "anders";

  function save() {
    start(async () => {
      const r = await saveExitInterview({
        clientId,
        ...d,
        answers: Object.fromEntries(Object.entries(d.answers).filter(([, v]) => v !== undefined)) as Record<ExitQuestionKey, string>,
        actions: d.actions.filter((a) => a.action.trim()),
      });
      setMsg({ ok: r.ok, text: r.ok ? "Opgeslagen." : r.message ?? "Opslaan mislukt." });
      if (r.ok) { setDirty(false); router.refresh(); }
    });
  }

  return (
    <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {/* 1. Gesprek */}
      <Section n="01" title="Gesprek">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={small}>Datum exitgesprek
            <input type="date" value={d.interviewDate ?? ""} onChange={(e) => set("interviewDate", e.target.value || null)} className={field} />
          </label>
          <label className={small}>Gesprek gevoerd door
            <select value={d.conductedById ?? ""} onChange={(e) => set("conductedById", e.target.value || null)} className={field}>
              <option value="">Kies</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className={small}>Einddatum samenwerking
            <input type="date" value={d.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} className={field} />
          </label>
        </div>
      </Section>

      {/* 2. Antwoorden */}
      <Section n="02" title="Antwoorden van de klant" sub="Zoveel mogelijk in de woorden van de klant. Kort mag.">
        <div className="space-y-6">
          {EXIT_QUESTIONS.map((q, i) => (
            <div key={q.key} className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                  <p className="text-sm font-medium text-[var(--color-ink)]"><span className="mr-1.5 text-[var(--color-ink-faint)]">{i + 1}.</span>{q.q}</p>
                  <p className="text-xs text-[var(--color-ink-faint)]">{q.hint}</p>
                </div>
              </div>
              {"score" in q ? (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Score vraag ${i + 1}`}>
                  <span className="mr-1 text-xs text-[var(--color-ink-muted)]">Score</span>
                  {Array.from({ length: 10 }, (_, n) => n + 1).map((n) => {
                    const key = q.score as ExitScoreKey;
                    const on = d[key] === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(key, n)}
                        className={cn(
                          "size-8 rounded-[var(--radius-sm)] border text-[13px] font-medium tabular-nums transition-colors",
                          on
                            ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white"
                            : "border-[var(--color-line-strong)] text-[var(--color-ink)] hover:border-[var(--color-ink-muted)]",
                        )}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <textarea
                rows={2}
                value={d.answers[q.key] ?? ""}
                onChange={(e) => setAnswer(q.key, e.target.value)}
                className={field}
                placeholder="Aantekening"
              />
            </div>
          ))}
        </div>
      </Section>

      {/* 3. Opzegreden */}
      <Section n="03" title="Opzegreden" sub="Kies één primaire reden. Een secundaire reden is optioneel.">
        <div className="space-y-5">
          {(["primaryReason", "secondaryReason"] as const).map((slot) => (
            <Question key={slot} title={slot === "primaryReason" ? "Primaire reden" : "Secundaire reden (optioneel)"}>
              <div className="space-y-2.5">
                {EXIT_REASON_GROUPS.map((g) => (
                  <div key={g.label} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-28 shrink-0 text-xs text-[var(--color-ink-faint)]">{g.label}</span>
                    {g.reasons.map((r) => (
                      <Chip
                        key={r.key}
                        on={d[slot] === r.key}
                        disabled={slot === "secondaryReason" && d.primaryReason === r.key}
                        onClick={() => toggle(slot, r.key)}
                      >
                        {r.label}
                      </Chip>
                    ))}
                  </div>
                ))}
              </div>
            </Question>
          ))}
          {usesOther ? (
            <label className={small}>Anders, namelijk
              <input value={d.otherReason ?? ""} maxLength={240} onChange={(e) => set("otherReason", e.target.value)} className={field} />
            </label>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={small}>Wat de klant letterlijk zegt
              <textarea rows={3} value={d.quote ?? ""} onChange={(e) => set("quote", e.target.value)} className={field} placeholder="Citaat of kernzin" />
            </label>
            <label className={small}>Onze interpretatie
              <textarea rows={3} value={d.interpretation ?? ""} onChange={(e) => set("interpretation", e.target.value)} className={field} placeholder="Wat zit er volgens ons echt achter?" />
            </label>
          </div>
        </div>
      </Section>

      {/* 4. Interne conclusie */}
      <Section n="04" title="Interne conclusie" sub="Vul dit direct na het gesprek in.">
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Question title="Waar lag de oorzaak vooral?">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(EXIT_CAUSE) as (keyof typeof EXIT_CAUSE)[]).map((k) => (
                  <Chip key={k} on={d.cause === k} onClick={() => toggle("cause", k)}>{EXIT_CAUSE[k]}</Chip>
                ))}
              </div>
            </Question>
            <Question title="Had deze opzegging voorkomen kunnen worden?">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(EXIT_TRI) as (keyof typeof EXIT_TRI)[]).map((k) => (
                  <Chip key={k} on={d.preventable === k} onClick={() => toggle("preventable", k)}>{EXIT_TRI[k]}</Chip>
                ))}
              </div>
            </Question>
          </div>

          <label className={small}>Belangrijkste leerpunt voor Shortclips
            <textarea rows={2} value={d.lesson ?? ""} onChange={(e) => set("lesson", e.target.value)} className={field} placeholder="Eén concrete conclusie" />
          </label>

          <Question title="Welke actie ondernemen we intern?">
            <div className="space-y-2">
              {d.actions.map((a, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_170px_160px_auto]">
                  <input value={a.action} onChange={(e) => setAction(i, { action: e.target.value })} className={field} placeholder="Verbeteractie" aria-label="Verbeteractie" />
                  <select value={a.ownerId ?? ""} onChange={(e) => setAction(i, { ownerId: e.target.value || null })} className={field} aria-label="Verantwoordelijke">
                    <option value="">Verantwoordelijke</option>
                    {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <input type="date" value={a.dueOn ?? ""} onChange={(e) => setAction(i, { dueOn: e.target.value || null })} className={field} aria-label="Deadline" />
                  <button
                    type="button"
                    onClick={() => set("actions", d.actions.length > 1 ? d.actions.filter((_, j) => j !== i) : [{ action: "", ownerId: null, dueOn: null }])}
                    className="h-9 px-2 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    aria-label="Actie verwijderen"
                  >
                    Verwijderen
                  </button>
                </div>
              ))}
              {d.actions.length < 10 ? (
                <button type="button" onClick={() => set("actions", [...d.actions, { action: "", ownerId: null, dueOn: null }])} className="text-xs font-medium text-[var(--color-violet)]">
                  + Actie toevoegen
                </button>
              ) : null}
            </div>
          </Question>

          <div className="flex flex-wrap items-end gap-5">
            <Question title="Is een toekomstige samenwerking mogelijk?">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(EXIT_TRI) as (keyof typeof EXIT_TRI)[]).map((k) => (
                  <Chip key={k} on={d.futurePossible === k} onClick={() => toggle("futurePossible", k)}>{EXIT_TRI[k]}</Chip>
                ))}
              </div>
            </Question>
            {d.futurePossible === "ja" || d.futurePossible === "misschien" ? (
              <label className={cn(small, "w-44")}>Opvolgen op
                <input type="date" value={d.followUpOn ?? ""} onChange={(e) => set("followUpOn", e.target.value || null)} className={field} />
              </label>
            ) : null}
          </div>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3">
        <button disabled={pending || !dirty} className={primary}>{pending ? "Opslaan..." : "Opslaan"}</button>
        {msg ? <span className={cn("text-sm", msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]")}>{msg.text}</span> : null}
        {!msg && dirty ? <span className="text-xs text-[var(--color-warn)]">Niet opgeslagen wijzigingen</span> : null}
        {!msg && !dirty && savedLabel ? <span className="text-xs text-[var(--color-ink-faint)]">{savedLabel}</span> : null}
      </div>
    </form>
  );
}
