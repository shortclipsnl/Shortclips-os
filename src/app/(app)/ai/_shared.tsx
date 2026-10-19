"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Brain, Check, Copy, History, Lightbulb, Loader2, Mic, Save } from "lucide-react";
import { saveClientKnowledge } from "@/server/actions/client-knowledge";

/* --------------------------- Voice mode (STT) --------------------------- */

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechCtor = new () => SpeechRec;

/**
 * Inspreken (voice mode): zet gesproken Nederlands om naar tekst en geeft het
 * terug via onText, zodat je het in een tekstveld kunt toevoegen/aanpassen.
 * Werkt waar de browser spraakherkenning ondersteunt (Chrome/desktop-app);
 * anders verschijnt de knop simpelweg niet.
 */
export function VoiceButton({ onText, label = "Inspreken" }: { onText: (text: string) => void; label?: string }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function toggle() {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = "nl-NL";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results, (r) => r[0]?.transcript ?? "").join(" ").trim();
      if (text) onText(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      title="Inspreken — spreek je aanvulling of wijziging in"
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${listening ? "animate-pulse border-[var(--color-bad)] bg-[var(--color-bad-soft)] text-[var(--color-bad)]" : "border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"}`}
    >
      <Mic className="size-3.5" />
      {listening ? "Luistert… (klik om te stoppen)" : label}
    </button>
  );
}

/** Vaste categorieën voor geleerde klantvoorkeuren (de AI-leerlaag). */
export const CLIENT_KNOWLEDGE_CATEGORIES: { value: string; label: string }[] = [
  { value: "recurring_correction", label: "Terugkerende correctie" },
  { value: "tone_of_voice", label: "Tone of voice" },
  { value: "hook_style", label: "Hookstijl" },
  { value: "editing_style", label: "Editingstijl" },
  { value: "avoid_words", label: "Woorden/onderwerpen vermijden" },
  { value: "strong_example", label: "Sterk voorbeeld" },
  { value: "weak_example", label: "Zwak voorbeeld" },
  { value: "fact", label: "Feit over de klant" },
];

/**
 * "Bewaar als klantvoorkeur" — de leer-functie die in elke AI-tool past.
 * Legt een gecontroleerde voorkeur vast bij de klant; toekomstige AI-generaties
 * gebruiken die automatisch. Altijd een bewuste actie, nooit automatisch.
 */
export function SaveInsight({ clientId, defaultBody = "", defaultCategory = "recurring_correction" }: { clientId: string; defaultBody?: string; defaultCategory?: string }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(defaultCategory);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState(defaultBody);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!clientId) return null;

  function save() {
    setErr(null);
    start(async () => {
      const res = await saveClientKnowledge({ clientId, category: cat, title, body, source: "manual" });
      if (res.ok) { setSaved(true); setOpen(false); setTitle(""); }
      else setErr(res.message);
    });
  }

  if (saved) {
    return <span className="inline-flex items-center gap-1 text-2xs font-medium text-[var(--color-good)]"><Check className="size-3.5" /> Opgeslagen als klantvoorkeur</span>;
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title="Een bevestigde voorkeur van deze klant vastleggen zodat de AI er voortaan rekening mee houdt"
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] px-2.5 py-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        <Brain className="size-3.5" /> Bewaar als klantvoorkeur
      </button>
    );
  }
  return (
    <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="sc-input h-8 w-auto py-0 text-xs">
          {CLIENT_KNOWLEDGE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Korte titel (bv. 'Hooks korter')" className="sc-input h-8 flex-1 py-0 text-xs" />
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="De voorkeur/correctie zoals de AI die moet onthouden." className="sc-input mt-2 resize-y text-xs" />
      {err ? <p className="mt-1 text-2xs text-[var(--color-bad)]">{err}</p> : null}
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Opslaan bij klant
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Annuleren</button>
      </div>
    </div>
  );
}

/** Leest een bestand als base64 (zonder de data:-prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function CopyButton({ text, label = "Kopiëren" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard geblokkeerd — stil negeren */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
    >
      {done ? <Check className="size-3.5 text-[var(--color-good)]" /> : <Copy className="size-3.5" />}
      {done ? "Gekopieerd" : label}
    </button>
  );
}

export type HistoryEntry<T> = {
  id: string;
  title: string | null;
  clientName: string;
  createdAt: string;
  output: T;
};

export function HistoryPanel<T>({ items, onLoad }: { items: HistoryEntry<T>[]; onLoad: (output: T, entry: HistoryEntry<T>) => void }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium"
      >
        <History className="size-4 text-[var(--color-ink-faint)]" />
        Eerder gegenereerd ({items.length})
        <span className="ml-auto text-xs text-[var(--color-ink-faint)]">{open ? "verbergen" : "tonen"}</span>
      </button>
      {open ? (
        <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onLoad(it.output, it)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--color-surface-2)]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{it.title ?? "Zonder titel"}</span>
                  <span className="block truncate text-xs text-[var(--color-ink-muted)]">{it.clientName}</span>
                </span>
                <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">
                  {new Date(it.createdAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Korte uitleg boven een AI-tool, in opsommingsvorm (stap voor stap onder
 * elkaar) i.p.v. één tekstblok. Met `output` erbij (standaard aan) komt er een
 * vast blokje onder dat uitlegt waar het resultaat wordt opgeslagen en hoe je
 * het kopieert of als pdf bewaart.
 */
export function ToolHowTo({ steps, output = true }: { steps: string[]; output?: boolean }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-info)]/25 bg-[var(--color-info-soft)]/60 px-4 py-3 text-sm text-[var(--color-ink)]">
      <p className="flex items-center gap-2 font-semibold">
        <Lightbulb className="size-4 shrink-0 text-[var(--color-info)]" /> Zo werkt het
      </p>
      <ol className="mt-2 space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--color-info)] text-2xs font-bold text-white">{i + 1}</span>
            <span className="text-[var(--color-ink-muted)]">{s}</span>
          </li>
        ))}
      </ol>

      {output ? (
        <div className="mt-3 border-t border-[var(--color-info)]/20 pt-2.5">
          <p className="flex items-center gap-2 text-xs font-semibold">
            <Save className="size-3.5 shrink-0 text-[var(--color-info)]" /> Opslaan, kopiëren &amp; pdf
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-[var(--color-ink-muted)]">
            <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Elk resultaat wordt <strong>automatisch opgeslagen</strong> onder AI-geschiedenis (in de database, per klant) — niets gaat verloren.</span></li>
            <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Klaar? Kopieer de tekst met de <strong>Kopiëren</strong>-knop bij het resultaat.</span></li>
            <li className="flex gap-2"><span className="text-[var(--color-info)]">•</span><span>Als <strong>pdf</strong> bewaren kan via je browser: Afdrukken (⌘/Ctrl + P) → <em>Opslaan als pdf</em>.</span></li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function NoProviderNote() {
  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[var(--color-ink)]">
      De AI-generatie is nog niet geactiveerd. Zet <code className="font-mono">ANTHROPIC_API_KEY</code> in{" "}
      <code className="font-mono">.env.local</code> om dit live te zetten. Alle schermen en instellingen werken al.
    </div>
  );
}
