"use client";

import { useState, useTransition } from "react";
import { Loader2, Download, PenLine, Plus, Minus, Trash2, ArrowLeft, Sparkles, FileText } from "lucide-react";
import { generateScripts, type GeneratedScript } from "@/server/actions/script-generate";

type Client = { id: string; name: string };

function todayNl(): string {
  return new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

export function ScriptGeneratorChat({ clients, aiReady }: { clients: Client[]; aiReady: boolean }) {
  // Instellingen
  const [clientId, setClientId] = useState<string>("");
  const [otherName, setOtherName] = useState<string>("");
  const [showOther, setShowOther] = useState(false);
  const [count, setCount] = useState(3);
  const [brief, setBrief] = useState("");

  // Resultaat (bewerkbaar)
  const [scripts, setScripts] = useState<GeneratedScript[] | null>(null);
  const [klantnaam, setKlantnaam] = useState("");
  const [opnamedag, setOpnamedag] = useState(todayNl());

  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [exporting, setExporting] = useState(false);

  const selectedName = clientId ? clients.find((c) => c.id === clientId)?.name ?? "" : "";
  const effectiveClientName = showOther ? otherName.trim() : selectedName;

  const generate = () => {
    setErr(null);
    start(async () => {
      const res = await generateScripts({
        clientId: showOther ? undefined : clientId || undefined,
        clientName: showOther ? otherName.trim() || undefined : undefined,
        count,
        brief: brief.trim() || undefined,
      });
      if (res.ok) {
        setScripts(res.scripts);
        setKlantnaam(res.klantnaam || effectiveClientName || "");
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
              <button type="button" onClick={() => removeScript(i)} title="Verwijder dit script" className="shrink-0 rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]">
                <Trash2 className="size-4" />
              </button>
            </div>
            <textarea
              value={s.tekst}
              onChange={(e) => updateScript(i, { tekst: e.target.value })}
              rows={14}
              spellCheck
              className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--color-ink)] focus:border-[var(--color-brand-500)] focus:outline-none"
            />
          </div>
        ))}

        <button type="button" onClick={addScript} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-2 text-xs font-medium text-[var(--color-ink-muted)] hover:border-[var(--color-brand-500)] hover:text-[var(--color-ink)]">
          <Plus className="size-3.5" /> Leeg script toevoegen
        </button>

        {err ? <p className="text-2xs text-[var(--color-bad)]">{err}</p> : null}

        {/* Actiebalk */}
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)]/95 p-3 shadow-[var(--shadow-card)] backdrop-blur">
          <button type="button" onClick={() => { setScripts(null); setErr(null); }} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface)]">
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
      {/* Klantkeuze */}
      <div className="mb-5">
        <span className="mb-2 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Voor welke klant?</span>
        <div className="flex flex-wrap gap-2">
          {clients.map((c) => {
            const active = !showOther && clientId === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => { setShowOther(false); setClientId(c.id); }}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${active ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand-500)]"}`}
              >
                {c.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => { setShowOther(true); setClientId(""); }}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${showOther ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white" : "border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:border-[var(--color-brand-500)]"}`}
          >
            Andere klant…
          </button>
        </div>
        {showOther ? (
          <input
            value={otherName}
            onChange={(e) => setOtherName(e.target.value)}
            placeholder="Naam van de klant (niet vastgelegd)"
            className="sc-input mt-2 h-9 w-full max-w-sm text-sm"
          />
        ) : (
          <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">
            {clientId ? "Stijl, afspraken en best presterende hooks van deze klant worden meegeladen." : "Kies een klant — of schrijf vrij zonder vaste klant."}
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

      {/* Onderwerpen / wensen */}
      <div className="mb-5">
        <span className="mb-2 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Onderwerpen of hooks <span className="font-normal normal-case text-[var(--color-ink-faint)]">— optioneel, één per regel</span></span>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={4}
          placeholder={"Laat leeg om de schrijver zelf onderwerpen te laten kiezen.\nOf geef bv. hooks, producten, acties of een thema."}
          className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand-500)] focus:outline-none"
        />
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
