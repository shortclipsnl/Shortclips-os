"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertOctagon, Check, ChevronLeft, ChevronRight, Clapperboard, List, Loader2, Mic, Pencil, Square, Trash2 } from "lucide-react";
import { addDraaiboekNoteAction, deleteDraaiboekNoteAction, finishDraaiboekAction, setDraaiboekPartAction } from "@/server/actions/draaiboek";
import type { DraaiboekNoteView, DraaiboekView } from "@/server/draaiboek/service";
import { PART_LABEL, partsFor, sessionProgress, type DraaiboekPartKey, type DraaiboekProgress, type DraaiboekVideo } from "@/server/draaiboek/types";

const SCRIPT_FONT = "font-[Arial,Helvetica,sans-serif]";

/* ---------------- Spraak: opnemen + live uitschrijven ---------------- */

type SpeechRec = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };

function speechCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const rec = useRef<SpeechRec | null>(null);
  const finalText = useRef("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const done = useRef<((b: Blob | null) => void) | null>(null);

  const start = async () => {
    setError(null);
    setTranscript("");
    finalText.current = "";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = chunks.current.length ? new Blob(chunks.current, { type: mr.mimeType || "audio/webm" }) : null;
        done.current?.(blob);
      };
      mr.start();
      media.current = mr;
      const Ctor = speechCtor();
      if (Ctor) {
        const r = new Ctor();
        r.lang = "nl-NL";
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i]!;
            if (res.isFinal) finalText.current += `${res[0].transcript.trim()} `;
            else interim += res[0].transcript;
          }
          setTranscript(`${finalText.current}${interim}`.trim());
        };
        r.onerror = () => undefined;
        try {
          r.start();
          rec.current = r;
        } catch {
          rec.current = null;
        }
      }
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setRecording(true);
    } catch {
      setError("Geen toegang tot de microfoon. Sta de microfoon toe in je browser en probeer opnieuw.");
    }
  };

  const stop = () =>
    new Promise<Blob | null>((resolve) => {
      done.current = resolve;
      if (timer.current) clearInterval(timer.current);
      try { rec.current?.stop(); } catch { /* al gestopt */ }
      setRecording(false);
      if (media.current && media.current.state !== "inactive") media.current.stop();
      else resolve(null);
    });

  return { recording, seconds, transcript, setTranscript, error, start, stop };
}

const toBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(b);
  });

