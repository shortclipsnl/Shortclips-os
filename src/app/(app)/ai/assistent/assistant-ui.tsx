"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, Bot, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { askAssistant } from "@/server/actions/assistant";
import { Card } from "@/components/ui";
import { QUESTION_CATEGORIES, type AssistantAnswer, type AssistantItem, type AssistantTone, type ExampleQuestion, type HandlerKey } from "@/lib/assistant";

const DOT: Record<AssistantTone, string> = {
  bad: "var(--color-bad)",
  warn: "var(--color-warn)",
  good: "var(--color-good)",
  info: "var(--color-info)",
  neutral: "var(--color-ink-faint)",
};

type Asked = { question: string; answer: AssistantAnswer } | { question: string; error: string } | null;

export function AssistantConsole({ firstName, aiReady }: { firstName: string; aiReady: boolean }) {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<Asked>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function run(question: string, handler?: HandlerKey) {
    const q = question.trim();
    if (!q) return;
    start(async () => {
      const res = await askAssistant({ question: q, handler });
      if (res.ok) setAsked({ question: q, answer: res.answer });
      else setAsked({ question: q, error: res.message });
    });
  }

  function onExample(e: ExampleQuestion) {
    setText(e.text);
    run(e.text, e.handler);
  }

  return (
    <div className="space-y-5">
      {/* Begroeting + invoerveld. */}
      <Card className="bg-[var(--color-indigo-ink)] text-white">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-white/15"><Bot className="size-5" /></span>
          <div>
            <h2 className="text-base font-bold tracking-tight">Shortclips AI Assistent</h2>
            <p className="text-xs text-white/70">Je slimme collega die alles binnen Shortclips kan terugvinden{firstName ? `, ${firstName}` : ""}.</p>
          </div>
        </div>
        <form
          className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-white p-1.5 pl-3"
          onSubmit={(e) => { e.preventDefault(); run(text); }}
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Stel een vraag over klanten, scripts, opnames, editing, planning…"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]"
          />
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            Vraag stellen
          </button>
        </form>
      </Card>

      {/* Antwoord — direct onder de vraag. */}
      {pending ? (
        <Card><p className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]"><Loader2 className="size-4 animate-spin" /> Even zoeken in de Hub…</p></Card>
      ) : asked ? (
        "error" in asked ? (
          <Card className="border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)]/40">
            <p className="text-sm font-medium">{asked.question}</p>
            <p className="mt-1 text-sm text-[var(--color-bad)]">{asked.error}</p>
          </Card>
        ) : (
          <AnswerView question={asked.question} answer={asked.answer} aiReady={aiReady} />
        )
      ) : null}

      {/* Voorbeeldvragen — per categorie, onder elkaar. */}
      <div>
        <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Voorbeeldvragen</span>
        <div className="mt-2 space-y-4">
          {QUESTION_CATEGORIES.map((c) => (
            <div key={c.key}>
              <h3 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                <span className="inline-block size-1.5 rounded-full bg-[var(--color-brand-500)]" />
                {c.label}
              </h3>
              <div className="flex flex-col gap-1.5">
                {c.questions.map((q) => (
                  <button
                    key={q.text}
                    type="button"
                    onClick={() => onExample(q)}
                    disabled={pending}
                    className="group flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-left text-sm font-medium hover:border-[var(--color-brand-500)] hover:bg-[var(--color-surface-sunken)]"
                  >
                    <Sparkles className="size-4 shrink-0 text-[var(--color-brand-500)]" />
                    <span className="min-w-0 flex-1">{q.text}</span>
                    <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-faint)] group-hover:text-[var(--color-brand-600)]" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnswerView({ question, answer, aiReady }: { question: string; answer: AssistantAnswer; aiReady: boolean }) {
  return (
    <Card
      padded={false}
      className="overflow-hidden border-l-[3px] border-l-[var(--color-brand-500)] ring-1 ring-[var(--color-brand-500)]/25 bg-[color-mix(in_srgb,var(--color-brand-500)_5%,var(--color-surface))]"
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-brand-500)]/20 bg-[color-mix(in_srgb,var(--color-brand-500)_9%,var(--color-surface))] px-5 py-3">
        <Sparkles className="size-4 shrink-0 text-[var(--color-brand-600)]" />
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-brand-600)]">Antwoord op je vraag</p>
          <p className="truncate text-sm font-semibold">{question}</p>
        </div>
      </div>
      <div className="px-5 py-4">
        <p className="text-sm font-medium">{answer.summary}</p>
        {answer.note ? <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">{answer.note}</p> : null}

        <div className="mt-3 space-y-4">
          {answer.groups.map((g, gi) => (
            <div key={gi}>
              {g.heading ? <h4 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{g.heading}</h4> : null}
              {g.items.length === 0 ? (
                <p className="text-sm text-[var(--color-ink-faint)]">Niets gevonden.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]">
                  {g.items.map((it, i) => <AnswerRow key={i} item={it} />)}
                </ul>
              )}
            </div>
          ))}
        </div>

        {answer.source ? <p className="mt-4 text-2xs text-[var(--color-ink-faint)]">Bron: {answer.source}</p> : null}
        {!aiReady ? (
          <p className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)]/40 px-3 py-2 text-xs text-[#8a5300]">
            Vrije vragen (eigen typtekst buiten de voorbeeldvragen) werken zodra de AI-sleutel is ingesteld. De voorbeeldvragen hierboven werken nu al, rechtstreeks uit de Hub-data.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function AnswerRow({ item }: { item: AssistantItem }) {
  const tone = item.tone ?? "neutral";
  const inner = (
    <span className="flex items-center gap-3 px-4 py-2.5">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: DOT[tone] }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        {item.subtitle ? <span className="block truncate text-xs text-[var(--color-ink-muted)]">{item.subtitle}</span> : null}
      </span>
      {item.meta ? <span className="shrink-0 text-xs font-semibold" style={{ color: DOT[tone] }}>{item.meta}</span> : null}
      {item.href ? <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" /> : null}
    </span>
  );
  if (item.href) {
    return <li><Link href={item.href} className="block hover:bg-[var(--color-surface-sunken)]">{inner}</Link></li>;
  }
  return <li>{inner}</li>;
}
