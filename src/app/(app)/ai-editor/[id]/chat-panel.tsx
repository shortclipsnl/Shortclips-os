"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Clock, HelpCircle, Loader2, Send, X } from "lucide-react";
import { Badge, Button } from "@/components/ui";

export type ChatMessage = {
  id: string;
  text: string;
  status: string;
  response: string | null;
  createdAt: string;
  version: number | null;
  points: Array<{ text: string; atS: number | null; status: string; reply: string }> | null;
};

export function formatTs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const whole = Math.floor(sec);
  const tenth = Math.floor((sec - whole) * 10);
  return `${m}:${String(whole).padStart(2, "0")}${tenth ? `.${tenth}` : ""}`;
}

const TAG_SPLIT = /(\[\s*\d+:\d{1,2}(?:[.,]\d+)?\s*\])/g;

/** Tekst met klikbare tijdstippen ("[0:12]" springt in de preview naar 0:12). */
function WithTimestamps({ text, onSeek }: { text: string; onSeek: (s: number) => void }) {
  return (
    <>
      {text.split(TAG_SPLIT).map((part, i) => {
        const m = part.match(/^\[\s*(\d+):(\d{1,2}(?:[.,]\d+)?)\s*\]$/);
        if (!m) return <span key={i}>{part}</span>;
        const s = Number(m[1]) * 60 + Number(m[2].replace(",", "."));
        return (
          <button key={i} type="button" onClick={() => onSeek(s)} className="mx-0.5 rounded bg-[var(--color-brand-500)]/10 px-1 font-medium text-[var(--color-brand-600,#0b7fd0)] hover:underline">
            {part.replace(/[[\]\s]/g, "")}
          </button>
        );
      })}
    </>
  );
}

const POINT_ICON: Record<string, { icon: typeof Check; cls: string; label: string }> = {
  done: { icon: Check, cls: "text-[var(--color-good,#1f8a4c)]", label: "Aangepast" },
  partial: { icon: Check, cls: "text-[#8a5300]", label: "Deels aangepast" },
  skipped: { icon: X, cls: "text-[#8a5300]", label: "Niet aangepast" },
  question: { icon: HelpCircle, cls: "text-[var(--color-brand-500)]", label: "Vraag" },
  not_understood: { icon: AlertTriangle, cls: "text-[#8a5300]", label: "Niet begrepen" },
};

/**
 * Chat met de editor: het team schrijft in gewone taal wat er anders moet.
 * Staat de preview op pauze, dan gaat het tijdstip automatisch mee.
 */
