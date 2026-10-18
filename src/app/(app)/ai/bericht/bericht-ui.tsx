"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Sparkles, Upload, X } from "lucide-react";
import { generateReply, type ReplyDraft } from "@/server/actions/ai-tools";
import { Button, Card, ErrorNote, InfoNote } from "@/components/ui";
import { CopyButton, HistoryPanel, NoProviderNote, ToolHowTo, fileToBase64, type HistoryEntry } from "../_shared";

type ClientOption = { id: string; name: string };
type Img = { name: string; base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" };

const TONES = [
  { value: "standaard", label: "Standaard" },
  { value: "korter", label: "Korter" },
  { value: "vriendelijker", label: "Vriendelijker" },
  { value: "directer", label: "Directer" },
  { value: "uitgebreider", label: "Uitgebreider" },
] as const;

export function BerichtAssistent({
  clients,
  aiReady,
  recent,
}: {
  clients: ClientOption[];
  aiReady: boolean;
  recent: HistoryEntry<ReplyDraft>[];
}) {
  const [clientId, setClientId] = useState("");
  const [messageText, setMessageText] = useState("");
  const [channelHint, setChannelHint] = useState<"auto" | "whatsapp" | "email">("auto");
  const [tone, setTone] = useState<(typeof TONES)[number]["value"]>("standaard");
  const [images, setImages] = useState<Img[]>([]);
  const [result, setResult] = useState<ReplyDraft | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const next: Img[] = [];
    for (const f of Array.from(files)) {
      const mt = f.type as Img["mediaType"];
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mt)) continue;
      next.push({ name: f.name, base64: await fileToBase64(f), mediaType: mt });
    }
    setImages((cur) => [...cur, ...next]);
  }

  function run(withTone?: (typeof TONES)[number]["value"]) {
    if (!clientId) {
      setErr("Kies eerst een klant.");
      return;
    }
    setErr(null);
    const useTone = withTone ?? tone;
    if (withTone) setTone(withTone);
    start(async () => {
      const res = await generateReply({
        clientId,
        messageText,
        channelHint,
        tone: useTone,
        images: images.map((i) => ({ base64: i.base64, mediaType: i.mediaType })),
      });
      if (res.ok) {
        setResult(res.data);
        setDraft(res.data.reply);
      } else {
        setErr(res.message);
      }
    });
  }

  return (
    <div className="space-y-5">
      <ToolHowTo>
        Plak het bericht van de klant, of upload een screenshot van WhatsApp/e-mail. Je krijgt een concept-antwoord in de juiste toon. Lees het na, pas aan waar nodig en verstuur het zelf.
      </ToolHowTo>
      {!aiReady ? <NoProviderNote /> : null}
      <HistoryPanel items={recent} onLoad={(o) => { setResult(o); setDraft(o.reply); }} />

      <Card>
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div>
            <label className="sc-label">Klant</label>
            <select className="sc-input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Kies een klant…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <label className="sc-label mt-4">Kanaal</label>
            <select className="sc-input" value={channelHint} onChange={(e) => setChannelHint(e.target.value as "auto")}>
              <option value="auto">Automatisch herkennen</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
            <label className="sc-label mt-4">Screenshot(s)</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
              <Upload className="size-4" />
              Afbeelding(en) kiezen
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
            </label>
            {images.length ? (
              <ul className="mt-2 space-y-1">
                {images.map((im, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs text-[var(--color-ink-muted)]">
                    <span className="truncate">{im.name}</span>
                    <button type="button" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))} aria-label="Verwijderen">
                      <X className="size-3.5 hover:text-[var(--color-bad)]" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <label className="sc-label">Bericht van de klant (plakken)</label>
            <textarea
              className="sc-input resize-y text-sm"
              rows={10}
              placeholder="Plak hier het WhatsApp-bericht of de e-mail van de klant. Of upload een screenshot links."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 border-t border-[var(--color-line)] pt-4">
          <Button onClick={() => run()} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Conceptantwoord opstellen
          </Button>
        </div>
        {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
      </Card>

      {result ? (
        <Card>
          {result.needsJarno ? (
            <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-bad)]" />
              <span><strong>Akkoord van Jarno nodig.</strong> {result.note}</span>
            </div>
          ) : result.note ? (
            <div className="mb-3"><InfoNote>{result.note}</InfoNote></div>
          ) : null}

          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Concept · {result.channel === "email" ? "E-mail" : result.channel === "whatsapp" ? "WhatsApp" : "onbekend kanaal"}
            </span>
            <CopyButton text={draft} />
          </div>
          <textarea className="sc-input resize-y text-sm" rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--color-ink-faint)]">Pas de toon aan:</span>
            {TONES.filter((t) => t.value !== "standaard").map((t) => (
              <button
                key={t.value}
                type="button"
                disabled={pending}
                onClick={() => run(t.value)}
                className="rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
            Dit is een concept — niets wordt automatisch verstuurd. Controleer altijd voordat je het kopieert en verstuurt.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
