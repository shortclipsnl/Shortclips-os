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

/** Verwijdert een eventueel aangestreept citaat ("> …") uit de body voor de pin-preview. */
function stripQuote(body: string): string {
  return body.replace(/^(?:>[^\n]*\n?)+/, "").trim() || body;
}

/**
 * Interactieve script-PDF-viewer. Rendert de PDF (pdf.js) pagina-voor-pagina
 * zodra die in beeld komt (snel laden), met een selecteerbare tekstlaag zodat de
 * klant een specifieke zin kan aanstrepen en daar direct feedback aan kan hangen.
 * Ook klikken/tikken op een plek plaatst een opmerking. Bestaande opmerking-pins
 * staan op de juiste pagina/positie. Intern wordt dezelfde viewer alleen-lezen
 * gebruikt (canAnnotate=false).
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
  const [aspect, setAspect] = useState(1.414); // hoogte/breedte (A4-staand standaard)
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
        // Verhouding van de eerste pagina → nette placeholders vóórdat elke pagina rendert.
        try {
          const p1 = await loaded.getPage(1);
          const vp = p1.getViewport({ scale: 1 });
          if (!cancelled && vp.width > 0) setAspect(vp.height / vp.width);
        } catch { /* standaard A4 */ }
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
      {canAnnotate ? (
        <div className="mb-3 flex items-start gap-2.5 rounded-[12px] border border-[#2e90fa]/30 bg-[rgba(46,144,250,0.08)] p-3 text-[13px]">
          <MessageSquarePlus className="mt-0.5 size-4 shrink-0 text-[var(--sc-accent)]" />
          <span className="text-[var(--color-ink-muted)]">
            <strong className="text-[var(--color-ink)]">Selecteer een zin</strong> in het script (of tik op een plek) om daar direct feedback aan te koppelen. Je opmerkingen verschijnen in de kolom hiernaast — klik daar op <strong className="text-[var(--color-ink)]">Feedback doorgeven</strong> om ze in te dienen.
          </span>
        </div>
      ) : null}

      <div className="sticky top-0 z-20 mb-3 flex items-center justify-between gap-2 rounded-[12px] border border-[var(--sc-line)] bg-[var(--sc-header-bg)] px-3 py-2 backdrop-blur">
        <span className="text-[12px] text-[var(--color-ink-muted)]">
          {numPages > 0 ? `${numPages} pagina${numPages === 1 ? "" : "'s"}` : "PDF"}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Uitzoomen" onClick={() => setScale((s) => Math.max(0.6, Math.round((s - 0.15) * 100) / 100))}
            className="grid size-8 place-items-center rounded-[8px] border border-[var(--sc-line)] hover:bg-[var(--sc-fill-strong)]"><Minus className="size-4" /></button>
          <span className="w-12 text-center text-[12px] tabular-nums text-[var(--color-ink-muted)]">{Math.round(scale * 100)}%</span>
          <button type="button" aria-label="Inzoomen" onClick={() => setScale((s) => Math.min(2.4, Math.round((s + 0.15) * 100) / 100))}
            className="grid size-8 place-items-center rounded-[8px] border border-[var(--sc-line)] hover:bg-[var(--sc-fill-strong)]"><Plus className="size-4" /></button>
        </div>
      </div>

      <div className="max-h-[80vh] overflow-auto rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-ink-muted)]"><Loader2 className="size-4 animate-spin" /> PDF laden…</div>
        ) : error ? (
          <p className="py-16 text-center text-sm text-[var(--color-ink-muted)]">{error}</p>
        ) : (
          <div className="flex flex-col items-center gap-5">
            {Array.from({ length: numPages }, (_, i) => (
              <ReviewPage key={i} doc={doc} pageNumber={i + 1} scale={scale} aspect={aspect} reviewId={reviewId} pins={byPage(i + 1)} canAnnotate={canAnnotate} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type Draft = { x: number; y: number; quote?: string } | null;

function ReviewPage({ doc, pageNumber, scale, aspect, reviewId, pins, canAnnotate }: { doc: any; pageNumber: number; scale: number; aspect: number; reviewId: string; pins: ReviewPin[]; canAnnotate: boolean }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(pageNumber === 1); // eerste pagina meteen
  const [rendered, setRendered] = useState(false);
  const [width, setWidth] = useState(0);
  const [draft, setDraft] = useState<Draft>(null);
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [sel, setSel] = useState<{ x: number; y: number; quote: string } | null>(null);

  // Lazy: pas renderen zodra de pagina (bijna) in beeld komt.
  useEffect(() => {
    if (visible) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { root: null, rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // Canvas + tekstlaag renderen (bij zichtbaar worden en bij zoomwijziging).
  useEffect(() => {
    if (!doc || !visible) return;
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
      if (!cancelled) setWidth(Math.floor(viewport.width));
      task = page.render({ canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      try { await task.promise; } catch { /* geannuleerd */ }
      if (cancelled) return;

      // Tekstlaag (selecteerbaar) exact over de canvas.
      const layer = textLayerRef.current;
      if (layer) {
        layer.innerHTML = "";
        layer.style.width = `${Math.floor(viewport.width)}px`;
        layer.style.height = `${Math.floor(viewport.height)}px`;
        layer.style.setProperty("--scale-factor", String(scale));
        try {
          const pdfjs = await import("pdfjs-dist");
          const textContent = await page.getTextContent();
          if (cancelled) return;
          const tl = new (pdfjs as any).TextLayer({ textContentSource: textContent, container: layer, viewport });
          await tl.render();
        } catch { /* tekstlaag optioneel — selectie werkt dan niet, canvas wel */ }
      }
      if (!cancelled) setRendered(true);
    })();
    return () => { cancelled = true; if (task) { try { task.cancel(); } catch { /* ignore */ } } };
  }, [doc, pageNumber, scale, visible]);

  function onPageClick(e: React.MouseEvent) {
    if (!canAnnotate || !rendered) return;
    if ((e.target as HTMLElement).closest("[data-pin],[data-popover]")) return;
    // Lopende tekstselectie? Dan niet als los klikpunt behandelen.
    const s = window.getSelection();
    if (s && !s.isCollapsed && s.toString().trim()) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(0.999, Math.max(0.001, (e.clientX - rect.left) / rect.width));
    const y = Math.min(0.999, Math.max(0.001, (e.clientY - rect.top) / rect.height));
    setSel(null);
    setOpenPin(null);
    setDraft({ x, y });
  }

  // Tekstselectie → "Feedback op deze zin"-knop bij de selectie.
  function onMouseUp() {
    if (!canAnnotate) return;
    const s = window.getSelection();
    const text = s?.toString().trim() ?? "";
    if (!s || s.isCollapsed || text.length < 2) return;
    const anchorEl = s.anchorNode?.parentElement;
    if (!anchorEl || !textLayerRef.current?.contains(anchorEl)) return;
    const wrap = wrapRef.current?.getBoundingClientRect();
    const r = s.getRangeAt(0).getBoundingClientRect();
    if (!wrap || r.width === 0) return;
    const x = Math.min(0.98, Math.max(0.02, (r.left + r.width / 2 - wrap.left) / wrap.width));
    const y = Math.min(0.98, Math.max(0.02, (r.bottom - wrap.top) / wrap.height));
    setDraft(null);
    setOpenPin(null);
    setSel({ x, y, quote: text.replace(/\s+/g, " ").slice(0, 300) });
  }

  return (
    <div
      ref={wrapRef}
      className={`relative inline-block w-full max-w-[720px] ${canAnnotate && rendered ? "cursor-crosshair" : ""}`}
      style={!rendered ? { aspectRatio: `1 / ${aspect}` } : undefined}
      onMouseUp={onMouseUp}
      onClick={onPageClick}
    >
      {!rendered ? (
        <div className="absolute inset-0 grid place-items-center rounded-[6px] bg-white/60 text-[12px] text-[var(--color-ink-faint)]">
          <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> pagina {pageNumber}…</span>
        </div>
      ) : null}
      <canvas ref={canvasRef} className="block max-w-full rounded-[6px] bg-white shadow-[0_6px_20px_-8px_rgba(0,0,0,0.6)]" />
      {/* Selecteerbare tekstlaag exact over de canvas (z-2). */}
      <div ref={textLayerRef} className="sc-textlayer" style={{ width: width || undefined }} />
      {/* Pins + nieuwe-opmerking-popovers erboven (z-5). */}
      <div className="pointer-events-none absolute inset-0 z-[5]">
        {pins.map((p, idx) => (
          <div key={p.id} className="pointer-events-auto">
            <Pin index={idx + 1} pin={p} open={openPin === p.id} onToggle={() => { setDraft(null); setSel(null); setOpenPin((v) => (v === p.id ? null : p.id)); }} />
          </div>
        ))}
        {draft ? (
          <div className="pointer-events-auto" data-popover>
            <NewComment reviewId={reviewId} pageNumber={pageNumber} x={draft.x} y={draft.y} onClose={() => setDraft(null)} />
          </div>
        ) : null}
        {sel ? (
          <div className="pointer-events-auto" data-popover>
            <NewComment reviewId={reviewId} pageNumber={pageNumber} x={sel.x} y={sel.y} quote={sel.quote} onClose={() => setSel(null)} />
          </div>
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
    <div data-pin className="absolute z-[5] -translate-x-1/2 -translate-y-1/2" style={pinStyle(pin.posX!, pin.posY!)}>
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
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-ink)]">{stripQuote(c.body)}</p>
              <p className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">{c.authorName ?? "Jij"} · {when(c.createdAt)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NewComment({ reviewId, pageNumber, x, y, quote, onClose }: { reviewId: string; pageNumber: number; x: number; y: number; quote?: string; onClose: () => void }) {
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const alignRight = x > 0.6;

  function save() {
    setErr(null);
    // Het aangestreepte citaat wordt als "> …" mee opgeslagen, zodat duidelijk is
    // op welke zin de opmerking slaat.
    const full = quote ? `> ${quote}\n${body.trim()}` : body.trim();
    start(async () => {
      const res = await addScriptReviewComment({ reviewId, pageNumber, posX: x, posY: y, body: full });
      if (res.ok) { onClose(); router.refresh(); }
      else setErr(res.message ?? "Opslaan mislukt.");
    });
  }

  return (
    <div className="absolute z-40 -translate-y-1/2" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} onClick={(e) => e.stopPropagation()}>
      <span className="absolute -left-1.5 -top-1.5 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#ff6a00] text-white ring-2 ring-white/70"><MessageSquarePlus className="size-3.5" /></span>
      <div className={`w-72 max-w-[80vw] rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)] ${alignRight ? "-translate-x-full -ml-2" : "ml-2"}`}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{quote ? "Feedback op deze zin" : "Opmerking"} · pagina {pageNumber}</span>
          <button type="button" onClick={onClose} className="rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><X className="size-4" /></button>
        </div>
        {quote ? (
          <p className="mb-2 border-l-2 border-[#ff6a00] bg-[rgba(255,106,0,0.08)] px-2 py-1 text-[12px] italic leading-snug text-[var(--color-ink-muted)]">“{quote.length > 160 ? `${quote.slice(0, 160)}…` : quote}”</p>
        ) : null}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          autoFocus
          maxLength={4000}
          placeholder={quote ? "Wat moet er met deze zin gebeuren?" : "Wat moet hier aangepast worden?"}
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
