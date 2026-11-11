"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, FileText, LayoutDashboard, Link2, Loader2, MessageCircle, RotateCcw, Settings2, X } from "lucide-react";
import { Button, ClientLogo } from "@/components/ui";
import {
  DEFAULT_TEMPLATES,
  LINK_LABEL,
  LINK_TOKEN,
  METHODE_LABEL,
  PLACEHOLDER,
  checkMessage,
  insertedValue,
  renderTemplate,
  statusNaKopieren,
  swapLink,
  type ForeignLink,
  type SavedScriptbericht,
  type ScriptberichtMethode,
  type Templates,
} from "@/lib/scriptbericht";
import { resetScriptberichtTemplates, resetScriptberichtText, saveScriptbericht, saveScriptberichtTemplates } from "@/server/actions/scriptbericht";

/** Eén opname zoals het scriptbericht die nodig heeft. */
export type ScriptberichtRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientLogo: string | null;
  clientColor: string | null;
  scheduledOn: string;
  done: boolean;
  /** Huidige scriptingstatus van de opname. */
  status: string;
  reviewId: string | null;
  /** Automatisch opgehaalde link naar de scripts in het klantportaal. */
  portalLink: string | null;
  saved: SavedScriptbericht;
};

const OPEN_EVENT = "scriptbericht:open";

/** Opent het scriptbericht vanaf een regel in de tabel, met die opname al gekozen. */
export function openScriptbericht(productionDayId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { productionDayId } }));
}

/** Klein icoon per regel in de scriptingtabel. */
export function ScriptberichtRowButton({ productionDayId, clientName }: { productionDayId: string; clientName: string }) {
  return (
    <button
      type="button"
      onClick={() => openScriptbericht(productionDayId)}
      className="grid size-6 shrink-0 place-items-center rounded-full text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"
      title={`Scriptbericht kopiëren voor ${clientName}`}
      aria-label={`Scriptbericht kopiëren voor ${clientName}`}
    >
      <MessageCircle className="size-3.5" />
    </button>
  );
}

