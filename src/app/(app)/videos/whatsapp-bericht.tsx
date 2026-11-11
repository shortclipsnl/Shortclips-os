"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, Copy, Eye, LayoutDashboard, Link2, Loader2, Paperclip, Pencil, RotateCcw, Save, X } from "lucide-react";
import { markWhatsappGekopieerd, saveWhatsappConcept, updateWhatsappStandaard } from "@/server/actions/whatsapp-bericht";
import {
  WHATSAPP_CHECKLIST,
  WHATSAPP_OPTIE_META,
  WHATSAPP_OPTIES,
  applyVideoLink,
  isValidVideoLink,
  kanKopieren,
  normalizeVideoLink,
  standaardMetLink,
  whatsappOpmaak,
  type WhatsappBerichtConcept,
  type WhatsappOptie,
} from "@/lib/whatsapp-bericht";

export type WhatsappStandaarden = Record<WhatsappOptie, string>;

/** Tekst naar het klembord, met terugval voor oudere browsers en niet-beveiligde context. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // val terug op de oude methode hieronder
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
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function fmtMoment(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const OPTIE_ICON: Record<WhatsappOptie, typeof Link2> = { videolink: Link2, portaal: LayoutDashboard };

/**
 * Twee knoppen per opname (fase Interne review en Feedback klant): kies hoe de
 * klant de eerste versies ontvangt. Een vinkje toont dat het bericht al eens
 * gekopieerd is; een stip dat er een opgeslagen concept is.
 */
