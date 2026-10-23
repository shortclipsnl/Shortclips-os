"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Download, PenLine, Plus, Minus, Trash2, ArrowLeft, Sparkles, FileText, Mic, MicOff, Upload, Wand2, X, Lightbulb, Cloud, History, RotateCcw, Save, ShieldCheck, Clock, Megaphone, Sprout, Link2, AlertTriangle, ChevronDown } from "lucide-react";
import { generateScripts, reviseScript, suggestTopics, saveScriptsToLibrary, saveScriptToDrive, checkScriptQuality, listShootDaysForClient, type GeneratedScript, type QualityResult, type ContentType } from "@/server/actions/script-generate";

type ShootDay = { id: string; scheduledOn: string; title: string };
type Funnel = "TOF" | "MOF" | "BOF";
const FUNNELS: Funnel[] = ["TOF", "MOF", "BOF"];
const FUNNEL_LABEL: Record<Funnel, string> = { TOF: "Top of funnel", MOF: "Middle of funnel", BOF: "Bottom of funnel" };

type Client = { id: string; name: string; active: boolean };
type ClientFilter = "actief" | "inactief" | "alle";

type Version = { onderwerp: string; tekst: string; feedback: string; at: number };
type EditorScript = { id: string; onderwerp: string; tekst: string; versions: Version[]; contentType: ContentType; funnel?: Funnel; scriptId?: string };

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