function fmtDay(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // val terug op de oude manier
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Hoofdknop bovenaan de Scriptingpagina plus het venster. */
export function ScriptberichtButton({
  rows,
  templates: initialTemplates,
  templatesCustom,
  canWrite,
  canEditTemplates,
  defaultDayId,
}: {
  rows: ScriptberichtRow[];
  templates: Templates;
  templatesCustom: boolean;
  canWrite: boolean;
  canEditTemplates: boolean;
  defaultDayId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dayId, setDayId] = useState<string>("");
  const [templates, setTemplates] = useState<Templates>(initialTemplates);
  const [custom, setCustom] = useState(templatesCustom);
  // Opgeslagen stand per opname, bewaard zolang de pagina openstaat, zodat een
  // net ingevulde link er bij opnieuw openen direct weer staat.
  const [savedById, setSavedById] = useState<Record<string, SavedScriptbericht>>(() => Object.fromEntries(rows.map((r) => [r.id, r.saved])));

  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<{ productionDayId?: string }>).detail?.productionDayId ?? "";
      setDayId(id);
      setOpen(true);
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setDayId(defaultDayId && rows.some((r) => r.id === defaultDayId) ? defaultDayId : "");
          setOpen(true);
        }}
        title="Kopieer het vaste WhatsAppbericht voor de klant zodra de scripts klaarstaan"
      >
        <MessageCircle className="size-4" /> Scriptbericht kopiëren
      </Button>
      {open ? (
        <ScriptberichtDialog
          rows={rows}
          savedById={savedById}
          setSavedById={setSavedById}
          initialDayId={dayId}
          templates={templates}
          templatesCustom={custom}
          canWrite={canWrite}
          canEditTemplates={canEditTemplates}
          onTemplatesSaved={(t, isCustom) => { setTemplates(t); setCustom(isCustom); }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

type EditorState = {
  methode: ScriptberichtMethode;
  link: string;
  linkDraft: string;
  linkSource: "portaal" | "opgeslagen" | null;
  text: string;
  /** Wat er nu op de plek van de link in de tekst staat. */
  inserted: string;
  /** Kwam de tekst uit een opgeslagen persoonlijke versie? */
  fromSaved: boolean;
};

function initEditor(row: ScriptberichtRow, methode: ScriptberichtMethode, templates: Templates, saved: SavedScriptbericht): EditorState {
  const auto = methode === "portal" ? row.portalLink : null;
  const savedLink = saved.links[methode] ?? null;
  const link = auto ?? savedLink ?? "";
  const savedText = saved.texts[methode];
  // Een opgeslagen persoonlijke tekst alleen gebruiken als die de huidige link bevat.
  const useSaved = !!savedText && (!link || savedText.includes(link));
  return {
    methode,
    link,
    linkDraft: link,
    linkSource: auto ? "portaal" : savedLink ? "opgeslagen" : null,
    text: useSaved ? savedText! : renderTemplate(templates[methode], methode, link),
    inserted: insertedValue(methode, link),
    fromSaved: useSaved,
  };
}

function ScriptberichtDialog({
  rows,
  savedById,
  setSavedById,
  initialDayId,
  templates,
  templatesCustom,
  canWrite,
  canEditTemplates,
  onTemplatesSaved,
  onClose,
}: {
  rows: ScriptberichtRow[];
  savedById: Record<string, SavedScriptbericht>;
  setSavedById: Dispatch<SetStateAction<Record<string, SavedScriptbericht>>>;
  initialDayId: string;
  templates: Templates;
  templatesCustom: boolean;
  canWrite: boolean;
  canEditTemplates: boolean;
  onTemplatesSaved: (t: Templates, custom: boolean) => void;
  onClose: () => void;
}) {
  const [dayId, setDayId] = useState(initialDayId);
  // Bij openen met een opname: laatst gebruikte vorm direct klaarzetten.
  const [editor, setEditor] = useState<EditorState | null>(() => {
    const r = rows.find((x) => x.id === initialDayId);
    const s = r ? savedById[r.id] ?? r.saved : null;
    return r && s?.methode ? initEditor(r, s.methode, templates, s) : null;
  });
  const [copied, setCopied] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const router = useRouter();
  const [view, setView] = useState<"bericht" | "beheer">("bericht");
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const row = rows.find((r) => r.id === dayId) ?? null;

  // Sorteren: aankomende opnames eerst (op datum), afgeronde onderaan.
  const options = useMemo(() => [...rows].sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn)), [rows]);

  // Links die bij opnames van andere klanten horen: daarmee voorkom je dat een
  // link van de verkeerde klant in het bericht belandt.
  const foreign: ForeignLink[] = useMemo(() => {
    if (!row) return [];
    const out: ForeignLink[] = [];
    for (const r of rows) {
      if (r.clientId === row.clientId) continue;
      const s = savedById[r.id];
      for (const l of [r.portalLink, s?.links.adobe, s?.links.portal]) {
        if (l) out.push({ link: l, reviewId: r.reviewId, clientId: r.clientId, clientName: r.clientName });
      }
      if (r.reviewId) out.push({ link: `/portal/scripts/${r.reviewId}`, reviewId: r.reviewId, clientId: r.clientId, clientName: r.clientName });
    }
    return out;
  }, [rows, row, savedById]);

  // Andere opname gekozen: editor leeg, zodat er nooit een bericht van de vorige klant blijft staan.
  function selectDay(id: string) {
    setDayId(id);
    setCopied(false);
    setStatusNote(null);
    setSaveErr(null);
    const r = rows.find((x) => x.id === id);
    const last = r ? savedById[r.id]?.methode : null;
    setEditor(r && last ? initEditor(r, last, templates, savedById[r.id]!) : null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, [onClose]);

  function chooseMethode(m: ScriptberichtMethode) {
    if (!row) return;
    setCopied(false);
    setSaveErr(null);
    setEditor(initEditor(row, m, templates, savedById[row.id] ?? row.saved));
  }

  const persist = useCallback(
    async (patch: { link: string; text?: string; copied?: boolean }, methode: ScriptberichtMethode, forRow: ScriptberichtRow) => {
      if (!canWrite) return;
      const res = await saveScriptbericht({ productionDayId: forRow.id, methode, ...patch });
      if (!res.ok) {
        setSaveErr(res.message ?? "Opslaan mislukt.");
        return;
      }
      if (res.statusChangedTo) {
        setStatusNote(`Status van ${forRow.clientName} staat nu op Controle bij klant.`);
        router.refresh();
      } else if (res.statusMessage) {
        setSaveErr(res.statusMessage);
      }
      setSavedById((prev) => {
        const cur = prev[forRow.id] ?? forRow.saved;
        const links = { ...cur.links };
        if (patch.link) links[methode] = patch.link;
        else delete links[methode];
        const texts = { ...cur.texts };
        if (typeof patch.text === "string") {
          const standaard = renderTemplate(templates[methode], methode, patch.link);
          if (patch.text.trim() && patch.text !== standaard) texts[methode] = patch.text;
          else delete texts[methode];
        }
        return { ...prev, [forRow.id]: { ...cur, methode, links, texts } };
      });
    },
    [canWrite, templates, setSavedById, router],
  );

  function applyLink(raw: string) {
    if (!editor || !row) return;
    const link = raw.trim();
    if (link === editor.link) return;
    const nextInserted = insertedValue(editor.methode, link);
    const swapped = swapLink(editor.text, editor.inserted, nextInserted);
    const next: EditorState = {
      ...editor,
      link,
      linkDraft: link,
      linkSource: null,
      text: swapped.replaced ? swapped.text : editor.text,
      inserted: swapped.replaced ? nextInserted : editor.inserted,
    };
    setEditor(next);
    setCopied(false);
    setSaveErr(null);
    // Link direct bewaren bij deze opname (zodat een collega hem ook ziet),
    // maar alleen als hij geldig is en niet bij een andere klant hoort.
    const check = checkMessage({ methode: next.methode, link, text: link, clientId: row.clientId, ownReviewId: row.reviewId, foreign });
    if (link && check.ok) void persist({ link }, next.methode, row);
  }

  function restoreStandard() {
    if (!editor || !row) return;
    const text = renderTemplate(templates[editor.methode], editor.methode, editor.link);
    setEditor({ ...editor, text, inserted: insertedValue(editor.methode, editor.link), fromSaved: false });
    setCopied(false);
    if (canWrite && savedById[row.id]?.texts[editor.methode]) {
      void resetScriptberichtText(row.id, editor.methode);
      setSavedById((prev) => {
        const cur = prev[row.id] ?? row.saved;
        const texts = { ...cur.texts };
        delete texts[editor.methode];
        return { ...prev, [row.id]: { ...cur, texts } };
      });
    }
  }

  const check = editor && row
    ? checkMessage({ methode: editor.methode, link: editor.link, text: editor.text, clientId: row.clientId, ownReviewId: row.reviewId, foreign })
    : null;
  const linkPending = !!editor && editor.linkDraft.trim() !== editor.link;
  const isPersonal = !!editor && editor.text !== renderTemplate(templates[editor.methode], editor.methode, editor.link);

  async function onCopy() {
    if (!editor || !row || !check?.ok || linkPending) return;
    const ok = await copyText(editor.text);
    if (!ok) {
      setSaveErr("Kopiëren lukte niet. Selecteer de tekst en kopieer handmatig.");
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2500);
    void persist({ link: editor.link, text: editor.text, copied: true }, editor.methode, row);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 text-left text-[var(--color-ink)] sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Scriptbericht kopiëren"
        className="flex max-h-[100dvh] w-full flex-col rounded-t-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)] sm:max-h-[92vh] sm:max-w-2xl sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold">{view === "beheer" ? "Standaardteksten beheren" : "Scriptbericht kopiëren"}</h3>
            <p className="text-xs text-[var(--color-ink-muted)]">
              {view === "beheer"
                ? "Deze teksten gelden voor het hele team. Persoonlijke aanpassingen per klant veranderen deze niet."
                : "Vast WhatsAppbericht voor de klant zodra de scripts klaarstaan."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]" aria-label="Sluiten">
            <X className="size-4" />
          </button>
        </div>

        {view === "beheer" ? (
          <TemplateBeheer
            templates={templates}
            custom={templatesCustom}
            onBack={() => setView("bericht")}
            onSaved={(t, isCustom) => {
              onTemplatesSaved(t, isCustom);
              // Open bericht zonder persoonlijke aanpassing meteen bijwerken.
              if (editor && row && !isPersonal) {
                setEditor({ ...editor, text: renderTemplate(t[editor.methode], editor.methode, editor.link), inserted: insertedValue(editor.methode, editor.link) });
              }
            }}
          />
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
              {/* 1. Opname / klant */}
              <div>
                <label htmlFor="sb-opname" className="mb-1 block text-xs font-semibold text-[var(--color-ink-muted)]">Voor welke klant en opname?</label>
                <div className="flex items-center gap-2">
                  {row ? <ClientLogo name={row.clientName} logoUrl={row.clientLogo} color={row.clientColor} size={28} /> : null}
                  <select
                    id="sb-opname"
                    value={dayId}
                    onChange={(e) => selectDay(e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
                  >
                    <option value="">Kies een opname…</option>
                    {options.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.clientName} · opname {fmtDay(r.scheduledOn)}{r.done ? " · scripts afgerond" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 2. Keuze Adobe / Portaal */}
              {row ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["adobe", "portal"] as const).map((m) => {
                    const active = editor?.methode === m;
                    const last = (savedById[row.id] ?? row.saved).methode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => chooseMethode(m)}
                        aria-pressed={active}
                        className={`flex items-start gap-2.5 rounded-[var(--radius-md)] border p-3 text-left transition ${active ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] ring-1 ring-[var(--color-brand-500)]" : "border-[var(--color-line)] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"}`}
                      >
                        <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${active ? "bg-[var(--color-brand-500)] text-white" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]"}`}>
                          {m === "adobe" ? <FileText className="size-3.5" /> : <LayoutDashboard className="size-3.5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{METHODE_LABEL[m]}</span>
                          <span className="block text-2xs text-[var(--color-ink-muted)]">
                            {m === "adobe"
                              ? "Scripts als PDF met opmerkingen in Adobe Acrobat."
                              : row.reviewId ? "Scripts staan al in het klantportaal, link wordt automatisch ingevuld." : "Scripts staan nog niet in het klantportaal."}
                          </span>
                          {last ? <span className="mt-1 inline-block rounded-full bg-[var(--color-surface-sunken)] px-1.5 py-0.5 text-2xs font-medium text-[var(--color-ink-muted)]">Laatst gebruikt</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-3 py-4 text-center text-xs text-[var(--color-ink-muted)]">
                  Kies eerst de klant en opname, dan verschijnt hier het bericht.
                </p>
              )}

              {/* 3. Link + bericht */}
              {row && editor ? (
                <>
                  <div>
                    <label htmlFor="sb-link" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink-muted)]">
                      <Link2 className="size-3.5" /> {LINK_LABEL[editor.methode]}
                    </label>
                    <input
                      id="sb-link"
                      type="url"
                      inputMode="url"
                      value={editor.linkDraft}
                      placeholder={editor.methode === "adobe" ? "https://acrobat.adobe.com/id/…" : "https://…/portal/scripts/…"}
                      onChange={(e) => setEditor({ ...editor, linkDraft: e.target.value })}
                      onBlur={(e) => applyLink(e.target.value)}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData("text").trim();
                        if (pasted) {
                          e.preventDefault();
                          applyLink(pasted);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyLink((e.target as HTMLInputElement).value);
                        }
                      }}
                      className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
                    />
                    <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">
                      {editor.linkSource === "portaal"
                        ? "Automatisch ingevuld: de scripts van deze opname in het klantportaal."
                        : editor.linkSource === "opgeslagen"
                          ? "Eerder bij deze opname opgeslagen."
                          : editor.methode === "portal" && !row.reviewId
                            ? "Deze scripts staan nog niet in het klantportaal. Stuur ze eerst via 'Genereer & stuur ter controle' of plak de link."
                            : "Plak de link; die komt automatisch op de juiste plek in het bericht."}
                    </p>
                  </div>

                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="sb-tekst" className="text-xs font-semibold text-[var(--color-ink-muted)]">WhatsAppbericht</label>
                      <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${isPersonal ? "bg-[var(--color-warn-soft)] text-[#8a5300]" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]"}`}>
                        {isPersonal ? `Persoonlijke versie voor ${row.clientName}` : "Standaardtekst"}
                      </span>
                    </div>
                    <textarea
                      id="sb-tekst"
                      value={editor.text}
                      onChange={(e) => { setEditor({ ...editor, text: e.target.value }); setCopied(false); }}
                      rows={14}
                      className="block w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-relaxed"
                    />
                    <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">*tekst* tussen sterretjes wordt vet in WhatsApp. Aanpassen geldt alleen voor deze opname.</p>
                  </div>
                </>
              ) : null}
            </div>

            {/* Footer */}
            <div className="space-y-2 border-t border-[var(--color-line)] px-4 py-3 sm:px-5">
              {row && editor && check ? (
                linkPending ? (
                  <p className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]"><Link2 className="size-3.5" /> Klik buiten het linkveld of druk op Enter om de link in het bericht te zetten.</p>
                ) : !check.ok ? (
                  <p className="flex items-start gap-1.5 text-xs font-medium text-[var(--color-bad)]"><AlertTriangle className="mt-px size-3.5 shrink-0" /> {check.reason}</p>
                ) : copied ? (
                  <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-good)]"><Check className="size-3.5" /> Bericht gekopieerd!</p>
                ) : check.hint ? (
                  <p className="flex items-start gap-1.5 text-xs text-[#8a5300]"><AlertTriangle className="mt-px size-3.5 shrink-0" /> {check.hint}</p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-[var(--color-good)]"><CheckCircle2 className="size-3.5" /> Klaar om te kopiëren voor {row.clientName}.</p>
                )
              ) : null}
              {saveErr ? <p className="text-xs text-[var(--color-bad)]">{saveErr}</p> : null}
              {statusNote ? <p className="flex items-center gap-1.5 text-xs text-[var(--color-good)]"><CheckCircle2 className="size-3.5" /> {statusNote}</p> : null}
              {row && editor && !statusNote && (row.status === "controle_jarno" || row.status === "feedback_jarno") ? (
                <p className="flex items-start gap-1.5 text-xs text-[#8a5300]"><AlertTriangle className="mt-px size-3.5 shrink-0" /> Deze scripts staan nog op {row.status === "controle_jarno" ? "Controle Jarno" : "Feedback verwerken"}. Weet je zeker dat ze naar de klant kunnen?</p>
              ) : null}
              {row && editor && canWrite && !statusNote && statusNaKopieren(row.status) ? (
                <p className="text-2xs text-[var(--color-ink-faint)]">Na het kopiëren gaat de status van deze opname automatisch naar Controle bij klant.</p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  {row && editor ? (
                    <Button type="button" variant="ghost" size="sm" onClick={restoreStandard} disabled={!isPersonal}>
                      <RotateCcw className="size-3.5" /> Herstel standaardtekst
                    </Button>
                  ) : null}
                  {canEditTemplates ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setView("beheer")}>
                      <Settings2 className="size-3.5" /> Standaardteksten beheren
                    </Button>
                  ) : null}
                </div>
                <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                  <Button type="button" variant="primary" className="flex-1 sm:flex-none" onClick={onCopy} disabled={!row || !editor || !check?.ok || linkPending}>
                    <Copy className="size-4" /> Kopieer WhatsAppbericht
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TemplateBeheer({ templates, custom, onBack, onSaved }: { templates: Templates; custom: boolean; onBack: () => void; onSaved: (t: Templates, custom: boolean) => void }) {
  const [draft, setDraft] = useState<Templates>(templates);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveScriptberichtTemplates(draft);
      if (res.ok && res.templates) {
        onSaved(res.templates, true);
        setMsg({ ok: true, text: "Standaardteksten opgeslagen voor het hele team." });
      } else setMsg({ ok: false, text: res.message ?? "Opslaan mislukt." });
    });
  }
  function reset() {
    setMsg(null);
    start(async () => {
      const res = await resetScriptberichtTemplates();
      if (res.ok) {
        setDraft(DEFAULT_TEMPLATES);
        onSaved(DEFAULT_TEMPLATES, false);
        setMsg({ ok: true, text: "Teruggezet naar de Shortclips-standaard." });
      } else setMsg({ ok: false, text: res.message ?? "Herstellen mislukt." });
    });
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        <p className="rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
          Zet <code className="font-semibold text-[var(--color-ink)]">{LINK_TOKEN}</code> op de plek waar de link moet komen. Zolang er geen link is, ziet de medewerker daar {PLACEHOLDER.adobe} of {PLACEHOLDER.portal}. *Tekst* tussen sterretjes wordt vet in WhatsApp.
          {custom ? null : " Nu actief: de Shortclips-standaard."}
        </p>
        {(["adobe", "portal"] as const).map((m) => (
          <div key={m}>
            <label htmlFor={`sb-tpl-${m}`} className="mb-1 block text-xs font-semibold text-[var(--color-ink-muted)]">{METHODE_LABEL[m]}</label>
            <textarea
              id={`sb-tpl-${m}`}
              value={draft[m]}
              onChange={(e) => setDraft({ ...draft, [m]: e.target.value })}
              rows={10}
              className="block w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-relaxed"
            />
          </div>
        ))}
      </div>
      <div className="space-y-2 border-t border-[var(--color-line)] px-4 py-3 sm:px-5">
        {msg ? <p className={`text-xs ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>Terug naar bericht</Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending || !custom}>
              <RotateCcw className="size-3.5" /> Shortclips-standaard
            </Button>
          </div>
          <Button type="button" variant="primary" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Opslaan voor het team
          </Button>
        </div>
      </div>
    </>
  );
}
