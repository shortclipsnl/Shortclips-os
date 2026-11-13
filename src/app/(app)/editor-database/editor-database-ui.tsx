"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Check, ExternalLink, History, Mail, MessageCircle, Phone, Plus, Search, Star, Upload, X, Zap,
} from "lucide-react";
import { Badge, Button, PageHeader, type Tone } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  AVAILABILITY, AVAILABILITY_FRESH_DAYS, EDITOR_CATEGORIES, PROFILE_FIELDS, SPECIALISATIONS, WORKED_WITH_US,
  findDuplicate, formatPhone, labelForUrl, parseImport, whatsappUrl,
  type EditorLink, type ImportCandidate,
} from "@/lib/editor-database";
import type { EditorHistoryItem, EditorProfile } from "@/server/editor-database";
import {
  addEditorNote, archiveEditor, confirmAvailability, createEditor, importEditors, markEditorVerified,
  setEditorCategory, toggleEditorFavorite, updateEditor,
} from "@/server/actions/editor-database";

/* ------------------------------------------------------------------ *
 * Hulpjes
 * ------------------------------------------------------------------ */

const CAT_TONE: Record<string, Tone> = { actief: "good", backup: "info", potentieel: "neutral", niet_geschikt: "bad" };
const catLabel = (k: string) => EDITOR_CATEGORIES.find((c) => c.key === k)?.short ?? k;
const avLabel = (k: string) => AVAILABILITY.find((a) => a.key === k)?.label ?? k;
const FIELD_LABEL: Record<string, string> = {
  fullName: "naam", phone: "telefoon", whatsapp: "WhatsApp", email: "e-mail", portfolioUrl: "portfolio", links: "links",
  specialisations: "specialisaties", category: "categorie", workedWithUs: "eerdere samenwerking", collaborationNote: "toelichting samenwerking",
  ratePerVideo: "tarief", rateNote: "toelichting tarief", availability: "beschikbaarheid", availabilityNote: "toelichting beschikbaarheid",
  ratingQuality: "kwaliteit", ratingCollaboration: "samenwerking", favorite: "favoriet", notes: "opmerking",
};
const ACTION_LABEL: Record<string, string> = {
  "editor_database.create": "Aangemaakt", "editor_database.update": "Gewijzigd", "editor_database.category": "Categorie gewijzigd",
  "editor_database.availability": "Beschikbaarheid bevestigd", "editor_database.favorite": "Favoriet aangepast",
  "editor_database.note": "Opmerking toegevoegd", "editor_database.verified": "Gegevens gecontroleerd",
  "editor_database.import_create": "Geïmporteerd", "editor_database.import_enrich": "Aangevuld via import", "editor_database.archive": "Gearchiveerd",
};

function fmtDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

function ago(days: number | null) {
  if (days === null) return "";
  if (days === 0) return "vandaag";
  if (days === 1) return "gisteren";
  return `${days} dagen geleden`;
}

const rateOf = (p: EditorProfile) => p.ratePerVideo ?? p.knownRate ?? null;
const ratingOf = (p: EditorProfile) => {
  const r = [p.ratingQuality, p.ratingCollaboration].filter((v): v is number => v != null);
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
};

/** Volgorde bij spoed: recent bevestigd beschikbaar, favoriet, beoordeling, ervaring met ons. */
function spoedScore(p: EditorProfile) {
  const av = p.availabilityStatus === "bevestigd" ? (p.availability === "beschikbaar" ? 3 : p.availability === "beperkt" ? 2 : -5) : 0;
  return av * 100 + (p.favorite ? 40 : 0) + (ratingOf(p) ?? 2.5) * 8 + (p.workedWithUs === "ja" ? 10 : 0) + (p.category === "actief" ? 5 : p.category === "backup" ? 4 : 0);
}

function Stars({ value, onChange, label }: { value: number | null; onChange?: (v: number | null) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${label}: ${value ?? "geen"} van 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(value === n ? null : n)}
          className={cn("leading-none", onChange ? "cursor-pointer" : "cursor-default")}
          title={onChange ? `${n} van 5` : undefined}
        >
          <Star className={cn("size-3.5", value != null && n <= value ? "fill-[var(--color-warn)] text-[var(--color-warn)]" : "text-[var(--color-line-strong)]")} strokeWidth={1.75} />
        </button>
      ))}
    </span>
  );
}

function AvailabilityLine({ p, compact }: { p: EditorProfile; compact?: boolean }) {
  if (p.availabilityStatus === "onbekend") {
    return <span className="text-[var(--color-ink-muted)]">Beschikbaarheid onbekend</span>;
  }
  if (p.availabilityStatus === "verouderd") {
    return (
      <span className="text-[#8a5300]">
        Niet recent bevestigd · laatst {avLabel(p.availability).toLowerCase()} op {fmtDate(p.availabilityConfirmedAt)}
      </span>
    );
  }
  const tone = p.availability === "beschikbaar" ? "text-[#1d6b4c]" : p.availability === "beperkt" ? "text-[#8a5300]" : "text-[#a3271c]";
  return (
    <span className={tone}>
      <strong>{avLabel(p.availability)}</strong> · bevestigd {ago(p.availabilityDays)}
      {!compact && p.availabilityConfirmedBy ? ` door ${p.availabilityConfirmedBy.split(" ")[0]}` : ""}
    </span>
  );
}

