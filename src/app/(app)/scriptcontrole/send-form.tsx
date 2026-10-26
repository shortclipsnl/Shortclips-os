"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Send, X } from "lucide-react";
import { sendScriptForReview } from "@/server/actions/script-review";
import { Button, Card, ClientLogo, ErrorNote } from "@/components/ui";
import type { ClientWithSessions } from "@/server/script-review";

function fmtNl(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "long" });
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/**
 * Intern: script-PDF ter controle sturen naar een klant + opnamesessie.
 * Drie stappen: klant → opnamesessie → PDF, dan "Versturen ter controle".
 */
export function SendScriptForm({ clients }: { clients: ClientWithSessions[] }) {
  const [clientId, setClientId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const sessions = useMemo(() => clients.find((c) => c.id === clientId)?.sessions ?? [], [clients, clientId]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setErr("Alleen een PDF-bestand.");
      return;
    }
    setErr(null);
    setFileName(file.name);
    setBase64(await fileToBase64(file));
  }

  function reset() {
    setSessionId("");
    setFileName(null);
    setBase64(null);
    setDone(false);
  }

  function submit() {
    setErr(null);
    if (!clientId) return setErr("Kies eerst een klant.");
    if (!sessionId) return setErr("Kies de opnamesessie.");
    if (!base64 || !fileName) return setErr("Upload de script-PDF.");
    start(async () => {
      const res = await sendScriptForReview({ clientId, productionDayId: sessionId, fileName, contentType: "application/pdf", base64 });
      if (res.ok) { setDone(true); setFileName(null); setBase64(null); setSessionId(""); router.refresh(); }
      else setErr(res.message ?? "Versturen mislukt.");
    });
  }

  return (
    <Card>
      <h2 className="text-base font-semibold">Scripts versturen ter controle</h2>
      <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">Kies de klant en opnamesessie, upload de PDF en verstuur. De klant krijgt direct een melding (en e-mail).</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Klant */}
        <label className="block">
          <span className="sc-label">1 · Klant</span>
          <select className="sc-input" value={clientId} onChange={(e) => { setClientId(e.target.value); reset(); }}>
            <option value="">Kies een klant…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        {/* Opnamesessie */}
        <label className="block">
          <span className="sc-label">2 · Opnamesessie</span>
          <select className="sc-input" value={sessionId} onChange={(e) => setSessionId(e.target.value)} disabled={!clientId}>
            <option value="">{!clientId ? "Kies eerst een klant" : sessions.length === 0 ? "Geen komende opnames" : "Kies een opnamesessie…"}</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{fmtNl(s.scheduledOn)}{s.locationName ? ` — ${s.locationName}` : ""}{s.hasReview ? " (al scripts verstuurd — wordt nieuwe versie)" : ""}</option>
            ))}
          </select>
        </label>
      </div>

      {/* PDF */}
      <div className="mt-4">
        <span className="sc-label">3 · Script-PDF</span>
        {fileName ? (
          <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-4 py-4">
            <span className="flex min-w-0 items-center gap-2.5"><FileText className="size-5 shrink-0 text-[var(--color-brand-600)]" /><span className="truncate text-sm font-medium">{fileName}</span></span>
            <button type="button" onClick={() => { setFileName(null); setBase64(null); }} className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]"><X className="size-4" /></button>
          </div>
        ) : (
          <div
            role="button" tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFile(e.dataTransfer.files?.[0]); }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-md)] border-2 border-dashed px-4 py-7 text-center ${dragOver ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"}`}
          >
            <FileText className="size-6 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
            <span className="text-sm font-medium">Sleep de script-PDF hierheen</span>
            <span className="text-xs text-[var(--color-ink-faint)]">of klik om te kiezen · PDF (max 15 MB)</span>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={submit} disabled={pending || !clientId || !sessionId || !base64}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Versturen ter controle
        </Button>
        {done ? <span className="text-sm font-medium text-[var(--color-good)]">Verstuurd — de klant is op de hoogte gebracht.</span> : null}
      </div>
      {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
    </Card>
  );
}