function NoteComposer({ dayId, videoKey, onSaved }: { dayId: string; videoKey: string; onSaved: () => void }) {
  const r = useRecorder();
  const [kind, setKind] = useState<"notitie" | "blokkade">("notitie");
  const [audio, setAudio] = useState<{ blob: Blob; sec: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const begin = async (k: "notitie" | "blokkade") => {
    setKind(k);
    setAudio(null);
    setMsg(null);
    await r.start();
  };
  const end = async () => {
    const sec = r.seconds;
    const blob = await r.stop();
    if (blob) setAudio({ blob, sec });
  };
  const reset = () => {
    setAudio(null);
    setTyping(false);
    r.setTranscript("");
  };
  const save = () =>
    start(async () => {
      const res = await addDraaiboekNoteAction({
        productionDayId: dayId,
        videoKey,
        kind,
        text: r.transcript || null,
        audioBase64: audio ? await toBase64(audio.blob) : null,
        audioMime: audio?.blob.type || null,
        durationSec: audio?.sec ?? null,
      });
      setMsg(res.message ?? null);
      if (res.ok) {
        reset();
        onSaved();
      }
    });

  if (r.recording)
    return (
      <div className={`rounded-[var(--radius-lg)] p-4 ${kind === "blokkade" ? "bg-[var(--color-bad-soft)]" : "bg-[var(--color-surface-sunken)]"}`}>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
          <span className="size-2.5 animate-pulse rounded-full bg-[var(--color-bad)]" />
          {kind === "blokkade" ? "Blokkade inspreken" : "Notitie inspreken"} · {Math.floor(r.seconds / 60)}:{String(r.seconds % 60).padStart(2, "0")}
        </div>
        {r.transcript ? <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-ink)]">{r.transcript}</p> : <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Praat maar, je wordt opgenomen.</p>}
        <button type="button" onClick={end} className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-ink)] text-base font-semibold text-white">
          <Square className="size-4 fill-current" /> Stop
        </button>
      </div>
    );

  if (audio || typing)
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="mb-2 flex gap-2">
          {(["notitie", "blokkade"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`h-9 rounded-full px-3 text-sm font-medium ${kind === k ? (k === "blokkade" ? "bg-[var(--color-bad)] text-white" : "bg-[var(--color-ink)] text-white") : "border border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}>
              {k === "blokkade" ? "Blokkade" : "Notitie"}
            </button>
          ))}
        </div>
        {audio ? <audio controls src={URL.createObjectURL(audio.blob)} className="mb-2 w-full" /> : null}
        <textarea
          value={r.transcript}
          onChange={(e) => r.setTranscript(e.target.value)}
          placeholder={audio ? "Uitgeschreven tekst (optioneel, de opname blijft bewaard)" : "Typ je notitie"}
          rows={3}
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-line)] px-3 py-2 text-[15px]"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={reset} className="h-12 rounded-[var(--radius-md)] border border-[var(--color-line)] text-sm font-medium">Weggooien</button>
          <button type="button" disabled={pending || (!audio && !r.transcript.trim())} onClick={save} className="flex h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-ink)] text-sm font-semibold text-white disabled:opacity-50">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null} Opslaan
          </button>
        </div>
      </div>
    );

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => begin("notitie")} className="flex h-14 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 text-[14px] font-semibold text-[var(--color-ink)]">
          <Mic className="size-5 shrink-0" /> Notitie inspreken
        </button>
        <button type="button" onClick={() => begin("blokkade")} className="flex h-14 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-bad)]/40 bg-[var(--color-bad-soft)] px-2 text-[14px] font-semibold text-[#a3271c]">
          <AlertOctagon className="size-5 shrink-0" /> Blokkade inspreken
        </button>
      </div>
      <button type="button" onClick={() => setTyping(true)} className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)]">
        <Pencil className="size-3.5" /> Liever typen
      </button>
      {r.error ? <p className="mt-2 text-sm text-[var(--color-bad)]">{r.error}</p> : null}
      {msg ? <p className="mt-2 text-sm text-[var(--color-good)]">{msg}</p> : null}
    </div>
  );
}

function NoteItem({ n, dayId, canDelete, onChange }: { n: DraaiboekNoteView; dayId: string; canDelete: boolean; onChange: () => void }) {
  const [pending, start] = useTransition();
  const time = new Date(n.createdAt).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return (
    <li className={`rounded-[var(--radius-md)] border p-3 ${n.kind === "blokkade" ? "border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)]" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`}>
      <div className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
        <span className={`font-semibold ${n.kind === "blokkade" ? "text-[#a3271c]" : "text-[var(--color-ink)]"}`}>{n.kind === "blokkade" ? "Blokkade" : "Notitie"}</span>
        <span>{time}</span>
        {n.createdByName ? <span>· {n.createdByName.split(" ")[0]}</span> : null}
        {canDelete ? (
          <button type="button" disabled={pending} aria-label="Verwijderen" onClick={() => start(async () => { await deleteDraaiboekNoteAction(dayId, n.id); onChange(); })} className="ml-auto p-1 text-[var(--color-ink-faint)]">
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
      {n.summary ? <p className="mt-1 text-[15px] font-medium text-[var(--color-ink)]">{n.summary}</p> : null}
      {n.text ? <p className={`mt-1 text-[15px] leading-relaxed ${n.summary ? "text-[var(--color-ink-muted)]" : "text-[var(--color-ink)]"}`}>{n.text}</p> : null}
      {n.hasAudio ? <audio controls preload="none" src={`/api/draaiboek/notes/${n.id}/audio`} className="mt-2 w-full" /> : null}
    </li>
  );
}

/* ---------------- Draaiboek ---------------- */

function ScriptText({ text }: { text: string }) {
  return (
    <div className={`${SCRIPT_FONT} space-y-1 text-[18px] leading-[1.55] text-[var(--color-ink)]`}>
      {text.split("\n").map((l, i) => {
        const isLabel = l.length < 40 && l === l.toUpperCase() && /[A-Z]/.test(l) && !/[!?.,:;]$/.test(l) && l.split(/\s+/).length <= 4;
        return isLabel ? <p key={i} className="pt-1 font-sans text-xs font-bold tracking-wide text-[var(--color-ink-muted)]">{l}</p> : <p key={i}>{l}</p>;
      })}
    </div>
  );
}

function Hints({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-1">
      {items.map((h) => (
        <li key={h} className="flex items-start gap-2 text-[14px] leading-snug text-[var(--color-ink-muted)]">
          <Clapperboard className="mt-0.5 size-4 shrink-0" /> {h}
        </li>
      ))}
    </ul>
  );
}

function PartBlock({ label, done, onToggle, children }: { label: string; done: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className={`rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-4 ${done ? "border-[var(--color-good)]/50" : "border-[var(--color-line)]"}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-ink)]">{label}</h2>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={done}
          className={`flex h-11 min-w-[124px] items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold ${done ? "bg-[var(--color-good)] text-white" : "border-2 border-[var(--color-line-strong)] text-[var(--color-ink)]"}`}
        >
          {done ? <><Check className="size-4" strokeWidth={3} /> Afgerond</> : "Afvinken"}
        </button>
      </div>
      {children}
    </section>
  );
}