const inputCls = "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-indigo-ink)]";
const labelCls = "mb-1 block text-xs font-semibold text-[var(--color-ink-muted)]";
const WA_BTN = "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-good)] px-3 font-semibold text-white transition hover:brightness-110";

/* ------------------------------------------------------------------ *
 * Hoofdcomponent
 * ------------------------------------------------------------------ */

type Filters = {
  q: string; cat: string; spec: string; av: string; minRating: string; maxRate: string; worked: string; fav: boolean;
};
const EMPTY: Filters = { q: "", cat: "alle", spec: "", av: "", minRating: "", maxRate: "", worked: "", fav: false };

export function EditorDatabase({
  profiles, history, initialSpoed, initialOpenId,
}: {
  profiles: EditorProfile[];
  history: Record<string, EditorHistoryItem[]>;
  initialSpoed: boolean;
  initialOpenId: string | null;
}) {
  const [f, setF] = useState<Filters>(EMPTY);
  const [spoed, setSpoed] = useState(initialSpoed);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((s) => ({ ...s, [k]: v }));

  const specOptions = useMemo(() => {
    const all = new Set<string>(SPECIALISATIONS);
    profiles.forEach((p) => p.specialisations.forEach((s) => all.add(s)));
    return [...all];
  }, [profiles]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { alle: profiles.length };
    EDITOR_CATEGORIES.forEach((k) => (c[k.key] = profiles.filter((p) => p.category === k.key).length));
    return c;
  }, [profiles]);

  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    let out = profiles.filter((p) => {
      if (spoed && p.category === "niet_geschikt") return false;
      if (!spoed && f.cat !== "alle" && p.category !== f.cat) return false;
      if (q && ![p.fullName, p.email, p.phone, p.collaborationNote, ...p.specialisations].some((v) => v?.toLowerCase().includes(q))) return false;
      if (f.spec && !p.specialisations.includes(f.spec)) return false;
      if (f.av === "beschikbaar" && !(p.availabilityStatus === "bevestigd" && p.availability === "beschikbaar")) return false;
      if (f.av === "inzetbaar" && !(p.availabilityStatus === "bevestigd" && (p.availability === "beschikbaar" || p.availability === "beperkt"))) return false;
      if (f.av === "niet_bevestigd" && p.availabilityStatus === "bevestigd") return false;
      if (f.minRating && (ratingOf(p) ?? 0) < Number(f.minRating)) return false;
      if (f.maxRate && (rateOf(p) == null || rateOf(p)! > Number(f.maxRate))) return false;
      if (f.worked && p.workedWithUs !== f.worked) return false;
      if (f.fav && !p.favorite) return false;
      return true;
    });
    out = spoed
      ? out.sort((a, b) => spoedScore(b) - spoedScore(a))
      : out.sort((a, b) => Number(b.favorite) - Number(a.favorite) || EDITOR_CATEGORIES.findIndex((c) => c.key === a.category) - EDITOR_CATEGORIES.findIndex((c) => c.key === b.category) || a.fullName.localeCompare(b.fullName));
    return out;
  }, [profiles, f, spoed]);

  const open = profiles.find((p) => p.id === openId) ?? null;
  const filtersActive = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const toCheck = profiles.filter((p) => p.unverifiedFields.length > 0).length;

  return (
    <>
      <PageHeader
        title="Editor database"
        description={`${profiles.length} editors · actief, back up en potentieel op één plek · alleen zichtbaar voor het interne team`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="size-4" /> Contacten importeren</Button>
            <Button onClick={() => setCreating(true)}><Plus className="size-4" /> Editor toevoegen</Button>
          </>
        }
      />

      {/* Spoedbalk */}
      <div className={cn("mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-4 py-3", spoed ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line)] bg-[var(--color-surface)]")}>
        <div className="flex items-center gap-3">
          <Zap className={cn("size-5 shrink-0", spoed ? "text-white" : "text-[var(--color-indigo-ink)]")} strokeWidth={1.75} />
          <div className="text-sm">
            <p className="font-semibold">{spoed ? "Spoedweergave: beste kandidaten bovenaan" : "Extra capaciteit nodig of valt een editor uit?"}</p>
            <p className={cn("text-xs", spoed ? "text-white/80" : "text-[var(--color-ink-muted)]")}>
              {spoed
                ? `Volgorde: recent bevestigd beschikbaar, favoriet, beoordeling en eerdere samenwerking. Niet geschikt staat er niet tussen. Beschikbaarheid ouder dan ${AVAILABILITY_FRESH_DAYS} dagen telt niet als bevestigd.`
                : "Zet de spoedweergave aan: inzetbare editors gesorteerd op beschikbaarheid en kwaliteit, met direct een WhatsApp-knop."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSpoed((s) => !s)}
          className={cn("h-9 rounded-[var(--radius-sm)] px-4 text-sm font-semibold", spoed ? "bg-white text-[var(--color-indigo-ink)]" : "bg-[var(--color-indigo-ink)] text-white hover:bg-[var(--color-indigo-soft)]")}
        >
          {spoed ? "Spoedweergave uit" : "Spoedweergave aan"}
        </button>
      </div>

      {/* Categorieën */}
      {!spoed ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {[{ key: "alle", short: "Alle editors", help: "" }, ...EDITOR_CATEGORIES.map((c) => ({ key: c.key, short: c.label, help: c.help }))].map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.help}
              onClick={() => set("cat", c.key)}
              className={cn("rounded-full px-3 py-1 text-xs font-semibold", f.cat === c.key ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-surface)] text-[var(--color-ink-muted)] ring-1 ring-[var(--color-line)] hover:text-[var(--color-ink)]")}
            >
              {c.short} <span className="tabular-nums opacity-70">{counts[c.key] ?? 0}</span>
            </button>
          ))}
          {toCheck > 0 ? <span className="ml-auto text-xs text-[var(--color-ink-muted)]"><AlertTriangle className="mr-1 inline size-3.5 text-[#8a5300]" />{toCheck} profielen met gegevens die nog gecontroleerd moeten worden</span> : null}
        </div>
      ) : null}

      {/* Filters */}
      <div className="mb-4 grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 md:grid-cols-4 xl:grid-cols-8">
        <label className="relative col-span-2">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--color-ink-faint)]" />
          <input className={cn(inputCls, "pl-8")} placeholder="Zoek op naam, e-mail, specialisatie…" value={f.q} onChange={(e) => set("q", e.target.value)} />
        </label>
        <select className={inputCls} value={f.spec} onChange={(e) => set("spec", e.target.value)} aria-label="Specialisatie">
          <option value="">Alle specialisaties</option>
          {specOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={inputCls} value={f.av} onChange={(e) => set("av", e.target.value)} aria-label="Beschikbaarheid">
          <option value="">Elke beschikbaarheid</option>
          <option value="beschikbaar">Bevestigd beschikbaar</option>
          <option value="inzetbaar">Beschikbaar of beperkt</option>
          <option value="niet_bevestigd">Niet (recent) bevestigd</option>
        </select>
        <select className={inputCls} value={f.minRating} onChange={(e) => set("minRating", e.target.value)} aria-label="Beoordeling">
          <option value="">Elke beoordeling</option>
          <option value="3">3 sterren of meer</option>
          <option value="4">4 sterren of meer</option>
          <option value="4.5">4,5 of meer</option>
        </select>
        <select className={inputCls} value={f.maxRate} onChange={(e) => set("maxRate", e.target.value)} aria-label="Tarief">
          <option value="">Elk tarief</option>
          {[30, 40, 50, 60, 80, 100].map((n) => <option key={n} value={n}>Tot € {n} per video</option>)}
        </select>
        <select className={inputCls} value={f.worked} onChange={(e) => set("worked", e.target.value)} aria-label="Eerdere samenwerking">
          <option value="">Samenwerking: alle</option>
          <option value="ja">Eerder voor ons gewerkt</option>
          <option value="nee">Nog niet voor ons gewerkt</option>
        </select>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => set("fav", !f.fav)}
            className={cn("inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border text-sm font-medium", f.fav ? "border-[var(--color-warn)] bg-[var(--color-warn-soft)] text-[#8a5300]" : "border-[var(--color-line-strong)] text-[var(--color-ink-muted)]")}
          >
            <Star className={cn("size-4", f.fav && "fill-[var(--color-warn)] text-[var(--color-warn)]")} /> Favorieten
          </button>
          {filtersActive ? <button type="button" onClick={() => setF(EMPTY)} className="text-xs font-medium text-[var(--color-ink-muted)] underline">Wissen</button> : null}
        </div>
      </div>

      {list.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
          Geen editors gevonden met deze filters.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p, i) => <EditorCard key={p.id} p={p} rank={spoed ? i + 1 : null} onOpen={() => setOpenId(p.id)} />)}
        </div>
      )}

      {open ? <ProfilePanel key={open.id} p={open} history={history[open.id] ?? []} onClose={() => setOpenId(null)} /> : null}
      {creating ? <ProfileForm onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} /> : null}
      {importing ? <ImportDialog profiles={profiles} onClose={() => setImporting(false)} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Kaart
 * ------------------------------------------------------------------ */

function FavoriteButton({ p }: { p: EditorProfile }) {
  const router = useRouter();
  const [fav, setFav] = useState(p.favorite);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title={fav ? "Favoriet weghalen" : "Als favoriet markeren"}
      onClick={(e) => {
        e.stopPropagation();
        setFav(!fav);
        start(async () => { const r = await toggleEditorFavorite(p.id); if (!r.ok) setFav(fav); router.refresh(); });
      }}
      className="rounded p-1 hover:bg-[var(--color-surface-sunken)]"
    >
      <Star className={cn("size-4", fav ? "fill-[var(--color-warn)] text-[var(--color-warn)]" : "text-[var(--color-ink-faint)]")} strokeWidth={1.75} />
    </button>
  );
}

