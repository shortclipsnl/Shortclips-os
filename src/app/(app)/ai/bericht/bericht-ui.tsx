"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, ImageUp, Loader2, Sparkles, X } from "lucide-react";
import { generateReply, type ReplyDraft } from "@/server/actions/ai-tools";
import { Button, Card, ErrorNote, InfoNote } from "@/components/ui";
import { CopyButton, HistoryPanel, NoProviderNote, ToolHowTo, fileToBase64, type HistoryEntry } from "../_shared";

type Img = { name: string; base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" };

const IMG_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const TONES = [
  { value: "standaard", label: "Standaard" },
  { value: "korter", label: "Korter" },
  { value: "vriendelijker", label: "Vriendelijker" },
  { value: "directer", label: "Directer" },
  { value: "uitgebreider", label: "Uitgebreider" },
] as const;

export function BerichtAssistent({
  aiReady,
  recent,
}: {
  aiReady: boolean;
  recent: HistoryEntry<ReplyDraft>[];
}) {
  const [messageText, setMessageText] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]["value"]>("standaard");
  const [images, setImages] = useState<Img[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ReplyDraft | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const next: Img[] = [];
    for (const f of Array.from(files)) {
      const mt = f.type as Img["mediaType"];
      if (!IMG_TYPES.includes(mt)) continue;
      next.push({ name: f.name || "screenshot", base64: await fileToBase64(f), mediaType: mt });
    }
    if (next.length) setImages((cur) => [...cur, ...next]);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    await addFiles(e.dataTransfer.files);
  }

  // Een screenshot rechtstreeks plakken (Cmd/Ctrl+V) in het tekstveld.
  async function onPaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (imgs.length) {
      e.preventDefault();
      await addFiles(imgs);
    }
  }

  function run(withTone?: (typeof TONES)[number]["value"]) {
    if (!messageText.trim() && images.length === 0) {
      setErr("Plak het klantbericht of sleep een screenshot erin.");
      return;
    }
    setErr(null);
    const useTone = withTone ?? tone;
    if (withTone) setTone(withTone);
    start(async () => {
      const res = await generateReply({
        messageText,
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
      <ToolHowTo
        steps={[
          "Sleep een screenshot van WhatsApp/e-mail erin (of plak de tekst).",
          "De assistent herkent zelf de klant en het kanaal en maakt een concept-antwoord.",
          "Lees het na, pas aan waar nodig en verstuur het zelf.",
        ]}
      />
      {!aiReady ? <NoProviderNote /> : null}
      <HistoryPanel items={recent} onLoad={(o) => { setResult(o); setDraft(o.reply); }} />

      <Card>
        {/* Sleepzone voor screenshots — of plak de tekst eronder. Klant en
            kanaal worden automatisch herkend, geen keuzes nodig. */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-md)] border-2 border-dashed px-4 py-6 text-center transition ${dragOver ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"}`}
        >
          <ImageUp className="size-6 text-[var(--color-ink-faint)]" strokeWidth={1.75} />
          <span className="text-sm font-medium">Sleep hier een screenshot naartoe</span>
          <span className="text-xs text-[var(--color-ink-faint)]">of klik om te kiezen · plakken (Ctrl/Cmd+V) kan ook</span>
          <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </div>

        {images.length ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {images.map((im, i) => (
              <li key={i} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-2.5 py-1.5 text-xs">
                <span className="max-w-[160px] truncate">{im.name}</span>
                <button type="button" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))} aria-label="Verwijderen">
                  <X className="size-3.5 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4">
          <label className="sc-label">Of plak het bericht van de klant</label>
          <textarea
            className="sc-input resize-y text-sm"
            rows={7}
            placeholder="Plak hier het WhatsApp-bericht of de e-mail van de klant — of sleep/plak hierboven een screenshot."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onPaste={onPaste}
          />
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

          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Concept · {result.channel === "email" ? "E-mail" : result.channel === "whatsapp" ? "WhatsApp" : "onbekend kanaal"}
              {" · "}
              {result.detectedClientName ? `Klant: ${result.detectedClientName}` : "Klant niet herkend"}
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
