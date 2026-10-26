"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageSquarePlus, Minus, Plus, X } from "lucide-react";
import { addScriptReviewComment } from "@/server/actions/script-review";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ReviewPin = {
  id: string;
  pageNumber: number | null;
  posX: number | null;
  posY: number | null;
  isResolved: boolean;
  authorName: string | null;
  comments: Array<{ id: string; body: string; authorName: string | null; createdAt: string }>;
};

/**
 * Interactieve script-PDF-viewer. Rendert de PDF (pdf.js), toont de bestaande
 * opmerking-pins op de juiste pagina/positie en laat de klant op een plek klikken
 * om direct een opmerking te plaatsen. Werkt op desktop en mobiel (pins en
 * popovers schalen mee met de pagina). Intern wordt dezelfde viewer alleen-lezen
 * gebruikt (canAnnotate=false) zodat medewerkers zien wáár een opmerking staat.
 */
export function ScriptPdfReview({
  url,
  reviewId,
  pins,
  canAnnotate,
}: {
  url: string;
  reviewId: string;
  pins: ReviewPin[];
  canAnnotate: boolean;
}) {
  const [doc, setDoc] = useState<any | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: any = null;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
        loaded = await pdfjs.getDocument({ url, withCredentials: true }).promise;
        if (cancelled) { loaded.destroy(); return; }
        setDoc(loaded);
        setNumPages(loaded.numPages);
      } catch {
        if (!cancelled) setError("De PDF kon niet worden geladen. Ververs de pagina.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; if (loaded) loaded.destroy(); };
  }, [url]);

  const byPage = (n: number) => pins.filter((p) => p.pageNumber === n && p.posX != null && p.posY != null);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-20 mb-3 flex items-center justify-between gap-2 rounded-[12px] border border-white/10 bg-[rgba(10,12,38,0.9)] px-3 py-2 backdrop-blur">
        <span className="text-[12px] text-[var(--color-ink-muted)]">
          {numPages > 0 ? `${numPages} pagina${numPages === 1 ? "" : "'s"}` : "PDF"}
          {canAnnotate ? <span className="ml-2 hidden text-[var(--color-ink-faint)] sm:inline">· klik op de PDF om een opmerking te plaatsen</span> : null}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Uitzoomen" onClick={() => setScale((s) => Math.max(0.6, Math.round((s - 0.15) * 100) / 100))}
            className="grid size-8 place-items-center rounded-[8px] border border-white/10 hover:bg-white/10"><Minus className="size-4" /></button>
          <span className="w-12 text-center text-[12px] tabular-nums text-[var(--color-ink-muted)]">{Math.round(scale * 100)}%</span>
          <button type="button" aria-label="Inzoomen" onClick={() => setScale((s) => Math.min(2.4, Math.round((s + 0.15) * 100) / 100))}
            className="grid size-8 place-items-center rounded-[8px] border border-white/10 hover:bg-white/10"><Plus className="size-4" /></button>
        </div>
      </div>

      {canAnnotate ? (
        <p className="mb-2 text-[12px] text-[#4bc4ff] sm:hidden">Tik op de PDF om een opmerking te plaatsen.</p>
      ) : null}

      <div className="max-h-[80vh] overflow-auto rounded-[14px] border border-white/10 bg-[rgba(4,6,20,0.6)] p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-ink-muted)]"><Loader2 className="size-4 animate-spin" /> PDF laden…</div>
        ) : error ? (
          <p className="py-16 text-center text-sm text-[var(--color-ink-muted)]">{error}</p>
        ) : (
          <div className="flex flex-col items-center gap-5">
            {Array.from({ length: numPages }, (_, i) => (
              <ReviewPage key={i} doc={doc} pageNumber={i + 1} scale={scale} reviewId={reviewId} pins={byPage(i + 1)} canAnnotate={canAnnotate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type Draft = { x: number; y: number } | null;

function ReviewPage({ doc, pageNumber, scale, reviewId, pins, canAnnotate }: { doc: any; pageNumber: number; scale: number; reviewId: string; pins: ReviewPin[]; canAnnotate: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [openPin, setOpenPin] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let task: any = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = "auto";
      task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      try { await task.promise; } catch { /* geannuleerd */ }
    })();
    return () => { cancelled = true; if (task) { try { task.cancel(); } catch { /* ignore */ } } };
  }, [doc, pageNumber, scale]);

  function onOverlayClick(e: React.MouseEvent) {
    if (!canAnnotate) return;
    if ((e.target as HTMLElement).closest("[data-pin]")) return; // klik op een pin: niet nieuw
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(0.999, Math.max(0.001, (e.clientX - rect.left) / rect.width));
    const y = Math.min(0.999, Math.max(0.001, (e.clientY - rect.top) / rect.height));
    setOpenPin(null);
    setDraft({ x, y });
  }

  return (
    <div className="relative inline-block max-w-full">
      <canvas ref={canvasRef} className="block max-w-full rounded-[6px] bg-white shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)]" />
      <div
        ref={overlayRef}
        onClick={onOverlayClick}
        className={`absolute inset-0 ${canAnnotate ? "cursor-crosshair" : ""}`}
      >
        {/* Bestaande pins */}
        {pins.map((p, idx) => (
          <Pin key={p.id} index={idx + 1} pin={p} open={openPin === p.id} onToggle={() => { setDraft(null); setOpenPin((v) => (v === p.id ? null : p.id)); }} />
        ))}
        {/* Nieuwe opmerking */}
        {draft ? (
          <NewComment reviewId={reviewId} pageNumber={pageNumber} x={draft.x} y={draft.y} onClose={() => setDraft(null)} />
        ) : null}
      </div>
    </div>
  );
}

function pinStyle(x: number, y: number): React.CSSProperties {
  return { left: `${x * 100}%`, top: `${y * 100}%` };
}

function Pin({ index, pin, open, onToggle }: { index: number; pin: ReviewPin; open: boolean; onToggle: () => void }) {
  const when = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  return (
    <div data-pin className="absolute -translate-x-1/2 -translate-y-1/2" style={pinStyle(pin.posX!, pin.posY!)}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={`grid size-6 place-items-center rounded-full text-[11px] font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] ring-2 ring-white/70 ${pin.isResolved ? "bg-[#2fd27a]" : "bg-[#ff6a00]"}`}
        title="Opmerking bekijken"
      >
        {pin.isResolved ? <Check className="size-3.5" /> : index}
      </button>
      {open ? (
        <div className="absolute left-1/2 top-7 z-30 w-64 max-w-[72vw] -translate-x-1/2 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-left shadow-[var(--shadow-raised,0_12px_30px_-8px_rgba(0,0,0,0.6))]" onClick={(e) => e.stopPropagation()}>
          {pin.isResolved ? <div className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#2fd27a]"><Check className="size-3.5" /> Verwerkt</div> : null}
          {pin.comments.map((c) => (
            <div key={c.id} className="mb-2 last:mb-0">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink)]">{c.body}</p>
              <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">{c.authorName ?? "Jij"} · {when(c.createdAt)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NewComment({ reviewId, pageNumber, x, y, onClose }: { reviewId: string; pageNumber: number; x: number; y: number; onClose: () => void }) {
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // Popover links/rechts uitlijnen afhankelijk van de klikpositie.
  const alignRight = x > 0.6;

  function save() {
    setErr(null);
    start(async () => {
      const res = await addScriptReviewComment({ reviewId, pageNumber, posX: x, posY: y, body });
      if (res.ok) { onClose(); router.refresh(); }
      else setErr(res.message ?? "Opslaan mislukt.");
    });
  }

  return (
    <div className="absolute z-40 -translate-y-1/2" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} onClick={(e) => e.stopPropagation()}>
      {/* Markering op het klikpunt */}
      <span className="absolute -left-1.5 -top-1.5 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#ff6a00] text-white ring-2 ring-white/70"><MessageSquarePlus className="size-3.5" /></span>
      <div className={`w-64 max-w-[74vw] rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)] ${alignRight ? "-translate-x-full -ml-2" : "ml-2"}`}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Opmerking · pagina {pageNumber}</span>
          <button type="button" onClick={onClose} className="rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><X className="size-4" /></button>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          autoFocus
          maxLength={4000}
          placeholder="Wat moet hier aangepast worden?"
          className="sc-input w-full resize-y text-sm"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="text-[12px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Annuleren</button>
          <button type="button" onClick={save} disabled={pending || !body.trim()} className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#1b6fe8] px-3 py-1.5 text-[12px] font-semibold text-white hover:brightness-110 disabled:opacity-60">
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <MessageSquarePlus className="size-3.5" />} Plaatsen
          </button>
        </div>
        {err ? <p className="mt-1.5 text-[12px] text-[var(--color-bad,#ff6b6b)]">{err}</p> : null}
      </div>
    </div>
  );
}
