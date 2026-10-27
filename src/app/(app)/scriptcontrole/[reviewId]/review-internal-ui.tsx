"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Loader2, RotateCcw, Send, Upload } from "lucide-react";
import { createScriptVersionUploadUrl, replyToScriptReviewThread, resolveScriptReviewThread, setScriptReviewRevising, uploadScriptReviewVersion } from "@/server/actions/script-review";
import { Button, ErrorNote, TeamAvatar } from "@/components/ui";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

const when = (iso: string) => new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export type InternalThread = {
  id: string;
  versionNumber: number;
  pageNumber: number | null;
  visibility: string;
  isResolved: boolean;
  authorName: string | null;
  createdAt: string;
  comments: Array<{ id: string; body: string; authorName: string | null; isInternal: boolean; createdAt: string }>;
};

/** Eén opmerkingdraad met reageren + verwerkt-markeren. */
export function ThreadCard({ thread }: { thread: InternalThread }) {
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const isClientThread = thread.visibility === "client";

  function send() {
    if (!reply.trim()) return;
    setErr(null);
    start(async () => {
      const res = await replyToScriptReviewThread({ threadId: thread.id, body: reply, internal });
      if (res.ok) { setReply(""); router.refresh(); }
      else setErr(res.message ?? "Mislukt.");
    });
  }
  function toggleResolved() {
    setErr(null);
    start(async () => {
      const res = await resolveScriptReviewThread(thread.id, !thread.isResolved);
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Mislukt.");
    });
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4" style={{ boxShadow: `inset 3px 0 0 ${thread.isResolved ? "var(--color-good)" : isClientThread ? "var(--color-warn)" : "var(--color-ink-faint)"}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-ink-faint)]">
        <span>
          {thread.pageNumber ? `Pagina ${thread.pageNumber}` : "Algemene opmerking"} · versie {thread.versionNumber}
          {!isClientThread ? <span className="ml-1.5 rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 font-semibold">intern</span> : null}
        </span>
        <button type="button" onClick={toggleResolved} disabled={pending}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${thread.isResolved ? "bg-[var(--color-good-soft)] text-[var(--color-good)]" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
          {thread.isResolved ? <><RotateCcw className="size-3" /> Heropenen</> : <><Check className="size-3" /> Markeer verwerkt</>}
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {thread.comments.map((c) => (
          <div key={c.id} className="flex items-start gap-2">
            <TeamAvatar name={c.authorName ?? "?"} size={22} />
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-ink)]">{c.body}</p>
              <p className="mt-0.5 text-2xs text-[var(--color-ink-faint)]">
                {c.authorName ?? "Onbekend"}{c.isInternal ? " · intern" : ""} · {when(c.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-[var(--color-line)] pt-3">
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} maxLength={4000}
          placeholder={internal ? "Interne notitie (niet zichtbaar voor de klant)…" : "Reageer naar de klant…"}
          className="sc-input w-full resize-y text-sm" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={send} disabled={pending || !reply.trim()}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Reageren
          </Button>
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> interne notitie
          </label>
        </div>
        {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
      </div>
    </div>
  );
}

/** Nieuwe PDF-versie uploaden → opnieuw ter controle naar de klant. */
export function UploadNewVersion({ reviewId }: { reviewId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function onFile(f: File | undefined) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) { setErr("Alleen een PDF-bestand."); return; }
    setErr(null); setFile(f);
  }
  function submit() {
    if (!file) { setErr("Kies eerst de aangepaste PDF."); return; }
    setErr(null);
    start(async () => {
      try {
        // Grote PDF's: direct naar opslag (langs de 4,5MB-limiet van Vercel).
        const up = await createScriptVersionUploadUrl(reviewId);
        if (!up.ok) { setErr(up.message ?? "Mislukt."); return; }
        let res;
        if (up.uploadUrl && up.key) {
          const put = await fetch(up.uploadUrl, { method: "PUT", headers: up.headers, body: file });
          if (!put.ok) { setErr("Uploaden mislukt."); return; }
          res = await uploadScriptReviewVersion({ reviewId, fileName: file.name, storagePath: up.key, sizeBytes: file.size, note: note.trim() || undefined });
        } else {
          const base64 = await fileToBase64(file);
          res = await uploadScriptReviewVersion({ reviewId, fileName: file.name, base64, note: note.trim() || undefined });
        }
        if (res.ok) { setFile(null); setNote(""); router.refresh(); }
        else setErr(res.message ?? "Mislukt.");
      } catch { setErr("Mislukt."); }
    });
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {file ? (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm">
          <span className="truncate font-medium">{file.name}</span>
          <button type="button" onClick={() => setFile(null)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]">verwijderen</button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
          <Upload className="size-4" /> Aangepaste PDF kiezen
        </button>
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Korte toelichting (optioneel): wat is aangepast?"
        className="sc-input mt-2 text-sm" />
      <div className="mt-2">
        <Button size="sm" onClick={submit} disabled={pending || !file}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Nieuwe versie — opnieuw ter controle
        </Button>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}

/** "In bewerking nemen" — zet de status op "wordt aangepast". */
export function TakeInProgress({ reviewId }: { reviewId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button size="sm" variant="secondary" disabled={pending}
      onClick={() => start(async () => { await setScriptReviewRevising(reviewId); router.refresh(); })}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} In bewerking nemen
    </Button>
  );
}
