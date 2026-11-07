"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";
import { buttonClass } from "@/components/ui";

type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
};
type RecCtor = new () => Rec;

const noop = () => () => {};
function hasSpeech(): boolean {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/**
 * Inspreken in plaats van typen (spraakherkenning van de browser, Nederlands).
 * Blijft luisteren tot je op stoppen klikt; elke uitgesproken zin wordt aan de
 * tekst toegevoegd. Zonder ondersteuning in de browser verschijnt er niets.
 */
export function DictateButton({ onText }: { onText: (text: string) => void }) {
  const supported = useSyncExternalStore(noop, hasSpeech, () => false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<Rec | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  useEffect(() => () => recRef.current?.stop(), []);

  function toggle() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "nl-NL";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let tussen = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const t = r[0].transcript.trim();
        if (!t) continue;
        if (r.isFinal) onTextRef.current(t);
        else tussen += `${t} `;
      }
      setInterim(tussen.trim());
    };
    rec.onend = () => { setListening(false); setInterim(""); };
    rec.onerror = () => { setListening(false); setInterim(""); };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  if (!supported) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={toggle} className={buttonClass({ variant: listening ? "danger" : "secondary", size: "sm" })}>
        {listening ? <><Square className="size-3.5" /> Stop inspreken</> : <><Mic className="size-3.5" /> Inspreken</>}
      </button>
      {listening ? <span className="text-2xs text-[var(--color-ink-muted)]">{interim || "Luistert… spreek je feedback in."}</span> : null}
    </span>
  );
}
