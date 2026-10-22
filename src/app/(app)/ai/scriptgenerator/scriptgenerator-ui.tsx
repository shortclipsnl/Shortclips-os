"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Download, PenLine, Plus, Minus, Trash2, ArrowLeft, Sparkles, FileText, Mic, MicOff, Upload, Wand2, X } from "lucide-react";
import { generateScripts, reviseScript, type GeneratedScript } from "@/server/actions/script-generate";

type Client = { id: string; name: string; active: boolean };
type ClientFilter = "actief" | "inactief" | "alle";

function todayNl(): string {
  return new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

/* ---------------- Spraak-naar-tekst (voice mode) ---------------- */

type SpeechResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechEventLike = { resultIndex: number; results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: SpeechEventLike) => void; onend: () => void; onerror: () => void;
  start: () => void; stop: () => void;
};
type SRWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as SRWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Microfoonknop: dicteert in het Nederlands en geeft de herkende tekst door. */
function MicButton({ onText, title = "Inspreken" }: { onText: (t: string) => void; title?: string }) {
  const [listening, setListening] = useState(false);
  const [mounted, setMounted] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => setMounted(true), []);
  const Ctor = speechCtor();
  // Pas na mount renderen: zo is de server- en client-render gelijk (geen hydration-mismatch).
  if (!mounted || !Ctor) return null;

  const stop = () => { recRef.current?.stop(); recRef.current = null; setListening(false); };
  const start = () => {
    const r = new Ctor();
    r.lang = "nl-NL";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let t = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res?.isFinal) t += res[0].transcript;
      }
      if (t.trim()) onText(t.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
    r.start();
    setListening(true);
  };

  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      title={listening ? "Stop met inspreken" : title}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border transition ${listening ? "animate-pulse border-[var(--color-bad)] bg-[var(--color-bad)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
    >
      {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
    </button>
  );
}

/* ---------------- helpers ---------------- */

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); const i = s.indexOf(","); resolve(i >= 0 ? s.slice(i + 1) : s); };
    r.onerror = () => reject(new Error("Kon het bestand niet lezen."));
    r.readAsDataURL(file);
  });
}

const appendText = (prev: string, add: string) => prev + (prev && !prev.endsWith("\n") && !prev.endsWith(" ") ? " " : "") + add;

/* ---------------- component ---------------- */