export function DraaiboekMobile({ view, initialVideo, canManage, viewerId }: { view: DraaiboekView; initialVideo?: string; canManage: boolean; viewerId: string }) {
  const router = useRouter();
  const content = view.content!;
  const videos = content.videos;
  const [idx, setIdx] = useState(() => Math.max(0, videos.findIndex((v) => v.key === initialVideo)));
  const [progress, setProgress] = useState<DraaiboekProgress>(view.progress);
  const [, start] = useTransition();
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishNote, setFinishNote] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [finishMsg, setFinishMsg] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const v: DraaiboekVideo = videos[idx]!;
  const total = useMemo(() => sessionProgress(content, progress), [content, progress]);
  const notes = view.notes.filter((n) => n.videoKey === v.key);
  const readOnly = !canManage && view.status !== "verstuurd" && !view.status?.startsWith("afgerond");

  const go = (i: number) => {
    if (i < 0 || i >= videos.length) return;
    setIdx(i);
    top.current?.scrollIntoView({ block: "start" });
  };

  // Swipen tussen video's.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("textarea,input,audio,button")) return;
    touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.changedTouches[0]!.clientX - t.x;
    const dy = e.changedTouches[0]!.clientY - t.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(idx + (dx < 0 ? 1 : -1));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("textarea,input")) return;
      if (e.key === "ArrowRight") go(idx + 1);
      if (e.key === "ArrowLeft") go(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggle = (part: DraaiboekPartKey) => {
    if (readOnly) return;
    const was = Boolean(progress[v.key]?.[part]);
    const next = { ...progress, [v.key]: { ...(progress[v.key] ?? {}) } };
    if (was) delete next[v.key]![part];
    else next[v.key]![part] = true;
    setProgress(next);
    start(async () => {
      const res = await setDraaiboekPartAction(view.day.id, v.key, part, !was);
      if (!res.ok) setProgress(progress);
    });
  };

  const parts = partsFor(v);
  const videoDone = parts.length > 0 && parts.every((k) => progress[v.key]?.[k]);
  const isFinished = view.status === "afgerond" || view.status === "afgerond_open";
  const open = total.total - total.done;

  const finish = async () => {
    setFinishing(true);
    const res = await finishDraaiboekAction(view.day.id, finishNote || null);
    setFinishing(false);
    setFinishMsg(res.message ?? null);
    if (res.ok) {
      setFinishOpen(false);
      router.refresh();
    }
  };

  return (
    <div className="mx-auto max-w-[620px] pb-20" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div ref={top} className="scroll-mt-40" />
      {/* Kop: sessie, één voortgangsbalk en navigatie tussen video's. */}
      <div className="sticky top-16 z-20 -mx-5 border-b border-[var(--color-line)] bg-[var(--color-surface)]/95 px-3 pb-3 pt-2 backdrop-blur sm:mx-0 sm:rounded-b-[var(--radius-lg)]">
        <div className="flex items-center gap-2">
          <Link href="/draaiboek" aria-label="Mijn opnames" className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--color-ink)]"><List className="size-5" /></Link>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-xs text-[var(--color-ink-muted)]">{view.day.clientName} · {new Date(`${view.day.scheduledOn}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}</div>
            <div className="text-[13px] font-semibold text-[var(--color-ink)]">Voortgang opname · {total.pct}%</div>
          </div>
          <span className="size-11 shrink-0" />
        </div>
        <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" role="progressbar" aria-valuenow={total.pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-[var(--color-good)] transition-[width] duration-300" style={{ width: `${total.pct}%` }} />
        </div>
        <div className="mt-2 flex items-center gap-1">
          <button type="button" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Vorige video" className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--color-ink)] disabled:opacity-25"><ChevronLeft className="size-6" /></button>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-xs text-[var(--color-ink-muted)]">Video {v.nr} van {videos.length}</div>
            <div className="line-clamp-2 text-base font-bold leading-snug text-[var(--color-ink)]">{v.titel}</div>
          </div>
          <button type="button" onClick={() => go(idx + 1)} disabled={idx === videos.length - 1} aria-label="Volgende video" className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--color-ink)] disabled:opacity-25"><ChevronRight className="size-6" /></button>
        </div>
      </div>

      {readOnly ? <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-warn-soft)] p-3 text-sm text-[#5c3700]">Dit draaiboek wordt nog gecontroleerd.</p> : null}
      {canManage && view.status === "concept" ? (
        <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-warn-soft)] p-3 text-sm text-[#5c3700]">Voorbeeld: dit draaiboek is nog niet verstuurd. <Link href={`/draaiboek/${view.day.id}/controle`} className="font-semibold underline">Naar controle</Link></p>
      ) : null}

      <p className="mt-4 text-[13px] text-[var(--color-ink-faint)]">Shotaanwijzingen geven richting. Camerastandpunten en uitvoering kies je zelf.</p>

      <div className="mt-3 space-y-3">
        {parts.filter((k) => k !== "broll").map((k) => (
          <PartBlock key={k} label={PART_LABEL[k]} done={Boolean(progress[v.key]?.[k])} onToggle={() => toggle(k)}>
            {v[k as "hook" | "middenstuk" | "cta"].tekst ? <ScriptText text={v[k as "hook" | "middenstuk" | "cta"].tekst} /> : null}
            <Hints items={v[k as "hook" | "middenstuk" | "cta"].aanwijzingen} />
          </PartBlock>
        ))}
        {v.broll.length ? (
          <PartBlock label="B-roll" done={Boolean(progress[v.key]?.broll)} onToggle={() => toggle("broll")}>
            <ul className="space-y-1.5">
              {v.broll.map((b) => (
                <li key={b} className="flex items-start gap-2 text-[16px] leading-snug text-[var(--color-ink)]">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--color-ink-muted)]" /> {b}
                </li>
              ))}
            </ul>
          </PartBlock>
        ) : null}
      </div>

      {videoDone ? (
        <div className="mt-4 rounded-[var(--radius-lg)] bg-[var(--color-good)] p-4 text-white">
          <div className="text-base font-bold">Video volledig opgenomen</div>
          {idx < videos.length - 1 ? (
            <button type="button" onClick={() => go(idx + 1)} className="mt-3 flex h-12 w-full items-center justify-center gap-1 rounded-[var(--radius-md)] bg-white text-[15px] font-semibold text-[var(--color-good)]">
              Door naar video {videos[idx + 1]!.nr} <ChevronRight className="size-5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Notities bij deze video: inspreken of typen. */}
      <div className="mt-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-[var(--color-ink)]">Notitie bij deze video</h2>
        {notes.length ? (
          <ul className="mb-3 space-y-2">
            {notes.map((n) => <NoteItem key={n.id} n={n} dayId={view.day.id} canDelete={canManage || n.createdById === viewerId} onChange={() => router.refresh()} />)}
          </ul>
        ) : null}
        {!readOnly ? <NoteComposer dayId={view.day.id} videoKey={v.key} onSaved={() => router.refresh()} /> : null}
      </div>

      {/* Afronden: altijd bereikbaar onderaan, met waarschuwing bij open onderdelen. */}
      <div className="mt-8 border-t border-[var(--color-line)] pt-5">
        {isFinished ? (
          <p className="rounded-[var(--radius-md)] bg-[var(--color-good-soft)] p-3 text-sm text-[var(--color-ink)]">
            {view.status === "afgerond" ? "Opnamesessie afgerond." : "Opnamesessie afgerond met open onderdelen."} Je kunt nog steeds onderdelen afvinken; het team ziet dat.
          </p>
        ) : !readOnly ? (
          <button type="button" onClick={() => setFinishOpen(true)} className="flex h-14 w-full items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-ink)] text-base font-semibold text-white">
            Opnamesessie afronden
          </button>
        ) : null}
        {finishMsg ? <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{finishMsg}</p> : null}
      </div>

      {finishOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) setFinishOpen(false); }}>
          <div className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-5">
            <h2 className="text-lg font-bold text-[var(--color-ink)]">{open > 0 ? `Nog ${open} onderde${open === 1 ? "el" : "len"} open` : "Opnamesessie afronden"}</h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink-muted)]">
              {total.videosDone} van {videos.length} video&apos;s volledig opgenomen.
              {open > 0 ? " De sessie wordt geregistreerd als afgerond met open punten, zodat het team ziet wat er nog ontbreekt." : ""}
            </p>
            <textarea value={finishNote} onChange={(e) => setFinishNote(e.target.value)} rows={3} placeholder="Korte toelichting voor het team (optioneel)" className="mt-3 w-full rounded-[var(--radius-md)] border border-[var(--color-line)] px-3 py-2 text-[15px]" />
            <div className="mt-3 grid gap-2">
              <button type="button" disabled={finishing} onClick={finish} className="flex h-12 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-ink)] text-[15px] font-semibold text-white disabled:opacity-60">
                {finishing ? <Loader2 className="size-4 animate-spin" /> : null}{open > 0 ? "Toch afronden" : "Afronden"}
              </button>
              <button type="button" onClick={() => setFinishOpen(false)} className="h-12 rounded-[var(--radius-md)] border border-[var(--color-line)] text-[15px] font-medium">Terug naar opnemen</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
