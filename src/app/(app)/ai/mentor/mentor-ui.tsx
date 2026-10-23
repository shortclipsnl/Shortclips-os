"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Send, Loader2, Mic, MicOff, Copy, Check, Plus, Search, Pin, Pencil, Trash2, Brain, MessageSquare, PanelLeft, BookMarked, Bookmark, X } from "lucide-react";
import { mentorChat, getMentorConversation, renameMentorConversation, pinMentorConversation, deleteMentorConversation, addMentorMemory, updateMentorMemory, deleteMentorMemory, type MentorMemory } from "@/server/actions/mentor";
import type { ChatMessage } from "@/server/ai/client";

type Conv = { id: string; title: string; pinned: boolean; lastMessageAt: string | null };
const MEM_KINDS: Array<{ key: string; label: string }> = [
  { key: "inzicht", label: "Inzicht" },
  { key: "beslissing", label: "Beslissing" },
  { key: "actie", label: "Actie" },
  { key: "voorkeur", label: "Voorkeur" },
  { key: "feit", label: "Bedrijfsfeit" },
];
const memLabel = (k: string) => MEM_KINDS.find((m) => m.key === k)?.label ?? k;

const SUGGESTIONS = [
  "Wat moet deze week mijn hoogste prioriteit zijn?",
  "Welke werkzaamheden moet ik delegeren?",
  "Waar verliezen we momenteel het meeste rendement?",
];