export function ScriptGeneratorChat({ clients, aiReady }: { clients: Client[]; aiReady: boolean }) {
  // Instellingen
  const [clientId, setClientId] = useState<string>("");
  const [otherName, setOtherName] = useState<string>("");
  const [showOther, setShowOther] = useState(false);
  const [filter, setFilter] = useState<ClientFilter>("actief");
  const [count, setCount] = useState(3);
  const [brief, setBrief] = useState("");
  const [pdfs, setPdfs] = useState<Array<{ name: string; base64: string }>>([]);

  // Resultaat (bewerkbaar)
  const [scripts, setScripts] = useState<GeneratedScript[] | null>(null);
  const [klantnaam, setKlantnaam] = useState("");
  const [opnamedag, setOpnamedag] = useState(todayNl());
  const [genClientId, setGenClientId] = useState<string>("");
  const [genClientName, setGenClientName] = useState<string>("");

  // Aanpassen per script
  const [reviseIdx, setReviseIdx] = useState<number | null>(null);
  const [reviseText, setReviseText] = useState("");
  const [revisePending, setRevisePending] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [exporting, setExporting] = useState(false);

  const visibleClients = clients.filter((c) => (filter === "alle" ? true : filter === "actief" ? c.active : !c.active));
  const selectedName = clientId ? clients.find((c) => c.id === clientId)?.name ?? "" : "";
  const effectiveClientName = showOther ? otherName.trim() : selectedName;

  const addPdfs = async (files: FileList | null) => {
    if (!files) return;
    setErr(null);
    for (const f of Array.from(files)) {
      if (f.type !== "application/pdf") { setErr("Alleen PDF-bestanden kunnen erbij."); continue; }
      if (f.size > 3.5 * 1024 * 1024) { setErr(`"${f.name}" is te groot (max 3,5 MB).`); continue; }
      try {
        const base64 = await fileToBase64(f);
        setPdfs((p) => (p.length >= 3 ? p : [...p, { name: f.name, base64 }]));
      } catch { setErr(`"${f.name}" kon niet worden gelezen.`); }
    }
  };

  const generate = () => {
    setErr(null);
    start(async () => {
      const res = await generateScripts({
        clientId: showOther ? undefined : clientId || undefined,
        clientName: showOther ? otherName.trim() || undefined : undefined,
        count,
        brief: brief.trim() || undefined,
        priorPdfs: pdfs.length ? pdfs.map((p) => ({ base64: p.base64 })) : undefined,
      });
      if (res.ok) {
        setScripts(res.scripts);
        setKlantnaam(res.klantnaam || effectiveClientName || "");
        setGenClientId(showOther ? "" : clientId);
        setGenClientName(showOther ? otherName.trim() : selectedName);
      } else {
        setErr(res.message);
      }
    });
  };

  const exportPdf = async () => {
    if (!scripts || scripts.length === 0) return;
    setExporting(true);
    setErr(null);
    try {
      const { downloadScriptPdf } = await import("@/lib/script-pdf");
      await downloadScriptPdf({ klantnaam, opnamedag, scripts });
    } catch {
      setErr("Het PDF-bestand kon niet worden gemaakt. Probeer het nog eens.");
    } finally {
      setExporting(false);
    }
  };

  const updateScript = (i: number, patch: Partial<GeneratedScript>) =>
    setScripts((prev) => (prev ? prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) : prev));
  const removeScript = (i: number) => setScripts((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev));
  const addScript = () => setScripts((prev) => [...(prev ?? []), { onderwerp: "", tekst: "" }]);

  const runRevise = (i: number) => {
    const s = scripts?.[i];
    if (!s || !reviseText.trim()) return;
    setRevisePending(true);
    setErr(null);
    (async () => {
      const res = await reviseScript({
        onderwerp: s.onderwerp,
        tekst: s.tekst,
        instruction: reviseText.trim(),
        clientId: genClientId || undefined,
        clientName: genClientId ? undefined : genClientName || undefined,
      });
      if (res.ok) { updateScript(i, res.script); setReviseIdx(null); setReviseText(""); }
      else setErr(res.message);
      setRevisePending(false);
    })();
  };

  if (!aiReady) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-muted)]">
        De AI-schrijver staat nog uit. Zodra de ANTHROPIC_API_KEY is ingesteld, kun je hier scripts schrijven.
      </div>
    );
  }

  // ---------- RESULTAAT ----------
  if (scripts) {
    return (
      <div className="space-y-4">
        {/* Cover-velden */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-4 shadow-[var(--shadow-card)]">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
            <FileText className="size-4 text-[var(--color-brand-600)]" /> Voorpagina
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klant</span>
              <input value={klantnaam} onChange={(e) => setKlantnaam(e.target.value)} placeholder="Klantnaam" className="sc-input h-9 w-full text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Opnamedag</span>
              <input value={opnamedag} onChange={(e) => setOpnamedag(e.target.value)} placeholder="bijv. 9 november 2026" className="sc-input h-9 w-full text-sm" />
            </label>
          </div>
        </div>

        {/* Scripts — bewerkbaar */}
        {scripts.map((s, i) => (
          <div key={i} className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-brand-600)] text-2xs font-bold text-white">{i + 1}</span>
              <input
                value={s.onderwerp}
                onChange={(e) => updateScript(i, { onderwerp: e.target.value })}
                placeholder="Onderwerp / videotitel"
                className="sc-input h-9 flex-1 text-sm font-semibold"
              />
              <button type="button" onClick={() => { setReviseIdx(reviseIdx === i ? null : i); setReviseText(""); }} title="Met AI aanpassen" className="shrink-0 rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-brand-600)]">
                <Wand2 className="size-4" />
              </button>
              <button type="button" onClick={() => removeScript(i)} title="Verwijder dit script" className="shrink-0 rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]">
                <Trash2 className="size-4" />
              </button>
            </div>

            <div className="flex items-start gap-2">
              <textarea
                value={s.tekst}
                onChange={(e) => updateScript(i, { tekst: e.target.value })}
                rows={14}
                spellCheck
                className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--color-ink)] focus:border-[var(--color-brand-500)] focus:outline-none"
              />
              <MicButton onText={(t) => updateScript(i, { tekst: appendText(s.tekst, t) })} title="Tekst inspreken" />
            </div>

            {/* AI-aanpassing */}
            {reviseIdx === i ? (
              <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] p-2.5">
                <span className="mb-1.5 block text-2xs font-semibold text-[var(--color-brand-700)]">Wat moet er anders? (typen of inspreken)</span>
                <div className="flex items-start gap-2">
                  <textarea
                    value={reviseText}
                    onChange={(e) => setReviseText(e.target.value)}
                    rows={2}
                    placeholder="bijv. maak de hook pakkender en voeg een concreet bedrag toe"
                    className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-brand-500)] focus:outline-none"
                  />
                  <MicButton onText={(t) => setReviseText((p) => appendText(p, t))} title="Aanpassing inspreken" />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button type="button" onClick={() => runRevise(i)} disabled={revisePending || !reviseText.trim()} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40">
                    {revisePending ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Pas aan
                  </button>
                  <button type="button" onClick={() => { setReviseIdx(null); setReviseText(""); }} className="text-2xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Annuleer</button>
                </div>
              </div>
            ) : null}
          </div>
        ))}

        <button type="button" onClick={addScript} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-2 text-xs font-medium text-[var(--color-ink-muted)] hover:border-[var(--color-brand-500)] hover:text-[var(--color-ink)]">
          <Plus className="size-3.5" /> Leeg script toevoegen
        </button>

        {err ? <p className="text-2xs text-[var(--color-bad)]">{err}</p> : null}

        {/* Actiebalk */}
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)]/95 p-3 shadow-[var(--shadow-card)] backdrop-blur">
          <button type="button" onClick={() => { setScripts(null); setErr(null); setReviseIdx(null); }} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface)]">
            <ArrowLeft className="size-4" /> Nieuwe set
          </button>
          <span className="text-2xs text-[var(--color-ink-faint)]">{scripts.length} script{scripts.length === 1 ? "" : "s"} · pas gerust de tekst aan</span>
          <button
            type="button"
            onClick={exportPdf}
            disabled={exporting || scripts.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Exporteer als PDF
          </button>
        </div>
      </div>
    );
  }

  // ---------- INSTELLINGEN ----------
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-5 shadow-[var(--shadow-card)]">
      {/* Klantkeuze + filter */}
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Voor welke klant?</span>
          <div className="inline-flex rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5 text-2xs">
            {(["actief", "inactief", "alle"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1 font-medium capitalize transition ${filter === f ? "bg-[var(--color-brand-600)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
                {f === "actief" ? "Actief" : f === "inactief" ? "Niet-actief" : "Alle"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {visibleClients.map((c) => {
            const active = !showOther && clientId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => { setShowOther(false); setClientId(c.id); }}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${active ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand-500)]"}`}
              >
                {c.name}{!c.active ? <span className="ml-1.5 text-2xs opacity-60">(niet-actief)</span> : null}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => { setShowOther(true); setClientId(""); }}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${showOther ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white" : "border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:border-[var(--color-brand-500)]"}`}
          >
            + Nieuwe klant
          </button>
        </div>
        {showOther ? (
          <input
            value={otherName}
            onChange={(e) => setOtherName(e.target.value)}
            placeholder="Naam van de nieuwe/niet-vastgelegde klant"
            className="sc-input mt-2 h-9 w-full max-w-sm text-sm"
          />
        ) : (
          <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">
            {visibleClients.length === 0 ? "Geen klanten in dit filter." : clientId ? "Stijl, afspraken en best presterende hooks van deze klant worden meegeladen." : "Kies een klant — of schrijf vrij zonder vaste klant."}
          </p>
        )}
      </div>

      {/* Aantal scripts */}
      <div className="mb-5">
        <span className="mb-2 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Hoeveel scripts?</span>
        <div className="inline-flex items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-1">
          <button type="button" onClick={() => setCount((n) => Math.max(1, n - 1))} className="grid size-8 place-items-center rounded-[var(--radius-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-30" disabled={count <= 1}>
            <Minus className="size-4" />
          </button>
          <span className="w-8 text-center text-lg font-bold tabular-nums text-[var(--color-ink)]">{count}</span>
          <button type="button" onClick={() => setCount((n) => Math.min(8, n + 1))} className="grid size-8 place-items-center rounded-[var(--radius-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-30" disabled={count >= 8}>
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      {/* Eerdere scripts als PDF */}
      <div className="mb-5">
        <span className="mb-2 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Eerdere scripts erbij <span className="font-normal normal-case text-[var(--color-ink-faint)]">— optioneel, PDF</span></span>
        <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink-muted)] hover:border-[var(--color-brand-500)]">
          <Upload className="size-4" /> Sleep of kies PDF('s) met eerdere scripts
          <input type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => addPdfs(e.target.files)} />
        </label>
        {pdfs.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {pdfs.map((p, i) => (
              <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-2xs text-[var(--color-ink)]">
                <FileText className="size-3" /> <span className="max-w-[180px] truncate">{p.name}</span>
                <button type="button" onClick={() => setPdfs((prev) => prev.filter((_, idx) => idx !== i))} className="text-[var(--color-ink-muted)] hover:text-[var(--color-bad)]"><X className="size-3" /></button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1.5 text-2xs text-[var(--color-ink-faint)]">Hij gebruikt deze als basis: zelfde stijl en opbouw, maar nieuwe scripts.</p>
      </div>

      {/* Onderwerpen / wensen + voice */}
      <div className="mb-5">
        <span className="mb-2 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Onderwerpen of hooks <span className="font-normal normal-case text-[var(--color-ink-faint)]">— optioneel, typen of inspreken</span></span>
        <div className="flex items-start gap-2">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            placeholder={"Laat leeg om de schrijver zelf onderwerpen te laten kiezen.\nOf geef bv. hooks, producten, acties of een thema."}
            className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand-500)] focus:outline-none"
          />
          <MicButton onText={(t) => setBrief((p) => appendText(p, t))} title="Onderwerpen inspreken" />
        </div>
      </div>

      {err ? <p className="mb-3 text-2xs text-[var(--color-bad)]">{err}</p> : null}

      <button
        type="button"
        onClick={generate}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
        {pending ? `${count} script${count === 1 ? "" : "s"} schrijven…` : `Schrijf ${count} script${count === 1 ? "" : "s"}`}
      </button>
      <p className="mt-3 flex items-center gap-1.5 text-2xs text-[var(--color-ink-faint)]">
        <Sparkles className="size-3" /> Organisch (TikTok/Reels), volgens het Scripthandboek. Daarna kun je alles aanpassen en als PDF downloaden.
      </p>
    </div>
  );
}
