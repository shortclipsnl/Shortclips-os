"use client";

import { useRef, useState } from "react";
import { Check, Copy, FilePlus2, FolderPlus, Loader2, Send, UploadCloud, X } from "lucide-react";
import { Button, Card, ErrorNote } from "@/components/ui";
import { createTransfer, signUploadPart, completeFile, abortTransfer } from "@/server/actions/transfer";

type Picked = { file: File; key: string };

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
function fmtSpeed(bps: number): string {
  if (bps <= 0) return "—";
  return `${fmtBytes(bps)}/s`;
}
function fmtEta(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** PUT één deel naar de presigned R2-URL, met voortgang. */
function putPart(url: string, body: Blob, onDelta: (deltaBytes: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    let prev = 0;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onDelta(e.loaded - prev);
        prev = e.loaded;
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onDelta(body.size - prev); // rest meetellen
        resolve();
      } else reject(new Error(`Upload-deel mislukt (HTTP ${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Netwerkfout tijdens upload."));
    xhr.send(body);
  });
}

const PART_CONCURRENCY = 3;

export function TransferUploader({ storageReady, canWrite }: { storageReady: boolean; canWrite: boolean }) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<"select" | "uploading" | "done">("select");
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [totalBytes, setTotalBytes] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [eta, setEta] = useState(0);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const uploadedRef = useRef(0);
  const abortRef = useRef<{ id: string } | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: Picked[] = [];
    for (const f of Array.from(list)) {
      if (f.size === 0 && f.type === "") continue; // mappen zelf overslaan
      next.push({ file: f, key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}` });
    }
    setPicked((cur) => [...cur, ...next]);
    setErr(null);
  }

  function removeFile(key: string) {
    setPicked((cur) => cur.filter((p) => p.key !== key));
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  const total = picked.reduce((s, p) => s + p.file.size, 0);

  async function start() {
    if (picked.length === 0) { setErr("Voeg eerst bestanden toe."); return; }
    setErr(null);
    setPhase("uploading");
    setTotalBytes(total);
    setUploadedBytes(0);
    uploadedRef.current = 0;

    const created = await createTransfer({ files: picked.map((p) => ({ name: p.file.name, size: p.file.size, type: p.file.type })) });
    if (!created.ok) {
      setErr(created.message);
      setPhase("select");
      return;
    }
    // Link meteen tonen (kopieerbaar vóór voltooiing).
    setLink(created.link);
    abortRef.current = { id: created.transferId };

    // Snelheid/ETA elke seconde bijwerken.
    const startAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = (Date.now() - startAt) / 1000;
      const up = uploadedRef.current;
      const sp = elapsed > 0 ? up / elapsed : 0;
      setSpeed(sp);
      setEta(sp > 0 ? (total - up) / sp : 0);
      setUploadedBytes(up);
    }, 1000);

    try {
      for (let i = 0; i < picked.length; i++) {
        const info = created.files[i]!;
        await uploadOneFile(picked[i]!.file, info.fileId, info.partSize, info.partCount);
        const done = await completeFile({ fileId: info.fileId });
        if (!done.ok) throw new Error(done.message ?? "Afronden mislukt.");
        if (done.link) setLink(done.link);
      }
      clearInterval(timer);
      setUploadedBytes(total);
      setSpeed(0);
      setEta(0);
      setPhase("done");
      abortRef.current = null;
    } catch (e) {
      clearInterval(timer);
      setErr((e as Error).message || "Upload mislukt.");
      setPhase("select");
    }
  }

  async function uploadOneFile(file: File, fileId: string, partSize: number, parts: number) {
    let next = 1;
    async function worker() {
      while (next <= parts) {
        const partNumber = next++;
        const begin = (partNumber - 1) * partSize;
        const blob = file.slice(begin, Math.min(begin + partSize, file.size));
        const signed = await signUploadPart({ fileId, partNumber });
        if (!signed.ok || !signed.url) throw new Error(signed.message ?? "Kon upload-URL niet maken.");
        // Eenvoudige retry (3x) per deel.
        let attempt = 0;
        for (;;) {
          try {
            await putPart(signed.url, blob, (d) => { uploadedRef.current += d; });
            break;
          } catch (e) {
            if (++attempt >= 3) throw e;
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, parts) }, () => worker()));
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard geweigerd */ }
  }

  function reset() {
    setPicked([]); setPhase("select"); setLink(null); setErr(null); setUploadedBytes(0); setTotalBytes(0); setSpeed(0); setEta(0);
  }

  async function cancel() {
    if (abortRef.current) await abortTransfer({ transferId: abortRef.current.id }).catch(() => undefined);
    reset();
  }

  const pct = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;

  // ---- Klaar-scherm ----
  if (phase === "done" && link) {
    return (
      <Card className="text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-[var(--color-good-soft)]">
          <Check className="size-6 text-[var(--color-good)]" />
        </div>
        <h2 className="text-lg font-semibold">Je transfer is klaar!</h2>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{picked.length} bestand{picked.length === 1 ? "" : "en"} · {fmtBytes(totalBytes)}</p>
        <div className="mx-auto mt-4 flex max-w-[520px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-left text-sm">{link}</span>
        </div>
        <div className="mt-3 flex justify-center gap-2">
          <Button onClick={copyLink}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Gekopieerd" : "Kopieer link"}
          </Button>
          <Button variant="secondary" onClick={reset}>Nieuwe transfer</Button>
        </div>
      </Card>
    );
  }

  // ---- Upload-scherm ----
  if (phase === "uploading") {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <Loader2 className="size-5 animate-spin text-[var(--color-brand-600)]" />
          <h2 className="text-sm font-semibold">Bezig met uploaden…</h2>
        </div>
        <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
          <div className="h-full rounded-full bg-[var(--color-brand-500)] transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-[var(--color-ink-muted)] tabular-nums">
          <span>{pct}% · {fmtBytes(uploadedBytes)} / {fmtBytes(totalBytes)}</span>
          <span>{fmtSpeed(speed)} · nog {fmtEta(eta)}</span>
        </div>
        {link ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] p-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Downloadlink (al deelbaar — download wordt actief zodra de upload klaar is)</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{link}</span>
              <Button size="sm" variant="secondary" onClick={copyLink}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} Kopieer</Button>
            </div>
          </div>
        ) : null}
        <div className="mt-4"><Button variant="ghost" size="sm" onClick={cancel}>Annuleren</Button></div>
        {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
      </Card>
    );
  }

  // ---- Selectie-scherm ----
  return (
    <Card>
      {!storageReady ? (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[#8a5300]">
          De opslag (Cloudflare R2) is nog niet ingesteld. Je kunt bestanden kiezen, maar uploaden werkt pas zodra de R2-sleutels zijn ingevuld.
        </div>
      ) : null}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed px-4 py-10 text-center transition ${dragOver ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"}`}
      >
        <UploadCloud className="size-8 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
        <span className="text-sm font-medium">Sleep bestanden of mappen hierheen</span>
        <span className="text-xs text-[var(--color-ink-faint)]">of klik om te kiezen</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}><FilePlus2 className="size-4" /> Bestanden toevoegen</Button>
        <Button variant="secondary" size="sm" onClick={() => folderInput.current?.click()}><FolderPlus className="size-4" /> Map toevoegen</Button>
      </div>
      <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      {/* webkitdirectory via ref-attribuut (niet in de React-types). */}
      <input ref={folderInput} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        // @ts-expect-error — webkitdirectory bestaat wel in de browser
        webkitdirectory="" directory="" />

      {picked.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{picked.length} bestand{picked.length === 1 ? "" : "en"}</span>
            <span className="text-[var(--color-ink-muted)] tabular-nums">{fmtBytes(total)}</span>
          </div>
          <div className="max-h-64 space-y-1 overflow-auto">
            {picked.map((p) => (
              <div key={p.key} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{p.file.name}</span>
                <span className="shrink-0 text-xs text-[var(--color-ink-faint)] tabular-nums">{fmtBytes(p.file.size)}</span>
                <button type="button" onClick={() => removeFile(p.key)} aria-label="Verwijderen" className="shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]"><X className="size-4" /></button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 border-t border-[var(--color-line)] pt-4">
        <Button onClick={start} disabled={picked.length === 0 || !canWrite || !storageReady}>
          <Send className="size-4" /> Downloadlink maken
        </Button>
      </div>
      {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
    </Card>
  );
}
