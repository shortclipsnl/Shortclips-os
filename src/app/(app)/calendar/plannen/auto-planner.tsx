"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, FileText, Loader2, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { bulkCreateCalendarItems, extractScriptTitles, getClientSchedule } from "@/server/actions/calendar";
import { Button, Card, ErrorNote, InfoNote } from "@/components/ui";
import { fileToBase64, NoProviderNote } from "../../ai/_shared";

type ClientOption = { id: string; name: string; weeklyTarget?: number };
type ScheduleItem = { scheduledOn: string; title: string; platforms: string[] };

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
function nextWeekday(dateStr: string): string {
  const d = parseUTC(dateStr);
  const wd = d.getUTCDay();
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
  const wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd);
  return d;
}
function fmtDay(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}
/** Verdeel `count` video's over werkdagen vanaf startDate; dagen die al bezet
 *  zijn (bestaande uploads) worden overgeslagen. */
function planDates(count: number, perWeek: number, startDate: string, occupied: Set<string>): string[] {
  const slots = SLOTS[perWeek] ?? SLOTS[2]!;
  const monday = mondayOf(startDate);
  const out: string[] = [];
  let week = 0;
  while (out.length < count && week < 156) {
    for (const slot of slots) {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() + week * 7 + (slot - 1));
      const ds = iso(d);
      if (ds >= startDate && !occupied.has(ds) && !out.includes(ds)) {
        out.push(ds);
        if (out.length >= count) break;
      }
    }
    week++;
  }
  return out;
}

