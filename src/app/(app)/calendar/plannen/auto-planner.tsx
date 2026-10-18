"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { bulkCreateCalendarItems, extractScriptTitles } from "@/server/actions/calendar";
import { Button, Card, ErrorNote, InfoNote } from "@/components/ui";
import { fileToBase64, NoProviderNote } from "../../ai/_shared";

type ClientOption = { id: string; name: string; weeklyTarget?: number };

const PLATFORMS = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube Shorts" },
  { value: "linkedin", label: "LinkedIn" },
];

// Werkdag-slots per frequentie (1=ma … 5=vr).
const SLOTS: Record<number, number[]> = { 1: [2], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5] };

// Alle datumberekeningen in UTC, zodat parsen en formatteren niet een dag
// verschuiven (anders belanden werkdagen door de tijdzone op het weekend).
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function parseUTC(dateStr: string): Date {
  return new Date(dateStr.slice(0, 10) + "T00:00:00Z");
}
/** Valt een datum in het weekend, dan de eerstvolgende werkdag (maandag). */
function nextWeekday(dateStr: string): string {
  const d = parseUTC(dateStr);
  const wd = d.getUTCDay(); // 0=zo, 6=za
  if (wd === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (wd === 0) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}
function isWeekend(dateStr: string): boolean {
  const wd = parseUTC(dateStr).getUTCDay();
  return wd === 0 || wd === 6;
}
function mondayOf(dateStr: string): Date {
  const d = parseUTC(dateStr);
  const wd = (d.getUTCDay() + 6) % 7; // ma=0
  d.setUTCDate(d.getUTCDate() - wd);
  return d;
}
/** Verdeel `count` video's over werkdagen vanaf startDate met `perWeek` per week. */
function planDates(count: number, perWeek: number, startDate: string): string[] {
  const slots = SLOTS[perWeek] ?? SLOTS[2]!;
  const monday = mondayOf(startDate);
  const out: string[] = [];
  let week = 0;
  while (out.length < count && week < 104) {
    for (const slot of slots) {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() + week * 7 + (slot - 1));
      if (iso(d) >= startDate) {
        out.push(iso(d));
        if (out.length >= count) break;
      }
    }
    week++;
  }
  return out;
}

