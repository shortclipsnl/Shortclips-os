"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Upload } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { addVideoByUrl } from "@/server/actions/video-intelligence";

type ClientOption = { id: string; name: string };

// Maximale uploadgrootte. Supabase Free staat 50 MB per bestand toe; met een
// betaald plan kan dit omhoog (pas dit dan samen met de opslaglimiet aan).
const MAX_UPLOAD_MB = 50;

export function AddVideo({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  if (clients.length === 0) {
    return (
      <Card className="mb-5">
        <p className="text-sm text-[var(--color-ink-muted)]">Je hebt geen klanten waaraan je een video kunt koppelen.</p>
      </Card>
    );
  }

  function submitUrl() {
    setError(null);
    if (!clientId) return setError("Kies een klant.");
    if (!/^https?:\/\//i.test(url.trim())) return setError("Geef een geldige https-URL.");
    startTransition(async () => {
      const res = await addVideoByUrl({ clientId, url, title: title || undefined });
      if (res.ok) {
        router.push(`/video-intelligence/${res.data!.id}`);
      } else {
        setError(res.message);
      }
    });
  }

  async function submitUpload() {
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!clientId) return setError("Kies een klant.");
    if (!file) return setError("Kies een videobestand.");
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      const mb = Math.round(file.size / (1024 * 1024));
      return setError(`Deze video is te groot (${mb} MB). De opslag staat nu maximaal ${MAX_UPLOAD_MB} MB per video toe. Exporteer de video iets kleiner (bijv. 1080p of een kortere clip).`);
    }
    setUploading(true);
    try {
      // 1) Analyse aanmaken + upload-bestemming ophalen.
      const initRes = await fetch("/api/video-intelligence/upload-init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId, title: title || undefined, filename: file.name, mimeType: file.type, size: file.size }),
      });
      const init = (await initRes.json()) as { id?: string; uploadUrl?: string; headers?: Record<string, string>; error?: string };
      if (!initRes.ok || !init.id || !init.uploadUrl) {
        setError(init.error ?? "Upload voorbereiden mislukt.");
        return;
      }

      // 2) Bestand rechtstreeks naar de opslag uploaden.
      const putRes = await fetch(init.uploadUrl, { method: "PUT", headers: init.headers, body: file });
      if (!putRes.ok) {
        setError("Het uploaden van het bestand is mislukt.");
        return;
      }

      // 3) Analyse starten.
      const compRes = await fetch("/api/video-intelligence/upload-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: init.id }),
      });
      if (!compRes.ok) {
        const c = (await compRes.json().catch(() => ({}))) as { error?: string };
        setError(c.error ?? "Het starten van de analyse is mislukt.");
        return;
      }

      router.push(`/video-intelligence/${init.id}`);
    } catch {
      setError("Upload mislukt.");
    } finally {
      setUploading(false);
    }
  }

  const busy = pending || uploading;

  return (
    <Card className="mb-5" padded={false}>
      <div className="flex items-center gap-1 border-b border-[var(--color-line)] px-3 pt-3">
        <TabBtn active={mode === "url"} onClick={() => setMode("url")} icon={<Link2 className="size-4" />}>Platform-URL</TabBtn>
        <TabBtn active={mode === "upload"} onClick={() => setMode("upload")} icon={<Upload className="size-4" />}>MP4 uploaden</TabBtn>
      </div>

      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Klant</span>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="sc-input w-full">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Titel (optioneel)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bijv. Hook-test prijsvraag" className="sc-input w-full" />
          </label>
        </div>

        {mode === "url" ? (
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">Publieke video-URL (TikTok / Reel / Short)</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@klant/video/…" className="sc-input w-full" />
            </label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-2xs text-[var(--color-ink-faint)]">
                De video wordt opgehaald voor analyse. Houd rekening met de platformvoorwaarden en AVG; Instagram lukt niet altijd — gebruik dan upload.
              </p>
              <Button onClick={submitUrl} disabled={busy}>{pending ? "Bezig…" : "Analyseren"}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska" className="block w-full text-sm" />
            <div className="flex items-center justify-between gap-3">
              <p className="text-2xs text-[var(--color-ink-faint)]">Max {MAX_UPLOAD_MB} MB per video. mp4/mov/webm/mkv.</p>
              <Button onClick={submitUpload} disabled={busy}>{uploading ? "Uploaden…" : "Uploaden & analyseren"}</Button>
            </div>
          </div>
        )}

        {error ? <p className="text-sm text-[var(--color-bad)]">{error}</p> : null}
      </div>
    </Card>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 rounded-t-[var(--radius-sm)] border-b-2 px-3 py-2 text-sm font-medium ${
        active ? "border-[var(--color-brand-500)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