export function AutoPlanner({ clients, aiReady }: { clients: ClientOption[]; aiReady: boolean }) {
  const [clientId, setClientId] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [docxBase64, setDocxBase64] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [titles, setTitles] = useState<string[]>([]);
  const [perWeek, setPerWeek] = useState(2);
  const [startDate, setStartDate] = useState(iso(new Date()));
  const [dateEdits, setDateEdits] = useState<Record<number, string>>({});
  const [platforms, setPlatforms] = useState<string[]>(["tiktok", "instagram"]);
  const [existing, setExisting] = useState<ScheduleItem[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [recognizing, startRecognize] = useTransition();
  const [saving, startSave] = useTransition();
  const router = useRouter();

  // Dagen die al bezet zijn door bestaande uploads — daar plant de planner omheen.
  const occupied = useMemo(() => new Set(existing.map((e) => e.scheduledOn)), [existing]);
  const autoDates = useMemo(() => planDates(titles.length, perWeek, startDate, occupied), [titles.length, perWeek, startDate, occupied]);
  const dates = useMemo(
    () => titles.map((_, i) => dateEdits[i] ?? autoDates[i] ?? startDate),
    [titles, autoDates, dateEdits, startDate],
  );

  // Gecombineerd overzicht: wat er al staat + wat we nieuw inplannen, op datum.
  const overview = useMemo(() => {
    const merged = [
      ...existing.map((e) => ({ date: e.scheduledOn, title: e.title, kind: "bestaand" as const })),
      ...titles.map((t, i) => ({ date: dates[i]!, title: t, kind: "nieuw" as const })),
    ];
    return merged.sort((a, b) => a.date.localeCompare(b.date));
  }, [existing, titles, dates]);

  async function loadSchedule(id: string): Promise<ScheduleItem[]> {
    setLoadingSchedule(true);
    const res = await getClientSchedule(id);
    setLoadingSchedule(false);
    if (res.ok) {
      setExisting(res.items);
      return res.items;
    }
    setExisting([]);
    return [];
  }

  function suggestedStart(items: ScheduleItem[]): string {
    const today = iso(new Date());
    if (items.length === 0) return today;
    const last = items[items.length - 1]!.scheduledOn; // oplopend gesorteerd
    const d = parseUTC(last);
    d.setUTCDate(d.getUTCDate() + 1);
    const cand = iso(d);
    return nextWeekday(cand > today ? cand : today);
  }

  async function onClientChange(id: string) {
    setClientId(id);
    setTitles([]);
    setDateEdits({});
    setResult(null);
    setErr(null);
    const target = clients.find((c) => c.id === id)?.weeklyTarget;
    if (target && target > 0) setPerWeek(target);
    if (id) {
      const items = await loadSchedule(id);
      setStartDate(suggestedStart(items));
    } else {
      setExisting([]);
    }
  }

  async function onFile(file?: File) {
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setErr("Alleen een PDF- of Word-bestand (.pdf of .docx).");
      return;
    }
    setErr(null);
    setFileName(file.name);
    const b64 = await fileToBase64(file);
    if (file.name.toLowerCase().endsWith(".docx")) { setDocxBase64(b64); setPdfBase64(null); }
    else { setPdfBase64(b64); setDocxBase64(null); }
  }

  function clearFile() {
    setFileName(null);
    setPdfBase64(null);
    setDocxBase64(null);
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    await onFile(e.dataTransfer.files?.[0]);
  }

  function recognize() {
    if (!clientId) { setErr("Kies eerst een klant."); return; }
    if (!pdfBase64 && !docxBase64) { setErr("Sleep eerst het scriptbestand erin (PDF of Word)."); return; }
    setErr(null); setResult(null);
    startRecognize(async () => {
      const res = await extractScriptTitles({ clientId, pdfBase64: pdfBase64 ?? undefined, docxBase64: docxBase64 ?? undefined });
      if (res.ok) { setTitles(res.titles); setDateEdits({}); }
      else setErr(res.message);
    });
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
        // Overzicht verversen zodat je ziet wat er nu daadwerkelijk staat.
        const refreshed = await loadSchedule(clientId);
        setTitles([]);
        setDateEdits({});
        setStartDate(suggestedStart(refreshed));
        router.refresh();
      } else setErr(res.message ?? "Mislukt");
    });
  }

  return (
    <div className="space-y-5">
      {!aiReady ? <NoProviderNote /> : null}

      {/* Stap 1 — klant + scriptbestand. */}
      <Card>
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <div>
            <label className="sc-label">Klant</label>
            <select className="sc-input" value={clientId} onChange={(e) => onClientChange(e.target.value)}>
              <option value="">Kies een klant…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
              Kies de klant en sleep het scriptbestand ernaast. De planner houdt rekening met wat er al in de agenda staat.
            </p>
          </div>
          <div>
            <label className="sc-label">Scriptbestand (PDF of Word)</label>
            <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
              Sleep het volledige script van de opnamesessie hierin. De AI herkent zelf de afzonderlijke video&apos;s en maakt er titels van — je hoeft niets te plakken.
            </p>
            {fileName ? (
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-4 py-4">
                <span className="flex min-w-0 items-center gap-2.5">
                  <FileText className="size-6 shrink-0 text-[var(--color-brand-600)]" strokeWidth={1.75} />
                  <span className="truncate text-sm font-medium">{fileName}</span>
                </span>
                <button type="button" onClick={clearFile} aria-label="Bestand verwijderen" className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => document.getElementById("auto-plan-file")?.click()}
                role="button"
                tabIndex={0}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-md)] border-2 border-dashed px-4 py-7 text-center transition ${dragOver ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]" : "border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"}`}
              >
                <FileText className="size-7 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
                <span className="text-sm font-medium">Sleep hier het scriptbestand naartoe</span>
                <span className="text-xs text-[var(--color-ink-faint)]">of klik om te kiezen · PDF of Word (.docx)</span>
              </div>
            )}
            <input id="auto-plan-file" type="file" accept=".pdf,.docx,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4">
          <Button onClick={recognize} disabled={recognizing || !aiReady} title={aiReady ? undefined : "Vereist ANTHROPIC_API_KEY"}>
            {recognizing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Video&apos;s herkennen
          </Button>
          {loadingSchedule ? <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]"><Loader2 className="size-3.5 animate-spin" /> agenda laden…</span> : null}
        </div>
        {err ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
      </Card>

      {/* Wat staat er al in de agenda — zodat je ziet waar de planner omheen werkt. */}
      {clientId && !loadingSchedule ? (
        <Card padded={false}>
          <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-5 py-3">
            <CalendarCheck className="size-4 text-[var(--color-info)]" />
            <h3 className="text-sm font-semibold">Al in de agenda</h3>
            <span className="text-xs text-[var(--color-ink-muted)]">
              {existing.length === 0 ? "nog niets gepland" : `${existing.length} ${existing.length === 1 ? "upload" : "uploads"} · ${fmtDay(existing[0]!.scheduledOn)} t/m ${fmtDay(existing[existing.length - 1]!.scheduledOn)}`}
            </span>
          </div>
          {existing.length > 0 ? (
            <ul className="max-h-48 divide-y divide-[var(--color-line)] overflow-y-auto">
              {existing.map((e, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="w-28 shrink-0 text-xs font-medium tabular-nums text-[var(--color-ink-muted)]">{fmtDay(e.scheduledOn)}</span>
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-3 text-sm text-[var(--color-ink-faint)]">Er staat nog niets ingepland voor deze klant. De planner begint vanaf vandaag.</p>
          )}
        </Card>
      ) : null}

      {/* Stap 2 — frequentie, startdatum, platforms + de nieuwe planning. */}
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
            <span className="text-sm">Nieuwe publicaties worden op werkdagen (ma–vr) gepland en slaan dagen over waarop al een upload staat. De startdatum staat standaard ná de laatste al geplande upload. Je kunt elke datum hieronder nog aanpassen.</span>
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
                  <span className={`w-24 text-xs ${weekend ? "font-medium text-[var(--color-warn)]" : "text-[var(--color-ink-muted)]"}`}>
                    {fmtDay(dates[i]!)}
                    {weekend ? " ⚠" : ""}
                  </span>
                  <button type="button" onClick={() => setTitles((cur) => cur.filter((_, j) => j !== i))} className="rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Verwijderen">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Overzicht: bestaande + nieuwe uploads samen, zodat je kunt controleren of het klopt. */}
          <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)]/40">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">
              Volledig overzicht na inplannen ({overview.length} uploads)
            </summary>
            <ul className="max-h-64 divide-y divide-[var(--color-line)] overflow-y-auto px-1 pb-1">
              {overview.map((o, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                  <span className="w-28 shrink-0 text-xs font-medium tabular-nums text-[var(--color-ink-muted)]">{fmtDay(o.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{o.title}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium ${o.kind === "nieuw" ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]"}`}>
                    {o.kind === "nieuw" ? "nieuw" : "al ingepland"}
                  </span>
                </li>
              ))}
            </ul>
          </details>

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
