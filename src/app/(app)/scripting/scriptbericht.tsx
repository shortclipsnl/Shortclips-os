"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, FileText, LayoutDashboard, Link2, Loader2, MessageCircle, Pencil, RotateCcw, Settings2, X } from "lucide-react";
import { Button, ClientLogo } from "@/components/ui";
import {
  DEFAULT_TEMPLATES,
  LINK_LABEL,
  LINK_TOKEN,
  METHODE_LABEL,
  PLACEHOLDER,
  checkMessage,
  insertedValue,
  kiesSessie,
  renderTemplate,
  standaardMethode,
  statusNaKopieren,
  swapLink,
  type ForeignLink,
  type SavedScriptbericht,
  type ScriptberichtMethode,
  type Templates,
  zonderOpmaak,
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

/** Groene hoofdknop (zelfde vorm als de andere portaalknoppen). */
const GREEN_BTN =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-good)] font-semibold text-white shadow-[var(--shadow-card)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100";

/**
 * Welke scriptsessie staat nu open op de pagina? Het scriptingoverzicht meldt
 * hier de laatst aangeklikte opname en de opnames die met de huidige klant- en
 * scriptschrijverfilter zichtbaar zijn. De knop bovenaan kiest daarmee zelf de
 * juiste klant, zodat de medewerker niets hoeft te selecteren.
 */
type SessieContext = { activeId: string | null; candidateIds: string[] };
let sessieContext: SessieContext = { activeId: null, candidateIds: [] };

export function publishScriptberichtContext(ctx: Partial<SessieContext>) {
  sessieContext = { ...sessieContext, ...ctx };
}

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
      <button
        type="button"
        className={`${GREEN_BTN} h-9 px-4 text-sm`}
        onClick={() => {
          const id = kiesSessie(rows, {
            activeId: sessieContext.activeId ?? defaultDayId ?? null,
            candidateIds: sessieContext.candidateIds,
          });
          setDayId(id ?? "");
          setOpen(true);
        }}
        title="Opent direct het WhatsAppbericht voor de klant en scriptsessie die nu open staan"
      >
        <MessageCircle className="size-4" /> Scriptbericht kopiëren
      </button>
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
    text: useSaved ? zonderOpmaak(savedText!) : renderTemplate(templates[methode], methode, link),
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
  // Bij openen staat het bericht direct klaar: laatst gebruikte vorm, of het
  // portaalbericht als de scripts al in het klantportaal staan, anders Adobe.
  const [editor, setEditor] = useState<EditorState | null>(() => {
    const r = rows.find((x) => x.id === initialDayId);
    if (!r) return null;
    const s = savedById[r.id] ?? r.saved;
    return initEditor(r, standaardMethode({ saved: s.methode, reviewId: r.reviewId }), templates, s);
  });
  const [kiesAndere, setKiesAndere] = useState(!rows.some((x) => x.id === initialDayId));
  const [linkBewerken, setLinkBewerken] = useState(false);
  const copyRef = useRef<HTMLButtonElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const router = useRouter();
  const [view, setView] = useState<"bericht" | "beheer">("bericht");
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const row = rows.find((r) => r.id === dayId) ?? null;

  // Focus bij openen direct op de kopieerknop: Enter kopieert meteen.
  useEffect(() => {
    copyRef.current?.focus();
  }, []);

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
    setLinkBewerken(false);
    const r = rows.find((x) => x.id === id);
    if (!r) { setEditor(null); return; }
    const s = savedById[r.id] ?? r.saved;
    setEditor(initEditor(r, standaardMethode({ saved: s.methode, reviewId: r.reviewId }), templates, s));
    setKiesAndere(false);
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
    setLinkBewerken(false);
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
    const ok = await copyText(zonderOpmaak(editor.text));
    if (!ok) {
      setSaveErr("Kopiëren lukte niet. Selecteer de tekst en kopieer handmatig.");
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 3000);
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
                : "Controleer het bericht, pas het eventueel aan en kopieer het voor WhatsApp."}
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
              {/* 1. Klant en opname: automatisch bepaald, alleen wijzigen als het nodig is */}
              {row && !kiesAndere ? (
                <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5">
                  <ClientLogo name={row.clientName} logoUrl={row.clientLogo} color={row.clientColor} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{row.clientName}</span>
                    <span className="block text-2xs text-[var(--color-ink-muted)]">Opname {fmtDay(row.scheduledOn)}{row.done ? " · scripts afgerond" : ""}</span>
                  </span>
                  {/* Berichttype: automatisch gekozen, met één klik te wisselen */}
                  <span className="inline-flex rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5" role="group" aria-label="Soort bericht">
                    {(["adobe", "portal"] as const).map((m) => {
                      const active = editor?.methode === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => chooseMethode(m)}
                          aria-pressed={active}
                          title={m === "adobe" ? "Scripts als PDF in Adobe Acrobat" : row.reviewId ? "Scripts staan in het klantportaal" : "Scripts staan nog niet in het klantportaal"}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-semibold transition ${active ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
                        >
                          {m === "adobe" ? <FileText className="size-3" /> : <LayoutDashboard className="size-3" />}
                          {m === "adobe" ? "Adobe Acrobat" : "Shortclips Portaal"}
                        </button>
                      );
                    })}
                  </span>
                  <button type="button" onClick={() => setKiesAndere(true)} className="text-2xs font-medium text-[var(--color-ink-muted)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline">
                    Andere opname
                  </button>
                </div>
              ) : (
                <div>
                  <label htmlFor="sb-opname" className="mb-1 block text-xs font-semibold text-[var(--color-ink-muted)]">Voor welke klant en opname?</label>
                  <select
                    id="sb-opname"
                    value={dayId}
                    onChange={(e) => selectDay(e.target.value)}
                    className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
                  >
                    <option value="">Kies een opname…</option>
                    {options.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.clientName} · opname {fmtDay(r.scheduledOn)}{r.done ? " · scripts afgerond" : ""}
                      </option>
                    ))}
                  </select>
                  {row ? (
                    <button type="button" onClick={() => setKiesAndere(false)} className="mt-1 text-2xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:underline">
                      Terug naar {row.clientName}
                    </button>
                  ) : null}
                </div>
              )}

              {/* 2. Link: alleen een invulveld als die er nog niet automatisch staat */}
              {row && editor ? (
                <>
                  {editor.link && !linkBewerken && !linkPending ? (
                    <p className="flex min-w-0 items-center gap-1.5 text-2xs text-[var(--color-ink-muted)]">
                      <Link2 className="size-3.5 shrink-0" />
                      <span className="shrink-0">{editor.linkSource === "portaal" ? "Portaallink automatisch ingevuld:" : "Link:"}</span>
                      <span className="min-w-0 truncate font-medium text-[var(--color-ink)]">{editor.link}</span>
                      <button type="button" onClick={() => setLinkBewerken(true)} className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]">
                        <Pencil className="size-3" /> Wijzigen
                      </button>
                    </p>
                  ) : (
                    <div>
                      <label htmlFor="sb-link" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink-muted)]">
                        <Link2 className="size-3.5" /> {LINK_LABEL[editor.methode]}
                      </label>
                      <input
                        id="sb-link"
                        type="url"
                        inputMode="url"
                        autoFocus={linkBewerken}
                        value={editor.linkDraft}
                        placeholder={editor.methode === "adobe" ? "Plak hier de Adobe Acrobat link (https://acrobat.adobe.com/id/…)" : "https://…/portal/scripts/…"}
                        onChange={(e) => setEditor({ ...editor, linkDraft: e.target.value })}
                        onBlur={(e) => { applyLink(e.target.value); if (e.target.value.trim()) setLinkBewerken(false); }}
                        onPaste={(e) => {
                          const pasted = e.clipboardData.getData("text").trim();
                          if (pasted) {
                            e.preventDefault();
                            applyLink(pasted);
                            setLinkBewerken(false);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            applyLink((e.target as HTMLInputElement).value);
                            setLinkBewerken(false);
                          }
                        }}
                        className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
                      />
                      <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">
                        {editor.methode === "portal" && !row.reviewId
                          ? "Deze scripts staan nog niet in het klantportaal. Stuur ze eerst via 'Genereer & stuur ter controle', plak de link of kies Adobe Acrobat."
                          : "Plak de link; die komt automatisch op de juiste plek in het bericht."}
                      </p>
                    </div>
                  )}

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
                      rows={15}
                      className="block w-full resize-y rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm leading-relaxed focus:border-[var(--color-good)] focus:outline-none focus:ring-2 focus:ring-[var(--color-good)]/25"
                    />
                    <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">Je kunt de tekst hier direct aanpassen. Dat geldt alleen voor deze opname.</p>
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
                  <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-good)]"><Check className="size-3.5" /> Bericht gekopieerd. Plak het nu in WhatsApp.</p>
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
                  <button ref={copyRef} type="button" className={`${GREEN_BTN} h-11 flex-1 px-6 text-sm sm:flex-none`} onClick={onCopy} disabled={!row || !editor || !check?.ok || linkPending}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Bericht gekopieerd" : "Kopiëren voor WhatsApp"}
                  </button>
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
          Zet <code className="font-semibold text-[var(--color-ink)]">{LINK_TOKEN}</code> op de plek waar de link moet komen. Zolang er geen link is, ziet de medewerker daar {PLACEHOLDER.adobe} of {PLACEHOLDER.portal}. Sterretjes en andere opmaaktekens worden automatisch weggehaald, zodat het bericht als gewone tekst in WhatsApp komt.
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
