"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MapPin, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { formatTs } from "./chat-panel";
import type { EditorData } from "./editor-view";

type Draft = { id: string; atS: number; text: string };

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Schuifbalk onder de preview: door de video bladeren, per moment een
 * opmerking plaatsen en alle opmerkingen in één bericht versturen.
 * Niet verstuurde opmerkingen blijven per project bewaard in deze browser.
 */
export function TimelinePanel({
  projectId,
  videoRef,
  timeline,
  canRun,
  busy,
  pending,
  onSend,
}: {
  projectId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  timeline: NonNullable<EditorData["timeline"]>;
  canRun: boolean;
  busy: boolean;
  pending: boolean;
  onSend: (text: string, after: () => void) => void;
}) {
  const storeKey = `ai-editor-drafts:${projectId}`;
  const dur = Math.max(0.1, timeline.durationS);
  const [t, setT] = useState(0);
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(storeKey) : null;
      return raw ? (JSON.parse(raw) as Draft[]) : [];
    } catch { return []; }
  });
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    try { window.sessionStorage.setItem(storeKey, JSON.stringify(drafts)); } catch { /* opslag niet beschikbaar */ }
  }, [drafts, storeKey]);

  // Meelopen met de video (vloeiend tijdens afspelen).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => { if (!dragging.current) setT(v.currentTime); if (!v.paused) raf = requestAnimationFrame(tick); };
    const onPlay = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const onSync = () => { if (!dragging.current) setT(v.currentTime); };
    v.addEventListener("play", onPlay);
    v.addEventListener("seeked", onSync);
    v.addEventListener("timeupdate", onSync);
    return () => { cancelAnimationFrame(raf); v.removeEventListener("play", onPlay); v.removeEventListener("seeked", onSync); v.removeEventListener("timeupdate", onSync); };
  }, [videoRef]);

  const seek = useCallback((s: number) => {
    const x = Math.min(dur, Math.max(0, s));
    setT(x);
    const v = videoRef.current;
    if (v) { if (!v.paused) v.pause(); v.currentTime = x; }
  }, [dur, videoRef]);

  function fromPointer(clientX: number) {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    seek(((clientX - r.left) / r.width) * dur);
  }

  function addDraft() {
    const text = note.trim();
    if (!text) return;
    setDrafts((d) => [...d, { id: `${Date.now()}-${d.length}`, atS: round1(t), text }].sort((a, b) => a.atS - b.atS));
    setNote("");
  }

  function sendAll() {
    if (!drafts.length) return;
    const msg = drafts.map((d) => `[${formatTs(d.atS)}] ${d.text}`).join("\n");
    onSend(msg, () => setDrafts([]));
  }

  const pct = (s: number) => `${(Math.min(dur, Math.max(0, s)) / dur) * 100}%`;
  const caption = timeline.captions.find((c) => t >= c.startS && t < c.endS);
  const sentence = timeline.sentences.find((s) => t >= s.startS && t < s.endS);
  const step = dur > 30 ? 5 : dur > 12 ? 2 : 1;
  const ticks = Array.from({ length: Math.floor(dur) + 1 }, (_, i) => i);

  return (
    <div className="border-t border-[var(--color-line)] px-4 py-3">
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="font-semibold tabular-nums text-[var(--color-ink)]">{formatTs(t)} <span className="font-normal text-[var(--color-ink-faint)]">/ {formatTs(dur)}</span></span>
        <span className="text-[var(--color-ink-faint)]">{sentence ? `Zin ${sentence.n}` : ""}</span>
      </div>

      {/* Spoor: zinnen, kaarten, b-roll, opmerkingen en de afspeelkop */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Tijdlijn van de video"
        aria-valuemin={0}
        aria-valuemax={round1(dur)}
        aria-valuenow={round1(t)}
        aria-valuetext={formatTs(t)}
        className="relative h-14 cursor-pointer touch-none select-none rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e.clientX); }}
        onPointerMove={(e) => { if (dragging.current) fromPointer(e.clientX); }}
        onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { e.preventDefault(); seek(t - (e.shiftKey ? 1 : 0.1)); }
          else if (e.key === "ArrowRight") { e.preventDefault(); seek(t + (e.shiftKey ? 1 : 0.1)); }
        }}
      >
        {timeline.sentences.map((s, i) => (
          <div key={`s${i}`} className={`absolute top-1 h-5 overflow-hidden rounded-[3px] px-1 text-[10px] leading-5 text-[var(--color-ink-muted)] ${i % 2 ? "bg-[var(--color-brand-500)]/15" : "bg-[var(--color-brand-500)]/25"}`} style={{ left: pct(s.startS), width: `calc(${pct(s.endS - s.startS)} - 1px)` }} title={`Zin ${s.n}`}>
            {s.n}
          </div>
        ))}
        {timeline.cards.map((c, i) => (
          <div key={`c${i}`} className="absolute top-7 h-1.5 rounded-full bg-[#7c5cff]/70" style={{ left: pct(c.startS), width: pct(c.endS - c.startS) }} title={`Kaart: ${c.title}`} />
        ))}
        {timeline.broll.map((b, i) => (
          <div key={`b${i}`} className="absolute top-9.5 h-1.5 rounded-full bg-[#e08a00]/70" style={{ left: pct(b.startS), width: pct(b.endS - b.startS) }} title="B-roll" />
        ))}
        {ticks.map((s) => (
          <div key={`t${s}`} className="absolute bottom-0 w-px bg-[var(--color-ink-faint)]/50" style={{ left: pct(s), height: s % step === 0 ? 6 : 3 }} />
        ))}
        {drafts.map((d) => (
          <button
            key={d.id}
            type="button"
            className="absolute -top-1 z-10 -translate-x-1/2 text-[#d4380d]"
            style={{ left: pct(d.atS) }}
            title={`${formatTs(d.atS)}: ${d.text}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => seek(d.atS)}
          >
            <MapPin className="size-3.5 fill-current" />
          </button>
        ))}
        <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-[var(--color-ink)]" style={{ left: pct(t) }}>
          <div className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-[var(--color-ink)]" />
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-[var(--color-ink-faint)]">
        {ticks.filter((s) => s % step === 0).map((s) => <span key={s}>{s}s</span>)}
      </div>

      <div className="mt-2 flex items-center gap-1">
        <StepBtn label="1 seconde terug" onClick={() => seek(t - 1)}><ChevronsLeft className="size-4" /></StepBtn>
        <StepBtn label="0,1 seconde terug" onClick={() => seek(t - 0.1)}><ChevronLeft className="size-4" /></StepBtn>
        <StepBtn label="0,1 seconde verder" onClick={() => seek(t + 0.1)}><ChevronRight className="size-4" /></StepBtn>
        <StepBtn label="1 seconde verder" onClick={() => seek(t + 1)}><ChevronsRight className="size-4" /></StepBtn>
        <p className="ml-2 min-w-0 flex-1 truncate text-xs text-[var(--color-ink-muted)]" title={caption?.text}>
          {caption ? <>&ldquo;{caption.text}&rdquo;</> : <span className="text-[var(--color-ink-faint)]">geen tekst op dit moment</span>}
        </p>
      </div>

      {canRun ? (
        <>
          <div className="mt-2 flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); addDraft(); } }}
              placeholder={`Opmerking op ${formatTs(t)}, bijv. "zoom eruit"`}
              className="sc-input min-w-0 flex-1 text-sm"
              aria-label={`Opmerking op ${formatTs(t)}`}
            />
            <Button size="sm" variant="secondary" disabled={!note.trim()} onClick={addDraft}><MapPin className="size-4" /> Plaats</Button>
          </div>

          {drafts.length ? (
            <div className="mt-3">
              <ul className="space-y-1">
                {drafts.map((d) => (
                  <li key={d.id} className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-2 py-1.5 text-xs">
                    <button type="button" className="shrink-0 font-semibold tabular-nums text-[var(--color-brand-600,#0b7fd0)] hover:underline" onClick={() => seek(d.atS)}>{formatTs(d.atS)}</button>
                    <span className="min-w-0 flex-1 text-[var(--color-ink)]">{d.text}</span>
                    <button type="button" className="shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Opmerking verwijderen" onClick={() => setDrafts((x) => x.filter((y) => y.id !== d.id))}><Trash2 className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
              <Button size="sm" className="mt-2 w-full" disabled={busy || pending} onClick={sendAll}>
                <Send className="size-4" /> {drafts.length === 1 ? "Opmerking versturen" : `Alle ${drafts.length} opmerkingen versturen`}
              </Button>
              {busy ? <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">Even wachten tot de vorige aanpassing klaar is. Je opmerkingen blijven staan.</p> : null}
            </div>
          ) : (
            <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">Schuif naar een moment, typ wat er anders moet en druk op Enter. Verzamel zo opmerkingen op meerdere momenten en verstuur ze samen.</p>
          )}
        </>
      ) : null}
    </div>
  );
}

function StepBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]">
      {children}
    </button>
  );
}