function EditorCard({ p, rank, onOpen }: { p: EditorProfile; rank: number | null; onOpen: () => void }) {
  const wa = whatsappUrl(p.whatsapp, p.phone);
  const portfolio = p.portfolioUrl ?? p.links[0]?.url ?? null;
  const rate = rateOf(p);
  return (
    <div className="flex flex-col rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <p className="truncate text-[15px] font-semibold text-[var(--color-ink)] hover:underline">
            {rank ? <span className="mr-1.5 tabular-nums text-[var(--color-ink-faint)]">{rank}.</span> : null}{p.fullName}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={CAT_TONE[p.category] ?? "neutral"}>{catLabel(p.category)}</Badge>
            {p.unverifiedFields.length ? <Badge tone="warn">Te controleren</Badge> : null}
          </div>
        </button>
        <FavoriteButton p={p} />
      </div>

      <p className="mt-3 text-xs"><AvailabilityLine p={p} compact /></p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-[var(--color-ink-muted)]">Kwaliteit</dt>
        <dd><Stars value={p.ratingQuality} label="Kwaliteit" /></dd>
        <dt className="text-[var(--color-ink-muted)]">Samenwerking</dt>
        <dd><Stars value={p.ratingCollaboration} label="Samenwerking" /></dd>
        <dt className="text-[var(--color-ink-muted)]">Tarief</dt>
        <dd className="font-medium text-[var(--color-ink)]">{rate != null ? `€ ${rate} per video` : <span className="font-normal text-[var(--color-ink-faint)]">Onbekend</span>}</dd>
        <dt className="text-[var(--color-ink-muted)]">Bij Shortclips</dt>
        <dd className="text-[var(--color-ink)]">
          {p.stats ? `${p.stats.total} video's · laatst ${fmtDate(p.stats.lastWorkOn)}` : p.workedWithUs === "ja" ? "Eerder gewerkt" : p.workedWithUs === "nee" ? "Nog niet" : <span className="text-[var(--color-ink-faint)]">Onbekend</span>}
        </dd>
      </dl>

      {p.specialisations.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {p.specialisations.slice(0, 4).map((s) => <span key={s} className="rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink)]">{s}</span>)}
          {p.specialisations.length > 4 ? <span className="px-1 text-[11px] text-[var(--color-ink-muted)]">+{p.specialisations.length - 4}</span> : null}
        </div>
      ) : null}

      {p.missing.length ? (
        <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">Ontbreekt: {p.missing.map((m) => PROFILE_FIELDS.find((x) => x.key === m)?.label.toLowerCase()).join(", ")}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={cn(WA_BTN, "h-8 text-xs")} title="Opent WhatsApp, er wordt niets automatisch verstuurd">
            <MessageCircle className="size-3.5" /> WhatsApp
          </a>
        ) : (
          <span className="inline-flex h-8 items-center rounded-[var(--radius-sm)] px-2 text-xs text-[var(--color-ink-faint)]">Geen nummer</span>
        )}
        {portfolio ? (
          <a href={portfolio} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">
            <ExternalLink className="size-3.5" /> Portfolio
          </a>
        ) : null}
        <button type="button" onClick={onOpen} className="ml-auto h-8 rounded-[var(--radius-sm)] px-3 text-xs font-semibold text-[var(--color-indigo-ink)] hover:bg-[var(--color-surface-sunken)]">
          Profiel openen
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Profielpaneel
 * ------------------------------------------------------------------ */

function Drawer({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-[560px] flex-col bg-[var(--color-canvas,#fff)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-4">
          <div className="min-w-0">{title}</div>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]" aria-label="Sluiten"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Unverified({ p, field }: { p: EditorProfile; field: string }) {
  return p.unverifiedFields.includes(field) ? <span className="ml-1.5 rounded bg-[var(--color-warn-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[#8a5300]">uit import, controleren</span> : null;
}

function Missing() {
  return <span className="text-[var(--color-ink-faint)]">Ontbreekt nog</span>;
}

function ProfilePanel({ p, history, onClose }: { p: EditorProfile; history: EditorHistoryItem[]; onClose: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [avNote, setAvNote] = useState(p.availabilityNote ?? "");
  const wa = whatsappUrl(p.whatsapp, p.phone);
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, done?: () => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (!r.ok) setMsg(r.message ?? "Er ging iets mis.");
      else { done?.(); router.refresh(); }
    });

  if (editing) return <ProfileForm profile={p} onClose={() => setEditing(false)} onCreated={() => setEditing(false)} />;

  const allLinks: EditorLink[] = [...(p.portfolioUrl ? [{ url: p.portfolioUrl, label: `Portfolio · ${labelForUrl(p.portfolioUrl)}` }] : []), ...p.links];
  const rate = rateOf(p);

  return (
    <Drawer
      onClose={onClose}
      title={
        <>
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-[var(--color-ink)]">{p.fullName}</h2>
            <FavoriteButton p={p} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
            <select
              className="h-7 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 text-xs font-semibold text-[var(--color-ink)]"
              value={p.category}
              disabled={pending}
              onChange={(e) => act(() => setEditorCategory(p.id, e.target.value))}
              aria-label="Categorie"
            >
              {EDITOR_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <Unverified p={p} field="category" />
            <span>Bijgewerkt {fmtDate(p.updatedAt, true)}{p.updatedBy ? ` door ${p.updatedBy.split(" ")[0]}` : ""}</span>
          </div>
        </>
      }
    >
      {msg ? <p className="mb-3 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[#a3271c]">{msg}</p> : null}

      <div className="mb-5 flex flex-wrap gap-2">
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={cn(WA_BTN, "h-9 text-sm")}>
            <MessageCircle className="size-4" /> WhatsApp openen
          </a>
        ) : null}
        <Button variant="secondary" onClick={() => setEditing(true)}>Gegevens bewerken</Button>
        {p.unverifiedFields.length ? <Button variant="secondary" disabled={pending} onClick={() => act(() => markEditorVerified(p.id))}><Check className="size-4" /> Alles gecontroleerd</Button> : null}
      </div>
      {wa ? <p className="-mt-3 mb-5 text-[11px] text-[var(--color-ink-faint)]">WhatsApp opent alleen het gesprek; er wordt niets automatisch verstuurd.</p> : null}

      <Section title="Beschikbaarheid">
        <p className="text-sm"><AvailabilityLine p={p} /></p>
        {p.availabilityNote ? <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{p.availabilityNote}</p> : null}
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Net contact gehad? Leg vast wat de editor zei. Een eerdere samenwerking betekent niet dat iemand nu beschikbaar is.</p>
        <input className={cn(inputCls, "mt-2")} placeholder="Toelichting, bijvoorbeeld: vanaf maandag 10 shorts per week" value={avNote} onChange={(e) => setAvNote(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {AVAILABILITY.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={pending}
              onClick={() => act(() => confirmAvailability(p.id, a.key, avNote))}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"
            >
              {a.key === "onbekend" ? "Onbekend" : `${a.label} (vandaag)`}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Contact">
        <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
          <dt className="text-[var(--color-ink-muted)]">Telefoon</dt>
          <dd>{p.phone ? <a className="inline-flex items-center gap-1 hover:underline" href={`tel:${p.phone}`}><Phone className="size-3.5" />{formatPhone(p.phone)}</a> : <Missing />}<Unverified p={p} field="phone" /></dd>
          <dt className="text-[var(--color-ink-muted)]">WhatsApp</dt>
          <dd>{p.whatsapp ? formatPhone(p.whatsapp) : p.phone ? <span className="text-[var(--color-ink-muted)]">Zelfde nummer</span> : <Missing />}</dd>
          <dt className="text-[var(--color-ink-muted)]">E-mail</dt>
          <dd className="break-all">{p.email ? <a className="inline-flex items-center gap-1 hover:underline" href={`mailto:${p.email}`}><Mail className="size-3.5" />{p.email}</a> : <Missing />}<Unverified p={p} field="email" /></dd>
        </dl>
      </Section>

      <Section title="Portfolio en voorbeelden">
        {allLinks.length ? (
          <ul className="space-y-1.5">
            {allLinks.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-indigo-ink)] hover:underline">
                  <ExternalLink className="size-3.5" /> {l.label}
                </a>
                <span className="ml-2 break-all text-xs text-[var(--color-ink-faint)]">{l.url.replace(/^https?:\/\//, "").slice(0, 60)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm"><Missing /> <button type="button" className="text-xs underline" onClick={() => setEditing(true)}>Portfolio toevoegen</button></p>}
      </Section>

      <Section title="Profiel">
        <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-ink-muted)]">Specialisaties</dt>
          <dd>{p.specialisations.length ? p.specialisations.join(", ") : <Missing />}<Unverified p={p} field="specialisations" /></dd>
          <dt className="text-[var(--color-ink-muted)]">Tarief</dt>
          <dd>
            {rate != null ? `€ ${rate} per video (ex btw)` : <Missing />}
            {p.ratePerVideo == null && p.knownRate ? <span className="ml-1 text-xs text-[var(--color-ink-muted)]">volgens Editkosten</span> : null}
            <Unverified p={p} field="ratePerVideo" />
            {p.rateNote ? <span className="block text-xs text-[var(--color-ink-muted)]">{p.rateNote}</span> : null}
          </dd>
          <dt className="text-[var(--color-ink-muted)]">Kwaliteit</dt>
          <dd><Stars value={p.ratingQuality} label="Kwaliteit" /></dd>
          <dt className="text-[var(--color-ink-muted)]">Samenwerking</dt>
          <dd><Stars value={p.ratingCollaboration} label="Samenwerking" /></dd>
        </dl>
      </Section>

      <Section title="Samenwerking met Shortclips">
        <p className="text-sm">{WORKED_WITH_US.find((w) => w.key === p.workedWithUs)?.label}</p>
        {p.stats ? (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Uit het portaal: {p.stats.total} video&apos;s ({p.stats.done} afgerond{p.stats.inProduction ? `, ${p.stats.inProduction} in productie` : ""}) voor {p.stats.clients} klanten, laatst {fmtDate(p.stats.lastWorkOn)}.
            {p.stats.recentClients.length ? ` O.a. ${p.stats.recentClients.join(", ")}.` : ""}
          </p>
        ) : null}
        {p.collaborationNote ? <p className="mt-1 whitespace-pre-line text-sm">{p.collaborationNote}</p> : null}
      </Section>

      <Section title="Opmerkingen van het team">
        <div className="flex gap-2">
          <input className={inputCls} placeholder="Opmerking toevoegen…" value={note} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) act(() => addEditorNote(p.id, note), () => setNote("")); }} />
          <Button size="md" disabled={pending || !note.trim()} onClick={() => act(() => addEditorNote(p.id, note), () => setNote(""))}>Toevoegen</Button>
        </div>
        {p.notes.length ? (
          <ul className="mt-3 space-y-2">
            {p.notes.map((n) => (
              <li key={n.id} className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm">
                <p className="whitespace-pre-line">{n.text}</p>
                <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">{n.byName} · {fmtDate(n.at, true)}</p>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Nog geen opmerkingen.</p>}
      </Section>

      <Section title="Wijzigingen">
        {history.length ? (
          <ul className="space-y-1 text-xs text-[var(--color-ink-muted)]">
            {history.map((h, i) => (
              <li key={i} className="flex gap-2">
                <History className="mt-0.5 size-3 shrink-0" />
                <span>
                  <strong className="text-[var(--color-ink)]">{h.by.split(" ")[0]}</strong> · {ACTION_LABEL[h.action] ?? h.action}
                  {h.action === "editor_database.update" && h.fields.length ? `: ${h.fields.map((x) => FIELD_LABEL[x] ?? x).join(", ")}` : ""} · {fmtDate(h.at, true)}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-[var(--color-ink-faint)]">{p.source === "portaal" ? "Automatisch aangemaakt vanuit het bestaande editoraccount." : "Nog geen wijzigingen vastgelegd."}</p>}
        {p.sourceLabel ? <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">Bron: {p.sourceLabel}</p> : null}
      </Section>

      <div className="border-t border-[var(--color-line)] pt-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => { if (window.confirm(`${p.fullName} archiveren? Het profiel verdwijnt uit de database maar blijft herleidbaar.`)) act(() => archiveEditor(p.id), onClose); }}
          className="text-xs font-medium text-[var(--color-ink-muted)] underline hover:text-[var(--color-bad)]"
        >
          Profiel archiveren
        </button>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ *
 * Formulier (toevoegen en bewerken)
 * ------------------------------------------------------------------ */

function ProfileForm({ profile, onClose, onCreated }: { profile?: EditorProfile; onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [s, setS] = useState({
    fullName: profile?.fullName ?? "",
    phone: profile?.phone ?? "",
    whatsapp: profile?.whatsapp ?? "",
    email: profile?.email ?? "",
    portfolioUrl: profile?.portfolioUrl ?? "",
    links: profile?.links ?? ([] as EditorLink[]),
    specialisations: profile?.specialisations ?? ([] as string[]),
    category: profile?.category ?? "potentieel",
    workedWithUs: profile?.workedWithUs ?? "onbekend",
    collaborationNote: profile?.collaborationNote ?? "",
    ratePerVideo: profile?.ratePerVideo != null ? String(profile.ratePerVideo) : "",
    rateNote: profile?.rateNote ?? "",
    availability: profile?.availability ?? "onbekend",
    availabilityNote: profile?.availabilityNote ?? "",
    ratingQuality: profile?.ratingQuality ?? null,
    ratingCollaboration: profile?.ratingCollaboration ?? null,
  });
  const [newSpec, setNewSpec] = useState("");
  const [newLink, setNewLink] = useState("");
  const up = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((x) => ({ ...x, [k]: v }));
  const toggleSpec = (v: string) => up("specialisations", s.specialisations.includes(v) ? s.specialisations.filter((x) => x !== v) : [...s.specialisations, v]);
  const specs = Array.from(new Set([...SPECIALISATIONS, ...s.specialisations]));

  const save = () =>
    start(async () => {
      setErr(null);
      const r = profile ? await updateEditor(profile.id, s) : await createEditor(s);
      if (!r.ok) { setErr(r.message); return; }
      router.refresh();
      onCreated(profile ? profile.id : (r as unknown as { id: string }).id);
    });

  return (
    <Drawer onClose={onClose} title={<h2 className="text-lg font-semibold text-[var(--color-ink)]">{profile ? `${profile.fullName} bewerken` : "Editor toevoegen"}</h2>}>
      {err ? <p className="mb-3 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[#a3271c]">{err}</p> : null}
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Volledige naam *</label>
          <input className={inputCls} value={s.fullName} onChange={(e) => up("fullName", e.target.value)} autoFocus />
        </div>
        <div>
          <label className={labelCls}>Categorie</label>
          <div className="grid grid-cols-2 gap-1.5">
            {EDITOR_CATEGORIES.map((c) => (
              <button key={c.key} type="button" onClick={() => up("category", c.key)}
                className={cn("rounded-[var(--radius-sm)] border px-3 py-2 text-left text-xs", s.category === c.key ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line-strong)] text-[var(--color-ink)]")}>
                <span className="block font-semibold">{c.label}</span>
                <span className={cn("block", s.category === c.key ? "text-white/75" : "text-[var(--color-ink-muted)]")}>{c.help}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Telefoon</label><input className={inputCls} value={s.phone} onChange={(e) => up("phone", e.target.value)} placeholder="06 12345678" /></div>
          <div><label className={labelCls}>WhatsApp (als afwijkend)</label><input className={inputCls} value={s.whatsapp} onChange={(e) => up("whatsapp", e.target.value)} placeholder="Leeg = zelfde nummer" /></div>
        </div>
        <div><label className={labelCls}>E-mailadres</label><input className={inputCls} type="email" value={s.email} onChange={(e) => up("email", e.target.value)} /></div>
        <div>
          <label className={labelCls}>Portfolio of website</label>
          <input className={inputCls} value={s.portfolioUrl} onChange={(e) => up("portfolioUrl", e.target.value)} placeholder="https://…" />
          {s.links.length ? (
            <ul className="mt-2 space-y-1">
              {s.links.map((l) => (
                <li key={l.url} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{l.label} · {l.url}</span>
                  <button type="button" onClick={() => up("links", s.links.filter((x) => x.url !== l.url))} className="text-[var(--color-ink-muted)]"><X className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex gap-2">
            <input className={inputCls} value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="Extra voorbeeld toevoegen (Vimeo, Drive, Instagram…)" />
            <Button type="button" variant="secondary" disabled={!newLink.trim()} onClick={() => { const url = newLink.trim(); up("links", [...s.links, { url, label: labelForUrl(/^https?:/.test(url) ? url : `https://${url}`) }]); setNewLink(""); }}>Toevoegen</Button>
          </div>
        </div>
        <div>
          <label className={labelCls}>Specialisaties</label>
          <div className="flex flex-wrap gap-1.5">
            {specs.map((v) => (
              <button key={v} type="button" onClick={() => toggleSpec(v)}
                className={cn("rounded-full px-2.5 py-1 text-xs font-medium", s.specialisations.includes(v) ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink)]")}>
                {v}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className={inputCls} value={newSpec} onChange={(e) => setNewSpec(e.target.value)} placeholder="Eigen specialisatie" />
            <Button type="button" variant="secondary" disabled={!newSpec.trim()} onClick={() => { toggleSpec(newSpec.trim()); setNewSpec(""); }}>Toevoegen</Button>
          </div>
        </div>
        <div>
          <label className={labelCls}>Eerdere samenwerking met Shortclips</label>
          <select className={inputCls} value={s.workedWithUs} onChange={(e) => up("workedWithUs", e.target.value)}>
            {WORKED_WITH_US.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
          <textarea className={cn(inputCls, "mt-2 h-20 py-2")} value={s.collaborationNote} onChange={(e) => up("collaborationNote", e.target.value)} placeholder="Voor welke klanten, wanneer, hoe ging het?" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Tarief per video (€, ex btw)</label><input className={inputCls} inputMode="numeric" value={s.ratePerVideo} onChange={(e) => up("ratePerVideo", e.target.value)} placeholder="Alleen als bekend" /></div>
          <div><label className={labelCls}>Toelichting tarief</label><input className={inputCls} value={s.rateNote} onChange={(e) => up("rateNote", e.target.value)} placeholder="Bijv. premium edits € 75" /></div>
        </div>
        <div>
          <label className={labelCls}>Beschikbaarheid (alleen invullen als net bevestigd)</label>
          <div className="grid grid-cols-2 gap-3">
            <select className={inputCls} value={s.availability} onChange={(e) => up("availability", e.target.value)}>
              {AVAILABILITY.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <input className={inputCls} value={s.availabilityNote} onChange={(e) => up("availabilityNote", e.target.value)} placeholder="Toelichting" />
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">Bij opslaan wordt vandaag vastgelegd als bevestigingsdatum.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Kwaliteit</label><Stars value={s.ratingQuality} onChange={(v) => up("ratingQuality", v)} label="Kwaliteit" /></div>
          <div><label className={labelCls}>Samenwerking</label><Stars value={s.ratingCollaboration} onChange={(v) => up("ratingCollaboration", v)} label="Samenwerking" /></div>
        </div>
      </div>
      <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-[var(--color-line)] bg-[var(--color-canvas,#fff)] py-3">
        <Button disabled={pending || !s.fullName.trim()} onClick={save}>{pending ? "Opslaan…" : profile ? "Wijzigingen opslaan" : "Editor toevoegen"}</Button>
        <Button variant="ghost" onClick={onClose}>Annuleren</Button>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

type Row = ImportCandidate & { key: string; include: boolean; dup: string | null };

function ImportDialog({ profiles, onClose }: { profiles: EditorProfile[]; onClose: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [category, setCategory] = useState("potentieel");
  const [fromWhatsapp, setFromWhatsapp] = useState(true);
  const [label, setLabel] = useState("WhatsApp Business · label Editing - Shortclips");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const analyse = (input: string) => {
    const parsed = parseImport(input);
    const seen: { id: string; fullName: string; phone: string | null; whatsapp: string | null; email: string | null }[] = [];
    setRows(parsed.map((c, i) => {
      const existing = findDuplicate(c, profiles);
      const inBatch = existing ? null : findDuplicate(c, seen);
      seen.push({ id: `b${i}`, fullName: c.fullName, phone: c.phone, whatsapp: null, email: c.email });
      return { ...c, key: `r${i}`, include: !inBatch, dup: existing ? `Bestaat al: ${existing.match.fullName} (zelfde ${existing.reason}), alleen lege velden aanvullen` : inBatch ? "Dubbel in dit bestand" : null };
    }));
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const parts = await Promise.all([...files].map((f) => f.text()));
    const all = parts.join("\n");
    setText(all);
    setFromWhatsapp(/BEGIN:VCARD/i.test(all) || fromWhatsapp);
    analyse(all);
  };

  const submit = () =>
    start(async () => {
      setErr(null);
      const candidates = (rows ?? []).filter((r) => r.include).map((r): ImportCandidate => ({ fullName: r.fullName, phone: r.phone, email: r.email, portfolioUrl: r.portfolioUrl, links: r.links, specialisations: r.specialisations, ratePerVideo: r.ratePerVideo, note: r.note }));
      const r = await importEditors({ candidates, category, sourceLabel: label, source: fromWhatsapp ? "whatsapp_export" : "csv_import" });
      if (!r.ok) { setErr(r.message); return; }
      setResult(`${r.created} nieuwe editors toegevoegd, ${r.enriched} bestaande profielen aangevuld, ${r.skipped} overgeslagen.`);
      router.refresh();
    });

  const included = rows?.filter((r) => r.include).length ?? 0;

  return (
    <Drawer onClose={onClose} title={<h2 className="text-lg font-semibold text-[var(--color-ink)]">Contacten importeren</h2>}>
      {result ? (
        <div className="space-y-3">
          <p className="rounded-[var(--radius-sm)] bg-[var(--color-good-soft)] px-3 py-2 text-sm text-[#1d6b4c]">{result}</p>
          <p className="text-sm text-[var(--color-ink-muted)]">Geïmporteerde gegevens staan als &quot;te controleren&quot; tot iemand het profiel bevestigt of aanpast. Beschikbaarheid is bewust leeg gelaten.</p>
          <Button onClick={onClose}>Sluiten</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-xs leading-relaxed text-[var(--color-ink-muted)]">
            <p className="mb-1 font-semibold text-[var(--color-ink)]">Zo haal je de editors uit WhatsApp Business</p>
            <p>1. Open WhatsApp Business op de telefoon, ga naar Chats en filter op het label <strong>Editing - Shortclips</strong>.</p>
            <p>2. Open per chat de contactinfo en kies <strong>Contact delen</strong>. Stuur de contactkaart (.vcf) naar jezelf, bijvoorbeeld via mail of AirDrop. Meerdere kaarten tegelijk kan ook.</p>
            <p>3. Upload de .vcf-bestanden hieronder. Een Excel- of CSV-lijst (naam, telefoon, e-mail, portfolio) of geplakte tekst werkt ook.</p>
            <p className="mt-1">Er wordt niets in WhatsApp gewijzigd of verstuurd. Dubbele contacten worden herkend op nummer, e-mail en volledige naam.</p>
          </div>

          <div>
            <label className={labelCls}>Bestanden (.vcf of .csv)</label>
            <input type="file" multiple accept=".vcf,.vcard,.csv,.txt,text/vcard,text/csv" onChange={(e) => onFiles(e.target.files)} className="text-sm" />
          </div>
          <div>
            <label className={labelCls}>Of plak contactgegevens</label>
            <textarea className={cn(inputCls, "h-28 py-2 font-mono text-xs")} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={"naam;telefoon;e-mail;portfolio\nVoorbeeld Naam;06 12345678;naam@voorbeeld.nl;https://vimeo.com/…"} />
            <Button variant="secondary" size="sm" className="mt-2" disabled={!text.trim()} onClick={() => analyse(text)}>Controleren</Button>
          </div>

          {rows ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Categorie voor nieuwe editors</label>
                  <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {EDITOR_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Bron</label>
                  <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                <input type="checkbox" checked={fromWhatsapp} onChange={(e) => setFromWhatsapp(e.target.checked)} /> Afkomstig uit WhatsApp Business
              </label>
              <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-line)]">
                {rows.length === 0 ? <p className="p-3 text-sm text-[var(--color-ink-muted)]">Geen contacten herkend.</p> : (
                  <ul className="divide-y divide-[var(--color-line)]">
                    {rows.map((r) => (
                      <li key={r.key} className="flex items-start gap-2 px-3 py-2 text-sm">
                        <input type="checkbox" className="mt-1" checked={r.include} onChange={(e) => setRows((rs) => rs!.map((x) => (x.key === r.key ? { ...x, include: e.target.checked } : x)))} />
                        <div className="min-w-0">
                          <p className="font-medium text-[var(--color-ink)]">{r.fullName}</p>
                          <p className="text-xs text-[var(--color-ink-muted)]">
                            {[r.phone ? formatPhone(r.phone) : null, r.email, r.portfolioUrl].filter(Boolean).join(" · ") || "Geen contactgegevens"}
                          </p>
                          {r.dup ? <p className="text-xs text-[#8a5300]">{r.dup}</p> : <p className="text-xs text-[#1d6b4c]">Nieuw profiel</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {err ? <p className="text-sm text-[#a3271c]">{err}</p> : null}
              <div className="flex gap-2">
                <Button disabled={pending || included === 0} onClick={submit}>{pending ? "Importeren…" : `${included} contacten importeren`}</Button>
                <Button variant="ghost" onClick={onClose}>Annuleren</Button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