export function WhatsappBerichtKnoppen({
  videoId,
  clientName,
  concept,
  standaarden,
  canManage,
}: {
  videoId: string;
  clientName: string;
  concept: WhatsappBerichtConcept;
  standaarden: WhatsappStandaarden;
  canManage: boolean;
}) {
  const [open, setOpen] = useState<WhatsappOptie | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="WhatsApp-bericht eerste versies">
      {WHATSAPP_OPTIES.map((o) => {
        const Icon = OPTIE_ICON[o];
        const gekopieerd = concept.gekopieerd[o];
        const heeftConcept = !gekopieerd && concept.optie === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => {
              setOpen(o);
              // Gekozen optie direct vastleggen, zodat het team ziet dat er een concept is.
              if (concept.optie !== o) void saveWhatsappConcept(videoId, { ...concept, optie: o }).catch(() => undefined);
            }}
            title={
              gekopieerd
                ? `${WHATSAPP_OPTIE_META[o].label} · gekopieerd op ${fmtMoment(gekopieerd)}`
                : `WhatsApp-bericht voorbereiden: ${WHATSAPP_OPTIE_META[o].label}`
            }
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-2xs font-semibold ring-1 transition hover:brightness-95 ${
              gekopieerd
                ? "bg-[var(--color-good-soft)] text-[var(--color-good)] ring-[var(--color-good)]/40"
                : "bg-[var(--color-surface-2)] text-[var(--color-ink)] ring-[var(--color-line-strong)]"
            }`}
          >
            {gekopieerd ? <Check className="size-3" strokeWidth={2.5} /> : <Icon className="size-3" />}
            {WHATSAPP_OPTIE_META[o].knop}
            {heeftConcept ? <span className="size-1.5 rounded-full bg-[var(--color-warn)]" aria-label="Concept opgeslagen" /> : null}
          </button>
        );
      })}
      {open ? (
        <WhatsappBerichtDialog
          videoId={videoId}
          clientName={clientName}
          startOptie={open}
          initial={concept}
          standaarden={standaarden}
          canManage={canManage}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function WhatsappBerichtDialog({
  videoId,
  clientName,
  startOptie,
  initial,
  standaarden: initialStandaarden,
  canManage,
  onClose,
}: {
  videoId: string;
  clientName: string;
  startOptie: WhatsappOptie;
  initial: WhatsappBerichtConcept;
  standaarden: WhatsappStandaarden;
  canManage: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [concept, setConcept] = useState<WhatsappBerichtConcept>(() => ({ ...initial, optie: startOptie }));
  const [standaarden, setStandaarden] = useState(initialStandaarden);
  const [linkInput, setLinkInput] = useState(initial.videoLink);
  const [weergave, setWeergave] = useState<"bewerken" | "voorbeeld">("bewerken");
  const [saveState, setSaveState] = useState<"idle" | "bezig" | "opgeslagen" | "fout">("idle");
  const [copyState, setCopyState] = useState<"ok" | "fout" | null>(null);
  const [beheerMelding, setBeheerMelding] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [beheerPending, startBeheer] = useTransition();
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(concept);
  useEffect(() => {
    latest.current = concept;
  }, [concept]);

  const optie = concept.optie ?? startOptie;
  const meta = WHATSAPP_OPTIE_META[optie];
  const standaard = standaarden[optie];
  const tekst = concept.teksten[optie] ?? standaardMetLink(standaard, concept.videoLink);
  const afgevinkt = concept.checks[optie] ?? [];
  const aangepast = concept.teksten[optie] !== undefined && concept.teksten[optie] !== standaardMetLink(standaard, concept.videoLink);
  const blokkade = kanKopieren(optie, tekst, concept.videoLink, afgevinkt);
  const linkOngeldig = Boolean(concept.videoLink) && !isValidVideoLink(concept.videoLink);

  // Concept automatisch bewaren bij deze opname (kort na de laatste wijziging).
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState("bezig");
    try {
      const r = await saveWhatsappConcept(videoId, latest.current);
      setSaveState(r.ok ? "opgeslagen" : "fout");
    } catch {
      setSaveState("fout");
    }
  }, [videoId]);

  const update = useCallback(
    (fn: (c: WhatsappBerichtConcept) => WhatsappBerichtConcept) => {
      setConcept((c) => fn(c));
      dirty.current = true;
      setCopyState(null);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  const close = useCallback(async () => {
    await flush();
    onClose();
    router.refresh();
  }, [flush, onClose, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void close();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [close]);

  /** Videolink verwerken in alle (aangepaste) teksten; standaardteksten volgen vanzelf. */
  function zetVideoLink(raw: string) {
    const nieuw = normalizeVideoLink(raw);
    update((c) => {
      if (nieuw === c.videoLink) return c;
      const teksten = { ...c.teksten };
      for (const o of WHATSAPP_OPTIES) {
        const t = teksten[o];
        if (t !== undefined) teksten[o] = applyVideoLink(t, c.videoLink, nieuw);
      }
      return { ...c, videoLink: nieuw, teksten };
    });
  }

  function kiesOptie(o: WhatsappOptie) {
    if (o === optie) return;
    update((c) => ({ ...c, optie: o }));
  }

  function zetTekst(value: string) {
    update((c) => ({ ...c, teksten: { ...c.teksten, [optie]: value } }));
  }

  function herstel() {
    update((c) => {
      const teksten = { ...c.teksten };
      delete teksten[optie];
      // Na herstellen moet het bericht opnieuw gecontroleerd worden.
      const checks = { ...c.checks, [optie]: (c.checks[optie] ?? []).filter((k) => k !== "gecontroleerd") };
      return { ...c, teksten, checks };
    });
  }

  function toggleCheck(key: string) {
    update((c) => {
      const huidig = c.checks[optie] ?? [];
      const next = huidig.includes(key) ? huidig.filter((k) => k !== key) : [...huidig, key];
      return { ...c, checks: { ...c.checks, [optie]: next } };
    });
  }

  async function kopieer() {
    if (!blokkade.kan) return;
    const ok = await copyText(tekst);
    setCopyState(ok ? "ok" : "fout");
    if (!ok) return;
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    try {
      const r = await markWhatsappGekopieerd(videoId, optie, latest.current);
      if (r.ok && r.at) setConcept((c) => ({ ...c, gekopieerd: { ...c.gekopieerd, [optie]: r.at! } }));
      setSaveState(r.ok ? "opgeslagen" : "fout");
    } catch {
      setSaveState("fout");
    }
  }

  const saveStandaard = (reset: boolean) =>
    startBeheer(async () => {
      setBeheerMelding(null);
      const r = await updateWhatsappStandaard(optie, reset ? "" : applyVideoLink(tekst, concept.videoLink, ""), { reset });
      if (r.ok) {
        setStandaarden((s) => ({ ...s, [optie]: r.text }));
        setBeheerMelding({ tone: "ok", text: reset ? "Standaardtekst hersteld voor iedereen." : "Opgeslagen als standaard voor iedereen." });
      } else {
        setBeheerMelding({ tone: "bad", text: r.message });
      }
    });

  const gekopieerdOp = concept.gekopieerd[optie];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 text-[var(--color-ink)] sm:items-center sm:p-4"
      onClick={() => void close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`WhatsApp-bericht ${clientName}`}
        className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)] sm:max-h-[92vh] sm:max-w-2xl sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kop */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] px-5 pb-3 pt-4">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">WhatsApp-bericht eerste versies</p>
            <h3 className="truncate text-base font-bold">{clientName}</h3>
          </div>
          <button type="button" onClick={() => void close()} aria-label="Sluiten" className="mt-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Stap 1: optie */}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Hoe ontvangt de klant de video's?">
            {WHATSAPP_OPTIES.map((o) => {
              const Icon = OPTIE_ICON[o];
              const on = o === optie;
              return (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => kiesOptie(o)}
                  className={`flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm font-semibold ring-1 transition ${
                    on
                      ? "bg-[var(--color-indigo-ink)] text-white ring-[var(--color-indigo-ink)]"
                      : "bg-[var(--color-surface)] text-[var(--color-ink)] ring-[var(--color-line-strong)] hover:bg-[var(--color-surface-2)]"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="leading-tight">{WHATSAPP_OPTIE_META[o].label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">{meta.uitleg}</p>

          {/* Stap 2: videolink (alleen optie 1) */}
          {optie === "videolink" ? (
            <div className="mt-4">
              <label htmlFor={`wa-link-${videoId}`} className="mb-1 block text-xs font-semibold">
                Videolink
              </label>
              <input
                id={`wa-link-${videoId}`}
                type="url"
                inputMode="url"
                autoFocus={!concept.videoLink}
                value={linkInput}
                onChange={(e) => {
                  setLinkInput(e.target.value);
                  zetVideoLink(e.target.value);
                }}
                onBlur={() => setLinkInput(concept.videoLink)}
                placeholder="Plak hier de videolink"
                className={`sc-input w-full text-sm ${!concept.videoLink || linkOngeldig ? "ring-1 ring-[var(--color-warn)]" : ""}`}
              />
              {!concept.videoLink ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-warn)]">
                  <AlertTriangle className="size-3.5" /> De videolink ontbreekt nog. Zonder link kun je het bericht niet kopiëren.
                </p>
              ) : linkOngeldig ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-warn)]">
                  <AlertTriangle className="size-3.5" /> Deze link lijkt niet te kloppen. Controleer of je de volledige link hebt geplakt.
                </p>
              ) : (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--color-good)]">
                  <CheckCircle2 className="size-3.5" /> Link staat in het bericht.
                </p>
              )}
              <div className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-3 py-2 text-xs leading-relaxed">
                <Paperclip className="mt-0.5 size-3.5 shrink-0 text-[var(--color-warn)]" />
                <span>
                  <strong>Voeg in WhatsApp de contentplanning als PDF toe</strong> aan dit bericht. De PDF download je bij Contentplanning.
                </span>
              </div>
            </div>
          ) : null}

          {/* Stap 3: bericht */}
          <div className="mt-4">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold">Bericht {aangepast ? <span className="font-medium text-[var(--color-ink-muted)]">· aangepast voor deze opname</span> : null}</span>
              <div className="inline-flex rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] p-0.5 text-2xs font-semibold">
                <button
                  type="button"
                  onClick={() => setWeergave("bewerken")}
                  className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-1 ${weergave === "bewerken" ? "bg-[var(--color-surface)] shadow-sm" : "text-[var(--color-ink-muted)]"}`}
                >
                  <Pencil className="size-3" /> Bewerken
                </button>
                <button
                  type="button"
                  onClick={() => setWeergave("voorbeeld")}
                  className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-1 ${weergave === "voorbeeld" ? "bg-[var(--color-surface)] shadow-sm" : "text-[var(--color-ink-muted)]"}`}
                >
                  <Eye className="size-3" /> Voorbeeld in WhatsApp
                </button>
              </div>
            </div>
            {weergave === "bewerken" ? (
              <>
                <textarea
                  value={tekst}
                  onChange={(e) => zetTekst(e.target.value)}
                  rows={16}
                  aria-label="Tekst van het WhatsApp-bericht"
                  className="sc-input min-h-[280px] w-full resize-y py-2.5 text-sm leading-relaxed"
                />
                <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">
                  WhatsApp-opmaak: *tekst* wordt <strong>vet</strong>, _tekst_ wordt <em>cursief</em>. Je aanpassing geldt alleen voor deze opname.
                </p>
              </>
            ) : (
              <WhatsappVoorbeeld tekst={tekst} />
            )}
          </div>

          {/* Stap 4: checklist */}
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-3 py-2.5">
            <p className="mb-1.5 text-xs font-semibold">Checklist voor het versturen</p>
            <ul className="space-y-1">
              {WHATSAPP_CHECKLIST[optie].map((item) => {
                const done = item.auto ? Boolean(concept.videoLink) && !linkOngeldig : afgevinkt.includes(item.key);
                return (
                  <li key={item.key}>
                    <label className={`flex items-center gap-2 text-sm ${item.auto ? "cursor-default" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        checked={done}
                        disabled={item.auto}
                        onChange={() => toggleCheck(item.key)}
                        className="size-4 accent-[var(--color-good)]"
                      />
                      <span className={done ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}>{item.label}</span>
                      {item.auto ? <span className="text-2xs text-[var(--color-ink-faint)]">(automatisch)</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          {copyState === "ok" ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-good)]/40 bg-[var(--color-good-soft)] px-3 py-2.5 text-sm">
              <p className="flex items-center gap-1.5 font-bold text-[var(--color-good)]">
                <CheckCircle2 className="size-4" /> Bericht gekopieerd!
              </p>
              <p className="mt-0.5 text-[var(--color-ink)]">{meta.naKopieren}</p>
            </div>
          ) : copyState === "fout" ? (
            <p className="mt-4 text-sm font-semibold text-[var(--color-bad)]">Kopiëren mislukt. Selecteer de tekst in het tekstveld en kopieer handmatig.</p>
          ) : null}

          {canManage ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] pt-3">
              <span className="text-2xs text-[var(--color-ink-faint)]">Beheer: standaardtekst {meta.kort} voor alle medewerkers</span>
              <div className="flex items-center gap-3">
                <button type="button" disabled={beheerPending} onClick={() => saveStandaard(true)} className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50">
                  Vaste tekst terugzetten
                </button>
                <button
                  type="button"
                  disabled={beheerPending || !aangepast}
                  onClick={() => saveStandaard(false)}
                  title="Slaat deze tekst (zonder de videolink) op als standaard voor iedereen"
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
                >
                  {beheerPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Opslaan als standaard
                </button>
              </div>
              {beheerMelding ? (
                <p className={`w-full text-xs font-medium ${beheerMelding.tone === "ok" ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{beheerMelding.text}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Voet: altijd zichtbaar, ook op mobiel */}
        <div className="border-t border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-3">
          {!blokkade.kan ? (
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-warn)]">
              <AlertTriangle className="size-3.5" /> {blokkade.reden}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center justify-between gap-3 sm:justify-start">
              <button
                type="button"
                onClick={herstel}
                disabled={!aangepast}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
              >
                <RotateCcw className="size-3.5" /> Herstel standaardtekst
              </button>
              <span className="text-2xs text-[var(--color-ink-faint)]">
                {saveState === "bezig"
                  ? "Opslaan..."
                  : saveState === "fout"
                    ? "Opslaan mislukt"
                    : gekopieerdOp
                      ? `Laatst gekopieerd ${fmtMoment(gekopieerdOp)}`
                      : saveState === "opgeslagen"
                        ? "Concept opgeslagen"
                        : null}
              </span>
            </div>
            <button
              type="button"
              disabled={!blokkade.kan}
              onClick={() => void kopieer()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[#FF6A00] px-5 py-2.5 text-sm font-bold text-white shadow-sm ring-1 ring-black/10 transition-colors hover:bg-[#e85f00] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
            >
              {copyState === "ok" ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copyState === "ok" ? "Bericht gekopieerd!" : "Kopieer bericht"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Zo ziet het bericht eruit in WhatsApp: vet, cursief en witregels. */
function WhatsappVoorbeeld({ tekst }: { tekst: string }) {
  const regels = useMemo(() => tekst.split("\n"), [tekst]);
  return (
    <div className="rounded-[var(--radius-md)] bg-[#EFEAE2] p-3">
      <div className="ml-auto max-w-[92%] rounded-[10px] rounded-tr-[2px] bg-[#D9FDD3] px-3 py-2 text-[14px] leading-[1.45] text-[#111B21] shadow-sm">
        {regels.map((r, i) =>
          r === "" ? (
            <div key={i} className="h-[1.45em]" />
          ) : (
            <div key={i} className="whitespace-pre-wrap break-words">
              {whatsappOpmaak(r).map((d, j) =>
                d.bold ? <strong key={j}>{d.text}</strong> : d.italic ? <em key={j}>{d.text}</em> : <span key={j}>{d.text}</span>,
              )}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