function todayNl(): string {
  return new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

function isoToNl(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

// Snelle feedback-acties (rule: Hook sterker, Meer waarde, Minder commercieel, Meer humor, Korter, Ander concept).
const QUICK_ACTIONS: Array<{ label: string; instruction: string; newConcept?: boolean }> = [
  { label: "Hook sterker", instruction: "Maak de hook sterker: pak de eerste seconden en de nieuwsgierigheid van de kijker aan, zonder de clou weg te geven." },
  { label: "Meer waarde", instruction: "Geef het script meer waarde: voeg relevante, controleerbare informatie, uitleg of een concreet voorbeeld toe." },
  { label: "Minder commercieel", instruction: "Maak het minder commercieel: focus op de kijker en haal verkooppraatjes weg." },
  { label: "Meer humor", instruction: "Maak het grappiger en herkenbaarder, zonder het oorspronkelijke concept te verliezen." },
  { label: "Korter maken", instruction: "Maak het script korter: schrap overbodige tekst maar behoud de kern en de sterke zinnen." },
  { label: "Ander concept", instruction: "Bedenk een volledig nieuw concept met een andere invalshoek voor hetzelfde onderwerp.", newConcept: true },
];

// Advertentie-snelacties (rule 2 stap 6): invalshoek, zakelijker, commercieel, hooks, extra info, nieuw concept.
const AD_QUICK_ACTIONS: Array<{ label: string; instruction: string; newConcept?: boolean }> = [
  { label: "Hook sterker", instruction: "Maak de drie hooks sterker en scherper, elk met een eigen invalshoek, elk max 15 woorden. Laat ze alle drie op hetzelfde middenstuk aansluiten." },
  { label: "Andere invalshoek", instruction: "Kies een andere commerciële invalshoek voor dit script, met behoud van de funnelfase en de structuur." },
  { label: "Zakelijker", instruction: "Maak het zakelijker en concreter: duidelijker product, controleerbare voordelen en een scherpere call to action." },
  { label: "Minder commercieel", instruction: "Maak het iets minder hard verkopend: meer herkenning en vertrouwen, zonder het advertentiedoel te verliezen." },
  { label: "Korter maken", instruction: "Maak het script korter en strakker, passend bij de funnelfase, met behoud van de drie hooks en de call to action." },
  { label: "Ander concept", instruction: "Bedenk een volledig nieuw advertentieconcept met een andere invalshoek voor dezelfde funnelfase.", newConcept: true },
];

/* ---------------- Spraak-naar-tekst (voice mode) ---------------- */

type SpeechResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechEventLike = { resultIndex: number; results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (e: SpeechEventLike) => void; onend: () => void; onerror: (e: { error?: string }) => void;
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
function MicButton({ onText, onError, title = "Inspreken" }: { onText: (t: string) => void; onError?: (m: string) => void; title?: string }) {
  const [listening, setListening] = useState(false);
  const [mounted, setMounted] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => setMounted(true), []);
  const Ctor = speechCtor();
  // Pas na mount renderen: zo is de server- en client-render gelijk (geen hydration-mismatch).
  if (!mounted || !Ctor) return null;

  const stop = () => { try { recRef.current?.stop(); } catch { /* al gestopt */ } recRef.current = null; setListening(false); };
  const start = () => {
    try {
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
      r.onerror = (ev: { error?: string }) => {
        setListening(false);
        const code = ev?.error ?? "";
        const msg =
          code === "not-allowed" || code === "service-not-allowed"
            ? "Microfoon is geblokkeerd. Geef deze site toegang tot de microfoon en probeer opnieuw."
            : code === "no-speech"
              ? "Geen spraak gehoord. Probeer opnieuw."
              : code === "audio-capture"
                ? "Geen microfoon gevonden."
                : "Inspreken lukt niet in deze browser. Gebruik Chrome, of typ het.";
        onError?.(msg);
      };
      recRef.current = r;
      r.start();
      setListening(true);
    } catch {
      onError?.("Inspreken kon niet starten. Gebruik Chrome, of typ het.");
      setListening(false);
    }
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

const appendText = (prev: string, add: string) => prev + (prev && !prev.endsWith("\n") && !prev.endsWith(" ") ? " " : "") + add;

const scoreColor = (n: number) => (n >= 7 ? "var(--color-good)" : n >= 4 ? "var(--color-warn)" : "var(--color-bad)");

/* ---------------- component ---------------- */

export function ScriptGeneratorChat({ clients, aiReady, initialClientId }: { clients: Client[]; aiReady: boolean; initialClientId?: string }) {
  // Vooraf geselecteerde klant (bijv. vanaf de scriptingpagina).
  const preClient = initialClientId && clients.some((c) => c.id === initialClientId) ? initialClientId : "";
  // Instellingen
  const [clientId, setClientId] = useState<string>(preClient);
  const [otherName, setOtherName] = useState<string>("");
  const [showOther, setShowOther] = useState(false);
  // Als de voorgeselecteerde klant niet actief is, toon toch alle klanten zodat die zichtbaar is.
  const [filter, setFilter] = useState<ClientFilter>(preClient && !clients.find((c) => c.id === preClient)?.active ? "alle" : "actief");
  const [count, setCount] = useState(3);
  const [contentType, setContentType] = useState<ContentType>("organisch");
  // Advertenties: verdeling over de funnel (standaard 2/2/2 = 6 scripts).
  const [funnelSplit, setFunnelSplit] = useState<Record<Funnel, number>>({ TOF: 2, MOF: 2, BOF: 2 });
  const [brief, setBrief] = useState("");
  const [priorFiles, setPriorFiles] = useState<Array<{ name: string; text: string }>>([]);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [useDrive, setUseDrive] = useState(true);
  const [topicsBusy, setTopicsBusy] = useState(false);

  // Resultaat (bewerkbaar)
  const [scripts, setScripts] = useState<EditorScript[] | null>(null);
  const [klantnaam, setKlantnaam] = useState("");
  const [opnamedag, setOpnamedag] = useState(todayNl());
  const [genClientId, setGenClientId] = useState<string>("");
  const [genClientName, setGenClientName] = useState<string>("");
  const [shootDays, setShootDays] = useState<ShootDay[]>([]);
  const [shootDayId, setShootDayId] = useState<string>("");

  // Aanpassen per script
  const [reviseId, setReviseId] = useState<string | null>(null);
  const [reviseText, setReviseText] = useState("");
  const [versionsId, setVersionsId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Kwaliteitscontrole per script
  const [qualityById, setQualityById] = useState<Record<string, QualityResult>>({});
  const [qualityBusyId, setQualityBusyId] = useState<string | null>(null);
  const [qualityOpenId, setQualityOpenId] = useState<string | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [driveSaving, setDriveSaving] = useState(false);
  const [driveMsg, setDriveMsg] = useState<{ text: string; link?: string } | null>(null);
  // Koppelen aan opname (4e actie) + waarschuwing bij goedgekeurde scripts.
  const [coupleOpen, setCoupleOpen] = useState(false);
  const [coupleBusy, setCoupleBusy] = useState(false);
  const [coupleMsg, setCoupleMsg] = useState<string | null>(null);
  const [blockedApproved, setBlockedApproved] = useState<Array<{ index: number; title: string }>>([]);
  const [lastCoupleDayId, setLastCoupleDayId] = useState<string | undefined>(undefined);

  const visibleClients = clients.filter((c) => (filter === "alle" ? true : filter === "actief" ? c.active : !c.active));
  const selectedName = clientId ? clients.find((c) => c.id === clientId)?.name ?? "" : "";
  const effectiveClientName = showOther ? otherName.trim() : selectedName;

  const isAd = contentType === "advertentie";
  const adTotal = funnelSplit.TOF + funnelSplit.MOF + funnelSplit.BOF;
  const funnelsOrdered = (): Funnel[] => FUNNELS.flatMap((f) => Array.from<Funnel>({ length: funnelSplit[f] }).fill(f));
  const setFunnel = (f: Funnel, n: number) => setFunnelSplit((s) => ({ ...s, [f]: Math.max(0, Math.min(8, n)) }));

  const addPdfFiles = async (files: FileList | null) => {
    if (!files) return;
    setErr(null);
    setPdfBusy(true);
    try {
      const { extractPdfText } = await import("@/lib/pdf-text");
      for (const f of Array.from(files)) {
        if (!(f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) { setErr("Alleen PDF-bestanden kunnen erbij."); continue; }
        if (priorFiles.length >= 4) break;
        try {
          const text = await extractPdfText(f);
          if (!text) { setErr(`Uit "${f.name}" kwam geen tekst (misschien een scan zonder tekstlaag).`); continue; }
          setPriorFiles((p) => (p.length >= 4 ? p : [...p, { name: f.name, text }]));
        } catch { setErr(`"${f.name}" kon niet worden gelezen.`); }
      }
    } finally {
      setPdfBusy(false);
    }
  };

  const priorText = () => priorFiles.map((p) => `--- ${p.name} ---\n${p.text}`).join("\n\n").slice(0, 24000);

  const generate = () => {
    if (isAd && adTotal === 0) { setErr("Kies minstens één advertentiescript (TOF, MOF of BOF)."); return; }
    setErr(null);
    start(async () => {
      const res = await generateScripts({
        clientId: showOther ? undefined : clientId || undefined,
        clientName: showOther ? otherName.trim() || undefined : undefined,
        count: isAd ? adTotal : count,
        brief: brief.trim() || undefined,
        priorText: priorFiles.length ? priorText() : undefined,
        useDriveScripts: !showOther && !!clientId && useDrive,
        withPoll: true, // organisch: standaard-CTA; de poll-keuze staat nu ná generatie per script
        contentType,
        funnels: isAd ? funnelsOrdered() : undefined,
      });
      if (res.ok) {
        setScripts(res.scripts.map((s: GeneratedScript) => ({ id: uid(), onderwerp: s.onderwerp, tekst: s.tekst, versions: [], contentType: s.contentType ?? contentType, funnel: s.funnel })));
        setKlantnaam(res.klantnaam || effectiveClientName || "");
        const gcid = showOther ? "" : clientId;
        setGenClientId(gcid);
        setGenClientName(showOther ? otherName.trim() : selectedName);
        // Opnamedagen van deze klant ophalen om direct aan te koppelen.
        setShootDays([]); setShootDayId("");
        if (gcid) {
          listShootDaysForClient(gcid).then((days) => {
            setShootDays(days);
            if (days.length > 0) { setShootDayId(days[0]!.id); setOpnamedag(isoToNl(days[0]!.scheduledOn)); }
          }).catch(() => {});
        }
      } else {
        setErr(res.message);
      }
    });
  };

  const fetchTopics = () => {
    setErr(null);
    setTopicsBusy(true);
    (async () => {
      const res = await suggestTopics({
        clientId: showOther ? undefined : clientId || undefined,
        clientName: showOther ? otherName.trim() || undefined : undefined,
      });
      if (res.ok) setBrief((prev) => (prev.trim() ? prev.trim() + "\n" : "") + res.topics.join("\n"));
      else setErr(res.message);
      setTopicsBusy(false);
    })();
  };

  /**
   * Opslaan/bijwerken in de bibliotheek, idempotent: bestaande scripts (met een
   * eerder bewaard scriptId) worden bijgewerkt i.p.v. gedupliceerd. Koppelt
   * optioneel aan een opname. Goedgekeurde scripts worden niet overschreven
   * zonder bevestiging (force).
   */
  const persistScripts = async (opts: { productionDayId?: string; force?: boolean }): Promise<{ ok: boolean; blocked: number }> => {
    if (!scripts || scripts.length === 0 || !genClientId) return { ok: false, blocked: 0 };
    const res = await saveScriptsToLibrary({
      clientId: genClientId,
      scripts: scripts.map((s) => ({ onderwerp: s.onderwerp, tekst: s.tekst, contentType: s.contentType, funnel: s.funnel, scriptId: s.scriptId })),
      productionDayId: opts.productionDayId,
      force: opts.force,
    });
    if (!res.ok) { setErr(res.message); return { ok: false, blocked: 0 }; }
    // Bewaar de script-id's op de kaarten, zodat opnieuw opslaan bijwerkt (geen duplicaat).
    setScripts((prev) => prev ? prev.map((s, i) => { const hit = res.saved.find((x) => x.index === i); return hit ? { ...s, scriptId: hit.scriptId } : s; }) : prev);
    setBlockedApproved(res.blocked);
    return { ok: true, blocked: res.blocked.length };
  };

  const saveToLibrary = async () => {
    if (!scripts || scripts.length === 0 || !genClientId) return;
    setSaving(true); setErr(null); setSavedMsg(null); setCoupleMsg(null);
    setLastCoupleDayId(shootDayId || undefined);
    try {
      const r = await persistScripts({ productionDayId: shootDayId || undefined });
      if (r.ok) setSavedMsg(`${scripts.length - r.blocked} script${scripts.length - r.blocked === 1 ? "" : "s"} opgeslagen in de scriptbibliotheek${shootDayId ? " en gekoppeld aan de opname (zichtbaar bij Scripting)" : ""}.`);
    } finally { setSaving(false); }
  };

  // 4e actie: koppelen aan een geplande opname van deze klant.
  const coupleToShoot = async (dayId: string, dayLabel: string) => {
    if (!scripts || scripts.length === 0 || !genClientId || coupleBusy) return;
    setCoupleBusy(true); setErr(null); setSavedMsg(null); setCoupleMsg(null); setCoupleOpen(false);
    setLastCoupleDayId(dayId);
    try {
      const r = await persistScripts({ productionDayId: dayId });
      if (r.ok) {
        setShootDayId(dayId);
        setCoupleMsg(`${scripts.length - r.blocked} script${scripts.length - r.blocked === 1 ? "" : "s"} gekoppeld aan de opname van ${dayLabel}. Te zien bij Scripting.`);
      }
    } finally { setCoupleBusy(false); }
  };

  // "Toch overschrijven" na een waarschuwing over goedgekeurde scripts.
  const forceOverwrite = async () => {
    setCoupleBusy(true); setErr(null);
    try {
      const r = await persistScripts({ productionDayId: lastCoupleDayId, force: true });
      if (r.ok) { setCoupleMsg("Alle scripts (inclusief de goedgekeurde) zijn bijgewerkt."); setBlockedApproved([]); }
    } finally { setCoupleBusy(false); }
  };

  const saveToDrive = async () => {
    if (!scripts || scripts.length === 0 || !genClientId) return;
    setDriveSaving(true);
    setErr(null);
    setDriveMsg(null);
    try {
      const res = await saveScriptToDrive({ clientId: genClientId, klantnaam, opnamedag, scripts: scripts.map((s) => ({ onderwerp: s.onderwerp, tekst: s.tekst })) });
      if (res.ok) setDriveMsg({ text: `Opgeslagen in de Drive-map "${res.folderName}" van de klant als "${res.fileName}".`, link: res.link });
      else setErr(res.message);
    } finally {
      setDriveSaving(false);
    }
  };

  const exportPdf = async () => {
    if (!scripts || scripts.length === 0) return;
    setExporting(true);
    setErr(null);
    try {
      const { downloadScriptPdf } = await import("@/lib/script-pdf");
      await downloadScriptPdf({ klantnaam, opnamedag, scripts: scripts.map((s) => ({ onderwerp: s.onderwerp, tekst: s.tekst })) });
    } catch {
      setErr("Het PDF-bestand kon niet worden gemaakt. Probeer het nog eens.");
    } finally {
      setExporting(false);
    }
  };

  const updateScript = (id: string, patch: Partial<Pick<EditorScript, "onderwerp" | "tekst">>) =>
    setScripts((prev) => (prev ? prev.map((s) => (s.id === id ? { ...s, ...patch } : s)) : prev));
  const removeScript = (id: string) => setScripts((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
  const addScript = () => setScripts((prev) => [...(prev ?? []), { id: uid(), onderwerp: "", tekst: "", versions: [], contentType, funnel: isAd ? "TOF" : undefined }]);

  // Eén aanpassing (snelle actie of vrije tekst/spraak). Bewaart de vorige versie met de feedback.
  // withPoll (optioneel, organisch) forceert de CTA mét/zonder poll ná generatie.
  const runRevise = (id: string, instruction: string, feedbackLabel: string, newConcept?: boolean, withPoll?: boolean) => {
    const s = scripts?.find((x) => x.id === id);
    if (!s || !instruction.trim() || busyId) return;
    setBusyId(id);
    setErr(null);
    (async () => {
      const res = await reviseScript({
        onderwerp: s.onderwerp,
        tekst: s.tekst,
        instruction,
        newConcept,
        clientId: genClientId || undefined,
        clientName: genClientId ? undefined : genClientName || undefined,
        contentType: s.contentType,
        funnel: s.funnel,
        withPoll,
      });
      if (res.ok) {
        setScripts((prev) => prev?.map((x) => x.id === id ? {
          ...x,
          onderwerp: res.script.onderwerp,
          tekst: res.script.tekst,
          versions: [{ onderwerp: x.onderwerp, tekst: x.tekst, feedback: feedbackLabel, at: Date.now() }, ...x.versions].slice(0, 25),
        } : x) ?? prev);
        setReviseId(null);
        setReviseText("");
      } else setErr(res.message);
      setBusyId(null);
    })();
  };

  const checkQuality = (id: string) => {
    const s = scripts?.find((x) => x.id === id);
    if (!s || qualityBusyId) return;
    setQualityBusyId(id);
    setErr(null);
    (async () => {
      const res = await checkScriptQuality({
        onderwerp: s.onderwerp,
        tekst: s.tekst,
        clientId: genClientId || undefined,
        clientName: genClientId ? undefined : genClientName || undefined,
        contentType: s.contentType,
        funnel: s.funnel,
      });
      if (res.ok) { setQualityById((m) => ({ ...m, [id]: res.data })); setQualityOpenId(id); }
      else setErr(res.message);
      setQualityBusyId(null);
    })();
  };

  const revert = (id: string, idx: number) => {
    setScripts((prev) => prev?.map((x) => {
      if (x.id !== id) return x;
      const v = x.versions[idx];
      if (!v) return x;
      const rest = x.versions.filter((_, i) => i !== idx);
      return {
        ...x,
        onderwerp: v.onderwerp,
        tekst: v.tekst,
        versions: [{ onderwerp: x.onderwerp, tekst: x.tekst, feedback: "Teruggezet naar eerdere versie", at: Date.now() }, ...rest].slice(0, 25),
      };
    }) ?? prev);
  };

  if (!aiReady) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-muted)]">
        De AI-schrijver staat nog uit. Zodra de ANTHROPIC_API_KEY is ingesteld, kun je hier scripts schrijven.
      </div>
    );
  }

  // ---------- RESULTAAT (iteratieve editor) ----------
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
              {shootDays.length > 0 ? (
                <>
                  <select
                    value={shootDayId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setShootDayId(id);
                      const day = shootDays.find((d) => d.id === id);
                      if (day) setOpnamedag(isoToNl(day.scheduledOn));
                    }}
                    className="sc-input h-9 w-full text-sm"
                  >
                    {shootDays.map((d) => (
                      <option key={d.id} value={d.id}>{isoToNl(d.scheduledOn)} — {d.title}</option>
                    ))}
                    <option value="">Andere datum…</option>
                  </select>
                  {shootDayId === "" ? (
                    <input value={opnamedag} onChange={(e) => setOpnamedag(e.target.value)} placeholder="bijv. 9 november 2026" className="sc-input mt-2 h-9 w-full text-sm" />
                  ) : (
                    <span className="mt-1 block text-2xs text-[var(--color-good)]">Wordt gekoppeld aan deze opnamedag in de planning.</span>
                  )}
                </>
              ) : (
                <input value={opnamedag} onChange={(e) => setOpnamedag(e.target.value)} placeholder="bijv. 9 november 2026" className="sc-input h-9 w-full text-sm" />
              )}
            </label>
          </div>
        </div>

        {/* Scripts — iteratief bewerkbaar */}
        {scripts.map((s, i) => {
          const busy = busyId === s.id;
          return (
            <div key={s.id} className={`rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] ${busy ? "border-[var(--color-brand-400)]" : "border-[var(--color-line)]"}`}>
              <div className="mb-2 flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-brand-600)] text-2xs font-bold text-white">{i + 1}</span>
                {s.contentType === "advertentie" && s.funnel ? (
                  <span title={`Advertentie · ${FUNNEL_LABEL[s.funnel]}`} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-violet)] px-2 py-0.5 text-2xs font-bold text-[var(--color-violet)]">
                    <Megaphone className="size-3" /> {s.funnel}
                  </span>
                ) : null}
                <input
                  value={s.onderwerp}
                  onChange={(e) => updateScript(s.id, { onderwerp: e.target.value })}
                  placeholder="Onderwerp / videotitel"
                  className="sc-input h-9 flex-1 text-sm font-semibold"
                />
                {s.versions.length > 0 ? (
                  <button type="button" onClick={() => setVersionsId(versionsId === s.id ? null : s.id)} title="Versies" className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-2xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]">
                    <History className="size-3.5" /> {s.versions.length}
                  </button>
                ) : null}
                <button type="button" onClick={() => { setReviseId(reviseId === s.id ? null : s.id); setReviseText(""); }} title="Eigen feedback geven" className="shrink-0 rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-brand-600)]">
                  <Wand2 className="size-4" />
                </button>
                <button type="button" onClick={() => removeScript(s.id)} title="Verwijder dit script" className="shrink-0 rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]">
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="flex items-start gap-2">
                <textarea
                  value={s.tekst}
                  onChange={(e) => updateScript(s.id, { tekst: e.target.value })}
                  rows={14}
                  spellCheck
                  disabled={busy}
                  className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--color-ink)] focus:border-[var(--color-brand-500)] focus:outline-none disabled:opacity-60"
                />
                <MicButton onText={(t) => updateScript(s.id, { tekst: appendText(s.tekst, t) })} onError={setErr} title="Tekst inspreken" />
              </div>

              {/* Snelle feedback-acties — per contenttype */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {busy ? <span className="inline-flex items-center gap-1.5 text-2xs text-[var(--color-brand-700)]"><Loader2 className="size-3.5 animate-spin" /> Bezig…</span> : null}
                {(s.contentType === "advertentie" ? AD_QUICK_ACTIONS : QUICK_ACTIONS).map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    disabled={!!busyId}
                    onClick={() => runRevise(s.id, a.instruction, a.label, a.newConcept)}
                    className={`rounded-full border px-2.5 py-1 text-2xs font-medium transition disabled:opacity-40 ${a.newConcept ? "border-[var(--color-violet)] text-[var(--color-violet)] hover:bg-[var(--color-violet-soft,transparent)]" : "border-[var(--color-line-strong)] text-[var(--color-ink)] hover:border-[var(--color-brand-500)]"}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              {/* Call to action: poll-keuze pas ná generatie, per organisch script */}
              {s.contentType !== "advertentie" ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-2xs font-medium text-[var(--color-ink-faint)]">Call to action:</span>
                  <button type="button" disabled={!!busyId} onClick={() => runRevise(s.id, "Zet de call to action om naar een social media poll: sluit af met de kop SOCIAL MEDIA POLL KEUZES en precies twee korte, verschillende keuzes. Laat de rest van het script staan.", "CTA met poll", false, true)} className="rounded-full border border-[var(--color-line-strong)] px-2.5 py-1 text-2xs font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)] disabled:opacity-40">+ Poll</button>
                  <button type="button" disabled={!!busyId} onClick={() => runRevise(s.id, "Haal de social media poll weg en sluit af met één duidelijke call to action (een vraag of oproep) passend bij het onderwerp. Laat de rest van het script staan.", "CTA zonder poll", false, false)} className="rounded-full border border-[var(--color-line-strong)] px-2.5 py-1 text-2xs font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)] disabled:opacity-40">Zonder poll</button>
                </div>
              ) : null}

              {/* Kwaliteitscontrole */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => checkQuality(s.id)} disabled={qualityBusyId === s.id} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] px-2.5 py-1 text-2xs font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)] disabled:opacity-40">
                  {qualityBusyId === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Controleer kwaliteit
                </button>
                {qualityById[s.id] ? (
                  <button type="button" onClick={() => setQualityOpenId(qualityOpenId === s.id ? null : s.id)} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-bold text-white" style={{ background: scoreColor(qualityById[s.id]!.scoreTotaal ?? 0) }}>
                    {qualityById[s.id]!.scoreTotaal ?? "?"}/10
                  </button>
                ) : null}
              </div>

              {/* Kwaliteitspaneel */}
              {qualityOpenId === s.id && qualityById[s.id] ? (() => {
                const q = qualityById[s.id]!;
                return (
                  <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 text-xs">
                    <div className="mb-2 flex items-start gap-2">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: scoreColor(q.scoreTotaal ?? 0) }}>{q.scoreTotaal ?? "?"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[var(--color-ink)]">{q.oordeel || "Beoordeling"}</p>
                        <p className="mt-0.5 inline-flex items-center gap-1 text-2xs text-[var(--color-ink-muted)]"><Clock className="size-3" /> ~{q.speaking.seconds}s · {q.speaking.words} woorden <span className="text-[var(--color-ink-faint)]">(richtlijn 30–33s / 80–95 woorden)</span></p>
                      </div>
                    </div>

                    {q.punten.length ? (
                      <ul className="mb-2 grid gap-1 sm:grid-cols-2">
                        {q.punten.map((p, pi) => (
                          <li key={pi} className="flex items-start gap-1.5">
                            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white" style={{ background: scoreColor(p.score) }}>{p.score}</span>
                            <span className="min-w-0"><span className="font-medium text-[var(--color-ink)]">{p.dimensie}.</span> <span className="text-[var(--color-ink-muted)]">{p.waarom}</span></span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {q.sterk.length ? <p className="mt-1.5 text-[var(--color-ink-muted)]"><span className="font-semibold text-[var(--color-good)]">Sterk:</span> {q.sterk.join(" · ")}</p> : null}
                    {q.verbeteren.length ? <p className="mt-1 text-[var(--color-ink-muted)]"><span className="font-semibold text-[var(--color-warn)]">Verbeteren:</span> {q.verbeteren.join(" · ")}</p> : null}
                    {q.feitenControleren.length ? <p className="mt-1 text-[var(--color-ink-muted)]"><span className="font-semibold text-[var(--color-bad)]">Feiten controleren:</span> {q.feitenControleren.join(" · ")}</p> : null}

                    {q.alternatieveHooks.length ? (
                      <div className="mt-2">
                        <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Sterkere hooks</span>
                        <ul className="space-y-1">
                          {q.alternatieveHooks.map((h, hi) => (
                            <li key={hi} className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 text-[var(--color-ink)]">{h}</span>
                              <button type="button" disabled={!!busyId} onClick={() => runRevise(s.id, `Vervang de hook door: "${h}". Laat de rest van het script staan.`, "Hook vervangen")} className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-0.5 text-2xs font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)] disabled:opacity-40">
                                <Wand2 className="size-3" /> Gebruik
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                );
              })() : null}

              {/* Versiegeschiedenis */}
              {versionsId === s.id && s.versions.length > 0 ? (
                <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2.5">
                  <span className="mb-1.5 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Eerdere versies</span>
                  <ul className="space-y-1">
                    {s.versions.map((v, vi) => (
                      <li key={vi} className="flex items-center gap-2 text-2xs">
                        <span className="min-w-0 flex-1 truncate text-[var(--color-ink-muted)]">
                          <span className="text-[var(--color-ink)]">{v.feedback}</span>
                          <span className="text-[var(--color-ink-faint)]"> · {new Date(v.at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span>
                        </span>
                        <button type="button" onClick={() => revert(s.id, vi)} className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-0.5 font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)]">
                          <RotateCcw className="size-3" /> Herstel
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Eigen feedback (typen of inspreken) */}
              {reviseId === s.id ? (
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
                    <MicButton onText={(t) => setReviseText((p) => appendText(p, t))} onError={setErr} title="Feedback inspreken" />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" onClick={() => runRevise(s.id, reviseText.trim(), "Eigen feedback: " + reviseText.trim().slice(0, 60))} disabled={!!busyId || !reviseText.trim()} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40">
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />} Pas aan
                    </button>
                    <button type="button" onClick={() => { setReviseId(null); setReviseText(""); }} className="text-2xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">Annuleer</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        <button type="button" onClick={addScript} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-2 text-xs font-medium text-[var(--color-ink-muted)] hover:border-[var(--color-brand-500)] hover:text-[var(--color-ink)]">
          <Plus className="size-3.5" /> Leeg script toevoegen
        </button>

        {err ? <p className="text-2xs text-[var(--color-bad)]">{err}</p> : null}
        {savedMsg ? (
          <p className="text-2xs text-[var(--color-good)]">{savedMsg} <a href="/scripts" className="font-semibold underline">Open de scriptbibliotheek</a></p>
        ) : null}
        {driveMsg ? (
          <p className="text-2xs text-[var(--color-good)]">{driveMsg.text}{driveMsg.link ? <> <a href={driveMsg.link} target="_blank" rel="noreferrer" className="font-semibold underline">Open in Drive</a></> : null}</p>
        ) : null}
        {coupleMsg ? (
          <p className="text-2xs text-[var(--color-good)]">{coupleMsg} <a href="/scripting" className="font-semibold underline">Open Scripting</a></p>
        ) : null}
        {blockedApproved.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-warn)] bg-[var(--color-warn-soft)] px-3 py-2 text-2xs text-[#8a5300]">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{blockedApproved.length} al goedgekeurd{blockedApproved.length === 1 ? " script is" : "e scripts zijn"} niet overschreven: {blockedApproved.map((b) => b.title).join(", ")}.</span>
            <button type="button" onClick={forceOverwrite} disabled={coupleBusy} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[#8a5300] px-2 py-0.5 font-semibold hover:bg-white/40 disabled:opacity-40">
              {coupleBusy ? <Loader2 className="size-3 animate-spin" /> : null} Toch overschrijven
            </button>
          </div>
        ) : null}

        {/* Actiebalk */}
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)]/95 p-3 shadow-[var(--shadow-card)] backdrop-blur">
          <button type="button" onClick={() => { setScripts(null); setErr(null); setSavedMsg(null); setDriveMsg(null); setCoupleMsg(null); setBlockedApproved([]); setCoupleOpen(false); setReviseId(null); setVersionsId(null); setShootDays([]); setShootDayId(""); }} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface)]">
            <ArrowLeft className="size-4" /> Nieuwe set
          </button>
          <span className="text-2xs text-[var(--color-ink-faint)]">{scripts.length} script{scripts.length === 1 ? "" : "s"} · geef feedback tot het klopt</span>
          <div className="ml-auto flex items-center gap-2">
            {/* 4e actie: koppelen aan een geplande opname (alleen opnames van deze klant). */}
            <div className="relative">
              <button
                type="button"
                onClick={() => { if (genClientId) setCoupleOpen((o) => !o); }}
                disabled={coupleBusy || scripts.length === 0 || !genClientId}
                title={genClientId ? "Koppel de scripts aan een geplande opname" : "Kies een vastgelegde klant om te kunnen koppelen"}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-brand-300)] bg-[var(--color-brand-50)] px-3 py-2 text-sm font-medium text-[var(--color-brand-700)] hover:border-[var(--color-brand-500)] disabled:opacity-40"
              >
                {coupleBusy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Koppelen aan opname
                <ChevronDown className="size-3.5 opacity-60" />
              </button>
              {coupleOpen ? (
                <>
                  <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setCoupleOpen(false)} />
                  <div className="absolute bottom-full right-0 z-20 mb-1.5 w-72 max-w-[85vw] rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-raised)]">
                    <span className="mb-1 block px-1 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Kies de opname</span>
                    {shootDays.length === 0 ? (
                      <p className="px-1 py-2 text-2xs text-[var(--color-ink-faint)]">Deze klant heeft geen aankomende opnames in de planning.</p>
                    ) : (
                      <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                        {shootDays.map((d) => (
                          <li key={d.id}>
                            <button type="button" onClick={() => coupleToShoot(d.id, isoToNl(d.scheduledOn))} className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface-sunken)] ${shootDayId === d.id ? "font-semibold text-[var(--color-brand-700)]" : "text-[var(--color-ink)]"}`}>
                              <Clock className="size-4 shrink-0 text-[var(--color-brand-600)]" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{isoToNl(d.scheduledOn)}</span>
                                <span className="block truncate text-2xs text-[var(--color-ink-faint)]">{d.title}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : null}
            </div>
            <button
              type="button"
              onClick={saveToLibrary}
              disabled={saving || scripts.length === 0 || !genClientId}
              title={genClientId ? "Opslaan in de scriptbibliotheek" : "Kies een vastgelegde klant om op te kunnen slaan"}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)] disabled:opacity-40"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Opslaan in bibliotheek
            </button>
            <button
              type="button"
              onClick={saveToDrive}
              disabled={driveSaving || scripts.length === 0 || !genClientId}
              title={genClientId ? "Opslaan in de Google Drive-map van de klant" : "Kies een vastgelegde klant om op te kunnen slaan"}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)] disabled:opacity-40"
            >
              {driveSaving ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />} Opslaan in Drive
            </button>
            <button
              type="button"
              onClick={exportPdf}
              disabled={exporting || scripts.length === 0}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
            >
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Exporteer als PDF
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- INSTELLINGEN ----------
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-5 shadow-[var(--shadow-card)]">
      {/* Contenttype: organisch of advertentie */}
      <div className="mb-5">
        <span className="mb-2 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Wat voor scripts?</span>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setContentType("organisch")}
            className={`flex items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left transition ${!isAd ? "border-[var(--color-brand-600)] bg-[var(--color-brand-50)]" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] hover:border-[var(--color-brand-500)]"}`}
          >
            <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${!isAd ? "bg-[var(--color-brand-600)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}><Sprout className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-[var(--color-ink)]">Organische scripts</span>
              <span className="block text-2xs text-[var(--color-ink-muted)]">Bereik, kijkduur, engagement en herkenbaarheid. TikTok, Reels en Shorts.</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setContentType("advertentie")}
            className={`flex items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left transition ${isAd ? "border-[var(--color-violet)] bg-[var(--color-violet-soft,var(--color-brand-50))]" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] hover:border-[var(--color-brand-500)]"}`}
          >
            <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${isAd ? "bg-[var(--color-violet)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}><Megaphone className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-[var(--color-ink)]">Advertentiescripts</span>
              <span className="block text-2xs text-[var(--color-ink-muted)]">Conversie, leads en verkopen via Meta. Opgebouwd per funnelfase (TOF/MOF/BOF).</span>
            </span>
          </button>
        </div>
      </div>

      {/* Klantkeuze + filter */}
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Voor welke klant?</span>
          <div className="inline-flex rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5 text-2xs">
            {(["actief", "inactief", "alle"] as const).map((f) => {
              const sel = filter === f;
              const selClass = f === "actief" ? "bg-[var(--color-good)] text-white" : f === "inactief" ? "bg-[var(--color-bad)] text-white" : "bg-[var(--color-brand-600)] text-white";
              return (
                <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1 font-medium transition ${sel ? selClass : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
                  {f === "actief" ? "Actief" : f === "inactief" ? "Niet-actief" : "Alle"}
                </button>
              );
            })}
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
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${active ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand-500)]"}`}
              >
                <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: c.active ? "var(--color-good)" : "var(--color-bad)" }} />
                {c.name}
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

      {/* Aantal scripts — organisch: vrij aantal; advertentie: verdeling over de funnel */}
      {!isAd ? (
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
      ) : (
        <div className="mb-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Verdeling over de funnel</span>
            <span className="text-2xs text-[var(--color-ink-faint)]">Totaal <span className="font-bold tabular-nums text-[var(--color-ink)]">{adTotal}</span> script{adTotal === 1 ? "" : "s"} · standaard 2/2/2</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {FUNNELS.map((f) => (
              <div key={f} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--color-ink)]">{f}</span>
                  <span className="text-2xs text-[var(--color-ink-faint)]">{FUNNEL_LABEL[f]}</span>
                </div>
                <div className="mt-1.5 inline-flex items-center gap-2">
                  <button type="button" onClick={() => setFunnel(f, funnelSplit[f] - 1)} className="grid size-7 place-items-center rounded-[var(--radius-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-30" disabled={funnelSplit[f] <= 0}><Minus className="size-3.5" /></button>
                  <span className="w-6 text-center text-base font-bold tabular-nums text-[var(--color-ink)]">{funnelSplit[f]}</span>
                  <button type="button" onClick={() => setFunnel(f, funnelSplit[f] + 1)} className="grid size-7 place-items-center rounded-[var(--radius-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-30" disabled={adTotal >= 8}><Plus className="size-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-2xs text-[var(--color-ink-faint)]">TOF = koud publiek · MOF = vergelijkt oplossingen · BOF = klaar om te kopen. De call to action (incl. poll) stel je per script in ná het genereren.</p>
        </div>
      )}

      {/* Eerdere scripts — automatisch uit Drive + handmatig toevoegen */}
      <div className="mb-5">
        <span className="mb-2 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Eerdere scripts als basis <span className="font-normal normal-case text-[var(--color-ink-faint)]">— optioneel</span></span>

        {!showOther && clientId ? (
          <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-ink)]">
            <input type="checkbox" checked={useDrive} onChange={(e) => setUseDrive(e.target.checked)} className="size-4 accent-[var(--color-brand-600)]" />
            <Cloud className="size-4 text-[var(--color-brand-600)]" />
            <span>Eerdere scripts automatisch uit de Google Drive-map van deze klant halen</span>
          </label>
        ) : null}

        <label
          onDragOver={(e) => { e.preventDefault(); if (!pdfBusy) setDragOver(true); }}
          onDragEnter={(e) => { e.preventDefault(); if (!pdfBusy) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!pdfBusy) addPdfFiles(e.dataTransfer.files); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border-2 border-dashed px-3 py-5 text-center text-sm transition ${dragOver ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:border-[var(--color-brand-500)]"} ${pdfBusy ? "opacity-60" : ""}`}
        >
          {pdfBusy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
          <span className="font-medium">{pdfBusy ? "Tekst uitlezen…" : dragOver ? "Laat los om toe te voegen" : "Sleep scriptbestanden hierheen of klik om te kiezen"}</span>
          <span className="text-2xs text-[var(--color-ink-faint)]">PDF · ook grote bestanden</span>
          <input type="file" accept="application/pdf" multiple disabled={pdfBusy} className="hidden" onChange={(e) => { addPdfFiles(e.target.files); e.currentTarget.value = ""; }} />
        </label>
        {priorFiles.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {priorFiles.map((p, i) => (
              <li key={i} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-2xs text-[var(--color-ink)]">
                <FileText className="size-3" /> <span className="max-w-[180px] truncate">{p.name}</span>
                <button type="button" onClick={() => setPriorFiles((prev) => prev.filter((_, idx) => idx !== i))} className="text-[var(--color-ink-muted)] hover:text-[var(--color-bad)]"><X className="size-3" /></button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1.5 text-2xs text-[var(--color-ink-faint)]">Hij gebruikt deze als basis: zelfde stijl en opbouw, maar nieuwe scripts. Van een PDF wordt alleen de tekst gebruikt, dus grootte maakt niet uit.</p>
      </div>

      {/* Onderwerpen / wensen + voice + AI-suggesties */}
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{isAd ? "Campagnedoel, product of actie" : "Onderwerpen of hooks"} <span className="font-normal normal-case text-[var(--color-ink-faint)]">— optioneel, typen of inspreken</span></span>
          {!isAd ? (
            <button type="button" onClick={fetchTopics} disabled={topicsBusy} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-2xs font-medium text-[var(--color-brand-700)] hover:border-[var(--color-brand-500)] disabled:opacity-50">
              {topicsBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Lightbulb className="size-3.5" />} Laat de AI onderwerpen kiezen
            </button>
          ) : null}
        </div>
        <div className="flex items-start gap-2">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            placeholder={isAd
              ? "Bijv. campagnedoel (leads, aanvragen, verkopen, afspraken), het product/de dienst, de doelgroep of een lopende actie.\nLaat leeg om de schrijver een logisch commercieel doel te laten kiezen."
              : "Laat leeg om de schrijver zelf onderwerpen te laten kiezen.\nOf geef bv. hooks, producten, acties of een thema."}
            className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand-500)] focus:outline-none"
          />
          <MicButton onText={(t) => setBrief((p) => appendText(p, t))} onError={setErr} title="Onderwerpen inspreken" />
        </div>
      </div>

      {err ? <p className="mb-3 text-2xs text-[var(--color-bad)]">{err}</p> : null}

      <button
        type="button"
        onClick={generate}
        disabled={pending || (isAd && adTotal === 0)}
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : isAd ? <Megaphone className="size-4" /> : <PenLine className="size-4" />}
        {(() => { const n = isAd ? adTotal : count; const noun = isAd ? `advertentiescript${n === 1 ? "" : "s"}` : `script${n === 1 ? "" : "s"}`; return pending ? `${n} ${noun} schrijven…` : `Schrijf ${n} ${noun}`; })()}
      </button>
      <p className="mt-3 flex items-center gap-1.5 text-2xs text-[var(--color-ink-faint)]">
        <Sparkles className="size-3" /> {isAd
          ? "Advertenties (Meta), volgens het Advertentiehandboek: per funnelfase, drie hooks per script, Meta-check. Daarna verbeter je per script en download je als PDF."
          : "Organisch (TikTok/Reels), volgens het Scripthandboek. Daarna verbeter je met gerichte feedback en download je als PDF."}
      </p>
    </div>
  );
}
