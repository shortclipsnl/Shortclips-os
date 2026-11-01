"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Plus, Bookmark, Loader2, Trash2 } from "lucide-react";
import { buttonClass } from "@/components/ui";
import {
  contentChat,
  deleteContentConversation,
  getContentConversation,
  saveIdeaFromChat,
} from "@/server/actions/content-research";

type Msg = { role: "user" | "assistant"; content: string };
type Conversation = { id: string; title: string };

const SUGGESTIONS = [
  "Bedenk 5 grappigere ideeën.",
  "Welke onderwerpen hebben we nog nooit behandeld?",
  "Maak deze ideeën minder commercieel.",
  "Bedenk concepten waarin medewerkers centraal staan.",
  "Welke trends in Amerika passen bij deze klant?",
];

function renderText(text: string) {
  return text.split(/\n{2,}/).map((para, i) => (
    <p key={i} className="mb-2 last:mb-0 whitespace-pre-wrap">
      {para.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>,
      )}
    </p>
  ));
}

export function ContentChat({
  clientId,
  conversations,
  aiReady,
  seed,
}: {
  clientId: string;
  conversations: Conversation[];
  aiReady: boolean;
  seed?: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [input, setInput] = useState(seed ? `Spar met me over dit idee: "${seed}"` : "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  function send(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    setErr(null);
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    start(async () => {
      const res = await contentChat({ clientId, conversationId: convId ?? undefined, messages: next });
      if (!res.ok) {
        setErr(res.message);
        setMessages(messages); // rollback
        return;
      }
      setConvId(res.conversationId);
      setMessages([...next, { role: "assistant", content: res.reply }]);
      router.refresh();
    });
  }

  function openConversation(id: string) {
    start(async () => {
      const res = await getContentConversation(clientId, id);
      if (res.ok) {
        setConvId(id);
        setMessages(res.messages);
      }
    });
  }

  function newChat() {
    setConvId(null);
    setMessages([]);
    setInput("");
  }

  function saveAsIdea(content: string) {
    const titel = content.split("\n").find((l) => l.trim())?.trim().slice(0, 120) || "Idee uit gesprek";
    start(async () => {
      await saveIdeaFromChat({ clientId, titel, concept: content });
      router.refresh();
    });
  }

  function removeConversation(id: string) {
    start(async () => {
      await deleteContentConversation(clientId, id);
      if (convId === id) newChat();
      router.refresh();
    });
  }

  if (!aiReady) {
    return <div className="sc-card p-5 text-sm text-[var(--color-ink-muted)]">De AI-chat staat uit (ANTHROPIC_API_KEY ontbreekt).</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <aside className="space-y-2">
        <button type="button" onClick={newChat} className={buttonClass({ variant: "secondary", size: "sm", className: "w-full" })}>
          <Plus className="size-3.5" /> Nieuw gesprek
        </button>
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => openConversation(c.id)}
                className={`flex-1 truncate rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs ${convId === c.id ? "bg-[var(--color-brand-50)] text-[var(--color-ink)]" : "text-[var(--color-ink-muted)] hover:bg-[var(--color-neutral-soft)]"}`}
              >
                {c.title}
              </button>
              <button type="button" onClick={() => removeConversation(c.id)} className="opacity-0 transition-opacity group-hover:opacity-100" title="Verwijderen">
                <Trash2 className="size-3.5 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-h-[420px] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-ink-muted)]">Spar klantspecifiek: de AI kent de eerdere scripts, feedback, opgeslagen ideeën en het Content DNA.</p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] hover:border-[var(--color-brand-500)] hover:text-[var(--color-ink)]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-[var(--radius-md)] px-3 py-2 text-sm ${m.role === "user" ? "bg-[var(--color-brand-500)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink)]"}`}>
                  {m.role === "assistant" ? renderText(m.content) : m.content}
                  {m.role === "assistant" ? (
                    <button type="button" onClick={() => saveAsIdea(m.content)} className="mt-1 inline-flex items-center gap-1 text-2xs text-[var(--color-brand-600)] hover:underline">
                      <Bookmark className="size-3" /> Bewaar als idee
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
          {pending ? <div className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]"><Loader2 className="size-4 animate-spin" /> Denkt na…</div> : null}
          <div ref={endRef} />
        </div>

        {err ? <p className="mt-2 text-xs text-[var(--color-bad)]">{err}</p> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mt-3 flex items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Stel een vraag of vraag om nieuwe ideeën…"
            className="sc-input h-11 max-h-40 flex-1 resize-none"
          />
          <button type="submit" disabled={pending || !input.trim()} className={buttonClass({ variant: "primary", size: "md" })}>
            <Send className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