export function AutoPlanner({ clients, aiReady }: { clients: ClientOption[]; aiReady: boolean }) {
  const [clientId, setClientId] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [docxBase64, setDocxBase64] = useState<string | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [perWeek, setPerWeek] = useState(2);
  const [startDate, setStartDate] = useState(iso(new Date()));
  // Handmatig aangepaste datums per rij-index (overschrijven de auto-planning).
  const [dateEdits, setDateEdits] = useState<Record<number, string>>({});
  const [platforms, setPlatforms] = useState<string[]>(["tiktok", "instagram"]);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [recognizing, startRecognize] = useTransition();
  const [saving, startSave] = useTransition();
  const router = useRouter();

  const autoDates = useMemo(() => planDates(titles.length, perWeek, startDate), [titles.length, perWeek, startDate]);
  // Effectieve datum per rij: handmatige keuze wint, anders de werkdag-planning.
  const dates = useMemo(
    () => titles.map((_, i) => dateEdits[i] ?? nextWeekday(autoDates[i] ?? startDate)),
    [titles, autoDates, dateEdits, startDate],
  );

  // Bij het kiezen van een klant het publicatieritme (per week) overnemen.
  function onClientChange(id: string) {
    setClientId(id);
    const target = clients.find((c) => c.id === id)?.weeklyTarget;
    if (target && target > 0) setPerWeek(target);
  }

  async function onFile(file?: File) {
    if (!file) return;
    setFileName(file.name);
    const b64 = await fileToBase64(file);
    if (file.name.toLowerCase().endsWith(".docx")) { setDocxBase64(b64); setPdfBase64(null); }
    else { setPdfBase64(b64); setDocxBase64(null); }
  }

  function recognize() {
    if (!clientId) { setErr("Kies eerst een klant."); return; }
    setErr(null); setResult(null);
    startRecognize(async () => {
      const res = await extractScriptTitles({ clientId, scriptText, pdfBase64: pdfBase64 ?? undefined, docxBase64: docxBase64 ?? undefined });
      if (res.ok) setTitles(res.titles);
      else setErr(res.message);
    });
  }

  /** Zonder AI: de geplakte tekst als titels gebruiken (één per regel). */
  function useManualTitles() {
    if (!clientId) { setErr("Kies eerst een klant."); return; }
    const lines = scriptText.split(/\r?\n/).map((s) => s.replace(/^[-*•\d.\s]+/, "").trim()).filter(Boolean);
    if (lines.length === 0) { setErr("Plak eerst één titel per regel."); return; }
    setErr(null); setResult(null);
    setTitles(lines);
  }

  function togglePlatform(p: string) {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  function save() {
    setErr(null);
    const items = titles.map((t, i) => ({ title: t, scheduledOn: dates[i] ?? startDate, platforms, status: "scheduled" }));
    startSave(async () => {
      const res = await bulkCreateCalendarItems({ clientId, items });
      if (res.ok) {
        setResult(`${res.created} gepland${res.skipped ? `, ${res.skipped} overgeslagen (al aanwezig)` : ""}.`);
        router.refresh();
      } else setErr(res.message ?? "Mislukt");
    });
  }

  return (
    <div className="space-y-5">
      {!aiReady ? <NoProviderNote /> : null}

      {/* Stap 1 */}
      <Card>
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div>
            <label className="sc-label">Klant</label>
            <select className="sc-input" value={clientId} onChange={(e) => onClientChange(e.target.value)}>
              <option value="">Kies een klant…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="sc-label mt-4">Scriptdocument (PDF/Word)</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]">
              <Upload className="size-4" /> {fileName ?? "Bestand kiezen"}
              <input type="file" accept=".pdf,.docx,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          <div>
            <label className="sc-label">Of plak het script</label>
            <textarea className="sc-input resize-y font-mono text-xs" rows={8} placeholder="Plak de scripts; de AI haalt de videotitels eruit." value={scriptText} onChange={(e) => setScriptText(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4">
          <Button onClick={recognize} disabled={recognizing || !aiReady} title={aiReady ? undefined : "Vereist ANTHROPIC_API_KEY"}>
            {recognizing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Titels herkennen (AI)
          </Button>
          <Button variant="secondary" onClick={useManualTitles}>
            Titels handmatig gebruiken (1 per regel)
          </Button>
          <span className="text-2xs text-[var(--color-ink-faint)]">Zonder AI: plak hierboven één titel per regel en kies “handmatig”.</span>
        </div>
        {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
      </Card>

      {/* Stap 2 + 3 */}
      {titles.length > 0 ? (
        <Card>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="sc-label">Frequentie</label>
              <select className="sc-input w-44" value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))}>
                <option value={1}>1 video per week</option>
                <option value={2}>2 video&apos;s per week</option>
                <option value={3}>3 per week</option>
                <option value={4}>4 per week</option>
                <option value={5}>5 per week (dagelijks)</option>
              </select>
            </div>
            <div>
              <label className="sc-label">Startdatum</label>
              <input type="date" className="sc-input w-40" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="sc-label">Platforms</label>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORMS.map((p) => (
                  <button key={p.value} type="button" onClick={() => togglePlatform(p.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${platforms.includes(p.value) ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <InfoNote>
            <span className="text-sm">Publicaties worden automatisch verdeeld op werkdagen (ma–vr); zaterdag en zondag worden overgeslagen. De frequentie volgt standaard het ingestelde ritme van de klant. Je kunt elke datum hieronder handmatig aanpassen voordat je opslaat.</span>
          </InfoNote>

          <ul className="mt-3 divide-y divide-[var(--color-line)]">
            {titles.map((t, i) => {
              const weekend = isWeekend(dates[i]!);
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="w-6 text-xs text-[var(--color-ink-faint)]">{i + 1}.</span>
                  <input className="sc-input h-8 min-w-48 flex-1 py-0 text-sm" value={t} onChange={(e) => setTitles((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} />
                  <input
                    type="date"
                    className="sc-input h-8 w-36 py-0 text-sm"
                    value={dates[i]}
                    onChange={(e) => setDateEdits((cur) => ({ ...cur, [i]: e.target.value }))}
                  />
                  <span className={`w-20 text-xs ${weekend ? "font-medium text-[var(--color-warn)]" : "text-[var(--color-ink-muted)]"}`}>
                    {new Date(dates[i] + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}
                    {weekend ? " ⚠" : ""}
                  </span>
                  <button type="button" onClick={() => setTitles((cur) => cur.filter((_, j) => j !== i))} className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Verwijderen">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] pt-4">
            <Button onClick={save} disabled={saving || platforms.length === 0}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {titles.length} video&apos;s inplannen
            </Button>
            {result ? <InfoNote tone="good">{result}</InfoNote> : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