export function ChatPanel({
  messages,
  canRun,
  busy,
  pending,
  pausedAt,
  getTime,
  onSeek,
  onSend,
}: {
  messages: ChatMessage[];
  canRun: boolean;
  busy: boolean;
  pending: boolean;
  /** Tijdstip waarop de preview gepauzeerd staat (null = speelt of staat aan het begin). */
  pausedAt: number | null;
  getTime: () => number | null;
  onSeek: (s: number) => void;
  onSend: (text: string, after: () => void) => void;
}) {
  const [text, setText] = useState("");
  const [useTs, setUseTs] = useState(true);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Naar het nieuwste bericht scrollen.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function insertTimestamp() {
    const t = getTime();
    if (t == null) return;
    const tag = `[${formatTs(t)}] `;
    const el = areaRef.current;
    const pos = el?.selectionStart ?? text.length;
    // Midden in een regel: op een nieuwe regel beginnen, zodat het een eigen punt wordt.
    const atLineStart = pos === 0 || text[pos - 1] === "\n";
    const insert = atLineStart ? tag : `\n${tag}`;
    const next = text.slice(0, pos) + insert + text.slice(pos);
    setText(next);
    setUseTs(false);
    requestAnimationFrame(() => {
      el?.focus();
      const p = pos + insert.length;
      el?.setSelectionRange(p, p);
    });
  }

  function send() {
    let msg = text.trim();
    if (!msg) return;
    // Tijdstip van de gepauzeerde preview meesturen als het bericht er zelf geen heeft.
    if (useTs && pausedAt != null && !/^\s*\[\s*\d+:\d/.test(msg)) msg = `[${formatTs(pausedAt)}] ${msg}`;
    onSend(msg, () => { setText(""); setUseTs(true); });
  }

  const last = messages[messages.length - 1];
  const working = busy && last && last.status === "queued";

  return (
    <div className="flex flex-col">
      <div ref={listRef} className="max-h-[420px] min-h-[120px] space-y-3 overflow-y-auto px-4 py-3">
        {!messages.length ? (
          <div className="text-xs text-[var(--color-ink-muted)]">
            <p>Schrijf hier wat er anders moet, in gewone taal. Meerdere punten mag, op losse regels. Pauzeer de preview om een tijdstip mee te sturen.</p>
            <p className="mt-2 text-[var(--color-ink-faint)]">Bijv. &ldquo;zoom eruit&rdquo; op een gepauzeerd moment, &ldquo;zin 3 mag eruit&rdquo;, &ldquo;muziek iets zachter&rdquo; of &ldquo;&apos;shortclip&apos; moet &apos;Shortclips&apos;&rdquo;.</p>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className="space-y-1.5">
            <div className="ml-8 rounded-[var(--radius-sm)] rounded-tr-none bg-[var(--color-brand-500)]/10 px-3 py-2 text-sm text-[var(--color-ink)]">
              <p className="whitespace-pre-wrap"><WithTimestamps text={m.text} onSeek={onSeek} /></p>
            </div>
            <div className="mr-8 rounded-[var(--radius-sm)] rounded-tl-none bg-[var(--color-surface-sunken)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
              {m.status === "queued" ? (
                <p className="flex items-center gap-1.5">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Clock className="size-3.5" />} {busy ? "Bezig met verwerken…" : "In de wachtrij"}</p>
              ) : m.points?.length ? (
                <ul className="space-y-1.5">
                  {m.points.map((p, i) => {
                    const st = POINT_ICON[p.status] ?? POINT_ICON.not_understood;
                    const Icon = st.icon;
                    return (
                      <li key={i} className="flex gap-1.5">
                        <Icon className={`mt-0.5 size-3.5 shrink-0 ${st.cls}`} aria-label={st.label} />
                        <span>
                          {m.points!.length > 1 ? <span className="text-[var(--color-ink-faint)]">{p.atS != null ? `[${formatTs(p.atS)}] ` : ""}{p.text.length > 50 ? `${p.text.slice(0, 50)}…` : p.text}: </span> : null}
                          <span className={p.status === "question" ? "font-medium text-[var(--color-ink)]" : ""}>{p.reply}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="whitespace-pre-wrap">{m.response ?? (m.status === "failed" ? "Verwerken mislukt." : "")}</p>
              )}
              {m.version && (m.status === "applied" || m.status === "partial") ? <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">Versie {m.version}</p> : null}
            </div>
          </div>
        ))}
      </div>

      {canRun ? (
        <div className="border-t border-[var(--color-line)] px-4 py-3">
          <textarea
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy && !pending) send(); }
            }}
            rows={3}
            disabled={busy}
            placeholder={busy ? "Even wachten tot de vorige aanpassing klaar is…" : "Wat moet er anders? Enter = versturen, Shift+Enter = nieuwe regel"}
            className="sc-input w-full resize-y text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {pausedAt != null && useTs ? (
              <Badge tone="info">
                <Clock className="size-3" /> Tijdstip {formatTs(pausedAt)} gaat mee
                <button type="button" className="ml-1 opacity-70 hover:opacity-100" onClick={() => setUseTs(false)} aria-label="Tijdstip niet meesturen"><X className="size-3" /></button>
              </Badge>
            ) : null}
            <button type="button" onClick={insertTimestamp} disabled={busy} className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" title="Huidig tijdstip van de preview in je bericht zetten">
              <Clock className="size-3.5" /> Tijdstip invoegen
            </button>
            <Button size="sm" className="ml-auto" disabled={pending || busy || !text.trim()} onClick={send}>
              {working ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Versturen
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
