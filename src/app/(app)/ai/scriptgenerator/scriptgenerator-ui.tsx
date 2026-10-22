"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Send, Sparkles, Copy, Check } from "lucide-react";
import { scriptChat } from "@/server/actions/script-chat";
import type { ChatMessage } from "@/server/ai/client";

type Client = { id: string; name: string };

/** Lichte opmaak: regels + **vet**, zodat de vaste Shortclips-koppen opvallen. */
function renderText(t: string) {
  return t.split("\n").map((line, i) => {
    if (line.trim() === "") return <div key={i} className="h-2.5" />;
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
      seg.startsWith("**") && seg.endsWith("**") ? <strong key={j}>{seg.slice(2, -2)}</strong> : <span key={j}>{seg}</span>,
    );
    return <div key={i} className="leading-snug">{parts}</div>;
  });
}

function Bubble({ m }: { m: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const mine = m.role === "user";
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard geblokkeerd */ }
  };
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`group relative max-w-[88%] rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm ${mine ? "bg-[var(--color-brand-600)] text-white" : "border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)]"}`}>
        {mine ? <div className="whitespace-pre-wrap leading-snug">{m.content}</div> : <div>{renderText(m.content)}</div>}
        {!mine ? (
          <button type="button" onClick={copy} title="Kopieer" className="absolute -right-2 -top-2 hidden rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1 text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] group-hover:block hover:text-[var(--color-ink)]">
            {copied ? <Check className="size-3.5 text-[var(--color-good)]" /> : <Copy className="size-3.5" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ScriptGeneratorChat({ clients, aiReady }: { clients: Client[]; aiReady: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [clientId, setClientId] = useState<string>("");
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending]);

  const send = (text: string) => {
    const content = text.trim();
    if (!content || pending) return;
    setErr(null);
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    start(async () => {
      const res = await scriptChat({ messages: next, clientId: clientId || undefined });
      if (res.ok) setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
      else { setErr(res.message); setMessages((m) => m.slice(0, -1)); setInput(content); }
    });
  };

  if (!aiReady) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-muted)]">
        De AI-schrijver staat nog uit. Zodra de ANTHROPIC_API_KEY is ingesteld, kun je hier scripts schrijven.
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-[var(--shadow-card)]">
      {/* Klantkeuze: laadt stijl + cijfers van die klant mee. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <label className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klant</label>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="sc-input h-8 w-auto max-w-[260px] py-0 text-xs">
          <option value="">Geen specifieke klant</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-2xs text-[var(--color-ink-faint)]">{clientId ? "Stijl en cijfers van deze klant worden meegeladen." : "Kies een klant voor stijl + wat er werkt."}</span>
      </div>

      {/* Gesprek */}
      <div className="flex max-h-[58vh] min-h-[320px] flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="m-auto max-w-md text-center">
            <Sparkles className="mx-auto mb-2 size-6 text-[var(--color-brand-600)]" />
            <p className="text-sm font-semibold text-[var(--color-ink)]">Organische scripts op Shortclips-niveau</p>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Begin het gesprek. Hij werkt volgens de vaste werkwijze: eerst de klant en stijl, dan de hooks, dan de scripts in het vaste format.</p>
            <button type="button" onClick={() => send("Ik wil scripts schrijven.")} className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110">
              <Sparkles className="size-3.5" /> Start met scripts schrijven
            </button>
          </div>
        ) : (
          messages.map((m, i) => <Bubble key={i} m={m} />)
        )}
        {pending ? (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-ink-muted)]">
              <Loader2 className="size-4 animate-spin text-[var(--color-brand-600)]" /> De schrijver denkt na…
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {/* Invoer */}
      <div className="border-t border-[var(--color-line)] p-3">
        {err ? <p className="mb-2 text-2xs text-[var(--color-bad)]">{err}</p> : null}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={2}
            placeholder="Typ je bericht… (Enter om te versturen, Shift+Enter voor een nieuwe regel)"
            disabled={pending}
            className="min-h-0 flex-1 resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand-500)] focus:outline-none"
          />
          <button type="button" onClick={() => send(input)} disabled={pending || !input.trim()} className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3.5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