/* ---------------- spraak ---------------- */
type SpeechResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechEventLike = { resultIndex: number; results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = { lang: string; continuous: boolean; interimResults: boolean; onresult: (e: SpeechEventLike) => void; onend: () => void; onerror: (e: { error?: string }) => void; start: () => void; stop: () => void };
type SRWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as SRWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function MicButton({ onText, onError }: { onText: (t: string) => void; onError?: (m: string) => void }) {
  const [listening, setListening] = useState(false);
  const [mounted, setMounted] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => setMounted(true), []);
  const Ctor = speechCtor();
  if (!mounted || !Ctor) return null;
  const stop = () => { try { recRef.current?.stop(); } catch { /* al gestopt */ } recRef.current = null; setListening(false); };
  const start = () => {
    try {
      const r = new Ctor();
      r.lang = "nl-NL"; r.continuous = true; r.interimResults = false;
      r.onresult = (e) => { let t = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (res?.isFinal) t += res[0].transcript; } if (t.trim()) onText(t.trim()); };
      r.onend = () => setListening(false);
      r.onerror = (ev) => { setListening(false); const c = ev?.error ?? ""; onError?.(c === "not-allowed" || c === "service-not-allowed" ? "Microfoon is geblokkeerd. Geef deze site toegang tot de microfoon." : "Inspreken lukt niet in deze browser. Gebruik Chrome, of typ het."); };
      recRef.current = r; r.start(); setListening(true);
    } catch { onError?.("Inspreken kon niet starten."); setListening(false); }
  };
  return (
    <button type="button" onClick={() => (listening ? stop() : start())} title={listening ? "Stop met inspreken" : "Inspreken (je controleert de tekst voor je verstuurt)"} className={`inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border transition ${listening ? "animate-pulse border-[var(--color-bad)] bg-[var(--color-bad)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
      {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
    </button>
  );
}

/* ---------------- opmaak ---------------- */
function renderText(t: string) {
  return t.split("\n").map((line, i) => {
    if (line.trim() === "") return <div key={i} className="h-2" />;
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) => (seg.startsWith("**") && seg.endsWith("**") ? <strong key={j}>{seg.slice(2, -2)}</strong> : <span key={j}>{seg}</span>));
    return <div key={i} className="leading-relaxed">{parts}</div>;
  });
}

function Bubble({ m, onRemember }: { m: ChatMessage; onRemember?: (content: string) => void }) {
  const [copied, setCopied] = useState(false);
  const mine = m.role === "user";
  const copy = async () => { try { await navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* geblokkeerd */ } };
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`group relative max-w-[88%] rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm ${mine ? "bg-[var(--color-brand-600)] text-white" : "border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)]"}`}>
        {mine ? <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div> : <div>{renderText(m.content)}</div>}
        {!mine ? (
          <span className="absolute -right-2 -top-2 hidden gap-1 group-hover:flex">
            {onRemember ? (
              <button type="button" onClick={() => onRemember(m.content)} title="Onthoud dit in je geheugen" className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1 text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] hover:text-[var(--color-brand-600)]">
                <Bookmark className="size-3.5" />
              </button>
            ) : null}
            <button type="button" onClick={copy} title="Kopieer" className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1 text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] hover:text-[var(--color-ink)]">
              {copied ? <Check className="size-3.5 text-[var(--color-good)]" /> : <Copy className="size-3.5" />}
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- hoofdcomponent ---------------- */
export function MentorChat({ conversations: initial, memories: initialMem, aiReady, firstName }: { conversations: Conv[]; memories: MentorMemory[]; aiReady: boolean; firstName: string }) {
  const [convs, setConvs] = useState<Conv[]>(initial);
  const [mem, setMem] = useState<MentorMemory[]>(initialMem);
  const [memOpen, setMemOpen] = useState(false);
  const [memKind, setMemKind] = useState("inzicht");
  const [memContent, setMemContent] = useState("");
  const [memBusy, setMemBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadingConv, setLoadingConv] = useState(false);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, pending]);

  const sorted = [...convs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
  const filtered = search.trim() ? sorted.filter((c) => c.title.toLowerCase().includes(search.toLowerCase())) : sorted;

  const openConversation = (id: string) => {
    setLoadingConv(true); setErr(null); setSidebarOpen(false);
    getMentorConversation(id).then((r) => { if (r.ok) { setActiveId(id); setMessages(r.messages); } else setErr(r.message); }).finally(() => setLoadingConv(false));
  };
  const newConversation = () => { setActiveId(null); setMessages([]); setErr(null); setInput(""); setSidebarOpen(false); };

  const send = (text: string) => {
    const content = text.trim();
    if (!content || pending) return;
    setErr(null);
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next); setInput("");
    start(async () => {
      const res = await mentorChat({ conversationId: activeId ?? undefined, messages: next });
      if (res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
        if (!activeId) { setActiveId(res.conversationId); setConvs((c) => [{ id: res.conversationId, title: res.title, pinned: false, lastMessageAt: new Date().toISOString() }, ...c]); }
        else setConvs((c) => c.map((x) => (x.id === res.conversationId ? { ...x, lastMessageAt: new Date().toISOString() } : x)));
      } else { setErr(res.message); setMessages((m) => m.slice(0, -1)); setInput(content); }
    });
  };

  // Geheugen
  const openRemember = (content: string) => { setMemContent(content.replace(/^#+\s*/gm, "").trim().slice(0, 2000)); setMemKind("inzicht"); setMemOpen(true); };
  const addMemory = () => {
    const content = memContent.trim();
    if (!content || memBusy) return;
    setMemBusy(true);
    addMentorMemory({ kind: memKind, content }).then((r) => { if (r.ok) { setMem((m) => [r.memory, ...m]); setMemContent(""); } }).finally(() => setMemBusy(false));
  };
  const toggleMemStatus = (m: MentorMemory) => { const next = m.status === "afgerond" ? "open" : "afgerond"; updateMentorMemory({ id: m.id, status: next }); setMem((xs) => xs.map((x) => (x.id === m.id ? { ...x, status: next } : x))); };
  const editMemory = (m: MentorMemory) => { const t = window.prompt("Herinnering aanpassen", m.content); if (t && t.trim()) { updateMentorMemory({ id: m.id, content: t.trim() }); setMem((xs) => xs.map((x) => (x.id === m.id ? { ...x, content: t.trim() } : x))); } };
  const delMemory = (m: MentorMemory) => { if (!window.confirm("Deze herinnering verwijderen?")) return; deleteMentorMemory(m.id); setMem((xs) => xs.filter((x) => x.id !== m.id)); };

  const rename = (c: Conv) => { const t = window.prompt("Nieuwe naam voor dit gesprek", c.title); if (t && t.trim()) { renameMentorConversation(c.id, t.trim()); setConvs((cs) => cs.map((x) => (x.id === c.id ? { ...x, title: t.trim() } : x))); } };
  const togglePin = (c: Conv) => { pinMentorConversation(c.id, !c.pinned); setConvs((cs) => cs.map((x) => (x.id === c.id ? { ...x, pinned: !x.pinned } : x))); };
  const remove = (c: Conv) => { if (!window.confirm("Dit gesprek verwijderen?")) return; deleteMentorConversation(c.id); setConvs((cs) => cs.filter((x) => x.id !== c.id)); if (activeId === c.id) newConversation(); };

  if (!aiReady) {
    return <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-ink-muted)]">De AI-mentor staat nog uit. Zodra de ANTHROPIC_API_KEY is ingesteld, kun je hier sparren.</div>;
  }

  return (
    <div className="flex gap-4">
      {/* Zijbalk met gesprekken */}
      <aside className={`${sidebarOpen ? "fixed inset-0 z-30 bg-black/30 sm:static sm:bg-transparent" : "hidden"} sm:block sm:w-64 sm:shrink-0`} onClick={(e) => { if (e.target === e.currentTarget) setSidebarOpen(false); }}>
        <div className="h-full w-64 max-w-[80vw] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 sm:w-auto">
          <button type="button" onClick={newConversation} className="mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-2 text-sm font-semibold text-white hover:brightness-110">
            <Plus className="size-4" /> Nieuw gesprek
          </button>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek gesprek…" className="sc-input h-8 w-full pl-7 text-xs" />
          </div>
          <ul className="space-y-0.5">
            {filtered.length === 0 ? <li className="px-2 py-3 text-2xs text-[var(--color-ink-faint)]">{search ? "Geen gesprek gevonden." : "Nog geen gesprekken."}</li> : null}
            {filtered.map((c) => (
              <li key={c.id} className={`group flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1.5 ${activeId === c.id ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--color-surface)]"}`}>
                <button type="button" onClick={() => openConversation(c.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  {c.pinned ? <Pin className="size-3 shrink-0 text-[var(--color-brand-600)]" /> : <MessageSquare className="size-3 shrink-0 text-[var(--color-ink-faint)]" />}
                  <span className={`truncate text-xs ${activeId === c.id ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}>{c.title}</span>
                </button>
                <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button type="button" onClick={() => togglePin(c)} title={c.pinned ? "Losmaken" : "Vastzetten"} className="rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-brand-600)]"><Pin className="size-3.5" /></button>
                  <button type="button" onClick={() => rename(c)} title="Hernoemen" className="rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><Pencil className="size-3.5" /></button>
                  <button type="button" onClick={() => remove(c)} title="Verwijderen" className="rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]"><Trash2 className="size-3.5" /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Chat */}
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-2">
          <button type="button" onClick={() => setSidebarOpen(true)} className="inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] sm:hidden"><PanelLeft className="size-4" /></button>
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-full bg-[var(--color-brand-600)] text-white"><Brain className="size-5" /></span>
            <div>
              <h1 className="text-base font-bold tracking-tight text-[var(--color-ink)]">AI Mentor</h1>
              <p className="text-2xs text-[var(--color-ink-faint)]">Privé · jouw persoonlijke CEO-sparringpartner met live Shortclips-data</p>
            </div>
          </div>
          <button type="button" onClick={() => setMemOpen(true)} className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-brand-500)]">
            <BookMarked className="size-4" /> Geheugen{mem.length > 0 ? ` (${mem.length})` : ""}
          </button>
        </div>

        {/* Geheugenpaneel */}
        {memOpen ? (
          <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-4 sm:p-8" onClick={(e) => { if (e.target === e.currentTarget) setMemOpen(false); }}>
            <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--color-ink)]"><BookMarked className="size-4 text-[var(--color-brand-600)]" /> Persoonlijk geheugen</h2>
                <button type="button" onClick={() => setMemOpen(false)} className="rounded p-1 text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"><X className="size-4" /></button>
              </div>
              <p className="mb-3 text-2xs text-[var(--color-ink-faint)]">Wat de mentor over jou en Shortclips onthoudt — en meeneemt in adviezen. Jij bepaalt wat hier staat; de mentor slaat nooit zelf iets op.</p>

              <div className="mb-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2.5">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {MEM_KINDS.map((k) => (
                    <button key={k.key} type="button" onClick={() => setMemKind(k.key)} className={`rounded-full border px-2 py-0.5 text-2xs font-medium transition ${memKind === k.key ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white" : "border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>{k.label}</button>
                  ))}
                </div>
                <textarea value={memContent} onChange={(e) => setMemContent(e.target.value)} rows={2} placeholder="Bijv. 'Delegeer scriptcontrole aan een vaste medewerker' of 'Voorkeur: korte, directe adviezen'" className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-ink)] focus:border-[var(--color-brand-500)] focus:outline-none" />
                <button type="button" onClick={addMemory} disabled={memBusy || !memContent.trim()} className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-40">{memBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Onthoud dit</button>
              </div>

              {mem.length === 0 ? (
                <p className="py-6 text-center text-xs text-[var(--color-ink-faint)]">Nog niets opgeslagen.</p>
              ) : (
                <div className="space-y-3">
                  {MEM_KINDS.filter((k) => mem.some((m) => m.kind === k.key)).map((k) => (
                    <div key={k.key}>
                      <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{k.label}</span>
                      <ul className="space-y-1">
                        {mem.filter((m) => m.kind === k.key).map((m) => (
                          <li key={m.id} className="group flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1.5">
                            {m.kind === "actie" || m.kind === "beslissing" ? (
                              <button type="button" onClick={() => toggleMemStatus(m)} title={m.status === "afgerond" ? "Afgerond" : "Markeer als afgerond"} className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border ${m.status === "afgerond" ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)]"}`}>{m.status === "afgerond" ? <Check className="size-3" /> : null}</button>
                            ) : null}
                            <span className={`min-w-0 flex-1 text-xs ${m.status === "afgerond" ? "text-[var(--color-ink-faint)] line-through" : "text-[var(--color-ink)]"}`}>{m.content}</span>
                            <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                              <button type="button" onClick={() => editMemory(m)} title="Aanpassen" className="rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"><Pencil className="size-3.5" /></button>
                              <button type="button" onClick={() => delMemory(m)} title="Verwijderen" className="rounded p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]"><Trash2 className="size-3.5" /></button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-[var(--shadow-card)]">
          <div className="flex max-h-[62vh] min-h-[360px] flex-col gap-3 overflow-y-auto p-4">
            {loadingConv ? (
              <div className="m-auto"><Loader2 className="size-5 animate-spin text-[var(--color-brand-600)]" /></div>
            ) : messages.length === 0 ? (
              <div className="m-auto max-w-lg text-center">
                <Brain className="mx-auto mb-2 size-7 text-[var(--color-brand-600)]" />
                <p className="text-lg font-bold text-[var(--color-ink)]">Goedemorgen, {firstName}</p>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Waar wil je vandaag strategisch naar kijken?</p>
                <div className="mt-4 grid gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-left text-sm text-[var(--color-ink)] hover:border-[var(--color-brand-500)]">{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => <Bubble key={i} m={m} onRemember={m.role === "assistant" ? openRemember : undefined} />)
            )}
            {pending ? (
              <div className="flex justify-start"><div className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 text-sm text-[var(--color-ink-muted)]"><Loader2 className="size-4 animate-spin text-[var(--color-brand-600)]" /> De mentor denkt na…</div></div>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="border-t border-[var(--color-line)] p-3">
            {err ? <p className="mb-2 text-2xs text-[var(--color-bad)]">{err}</p> : null}
            <div className="flex items-end gap-2">
              <MicButton onText={(t) => setInput((p) => (p ? p + (p.endsWith(" ") ? "" : " ") + t : t))} onError={setErr} />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                rows={2}
                placeholder="Stel je vraag of spreek het in… (Enter verstuurt, Shift+Enter nieuwe regel)"
                disabled={pending}
                className="min-h-0 flex-1 resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-brand-500)] focus:outline-none"
              />
              <button type="button" onClick={() => send(input)} disabled={pending || !input.trim()} className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3.5 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
