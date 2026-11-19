"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, ExternalLink, History, Mail, MapPin, MessageCircle, Phone, Plus, Search, X } from "lucide-react";
import { Badge, Button, PageHeader, type Tone } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  AVAILABILITY, EMPTY_FILTERS, PROFILE_FIELDS, REGIONS, SPECIALISATIONS, VIDEOGRAPHER_STATUSES,
  formatPhone, initials, labelForUrl, matchesFilters, sortProfiles, whatsappUrl,
  type VideographerFilters, type VideographerLink,
} from "@/lib/freelance-videographers";
import type { VideographerHistoryItem, VideographerProfile } from "@/server/freelance-videographers";
import {
  addVideographerNote, archiveVideographer, confirmVideographerAvailability, createVideographer,
  setVideographerStatus, updateVideographer,
} from "@/server/actions/freelance-videographers";

/* ------------------------------------------------------------------ *
 * Hulpjes
 * ------------------------------------------------------------------ */

const STATUS_TONE: Record<string, Tone> = { geselecteerd: "good", beschikbaar: "info", in_gesprek: "warn", niet_actief: "neutral" };
const statusLabel = (k: string) => VIDEOGRAPHER_STATUSES.find((s) => s.key === k)?.label ?? k;
const avLabel = (k: string) => AVAILABILITY.find((a) => a.key === k)?.label ?? k;
const FIELD_LABEL: Record<string, string> = {
  fullName: "naam", photo: "foto", city: "woonplaats", regions: "werkregio", phone: "telefoon", whatsapp: "WhatsApp", email: "e-mail",
  portfolioUrl: "portfolio", links: "links", specialisations: "specialisaties", status: "status", dayRate: "dagprijs", hourlyRate: "uurtarief",
  rateNote: "toelichting tarief", availability: "beschikbaarheid", availabilityNote: "toelichting beschikbaarheid", collaborationNote: "eerder werk", notes: "opmerking",
};
const ACTION_LABEL: Record<string, string> = {
  "freelance_videographers.create": "Aangemaakt", "freelance_videographers.update": "Gewijzigd", "freelance_videographers.status": "Status gewijzigd",
  "freelance_videographers.availability": "Beschikbaarheid bevestigd", "freelance_videographers.note": "Opmerking toegevoegd", "freelance_videographers.archive": "Gearchiveerd",
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

const where = (p: Pick<VideographerProfile, "city" | "regions">) => [p.city, ...p.regions].filter(Boolean).join(" · ");
const rateText = (p: Pick<VideographerProfile, "dayRate" | "hourlyRate">) =>
  [p.dayRate != null ? `€ ${p.dayRate} per dag` : null, p.hourlyRate != null ? `€ ${p.hourlyRate} per uur` : null].filter(Boolean).join(" · ");

function Avatar({ p, size = 44 }: { p: Pick<VideographerProfile, "fullName" | "photo">; size?: number }) {
  return p.photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={p.photo} alt={p.fullName} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--color-indigo-ink)] text-sm font-semibold text-white" aria-hidden>
      {initials(p.fullName)}
    </span>
  );
}

function AvailabilityLine({ p, compact }: { p: VideographerProfile; compact?: boolean }) {
  if (p.availabilityStatus === "onbekend") return <span className="text-[var(--color-ink-muted)]">Beschikbaarheid onbekend</span>;
  if (p.availabilityStatus === "verouderd") {
    return <span className="text-[#8a5300]">Niet recent bevestigd · laatst {avLabel(p.availability).toLowerCase()} op {fmtDate(p.availabilityConfirmedAt)}</span>;
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

export function FreelanceVideographers({
  profiles, history, initialOpenId,
}: {
  profiles: VideographerProfile[];
  history: Record<string, VideographerHistoryItem[]>;
  initialOpenId: string | null;
}) {
  const [f, setF] = useState<VideographerFilters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [creating, setCreating] = useState(false);
  const set = <K extends keyof VideographerFilters>(k: K, v: VideographerFilters[K]) => setF((s) => ({ ...s, [k]: v }));

  const specOptions = useMemo(() => {
    const all = new Set<string>(SPECIALISATIONS);
    profiles.forEach((p) => p.specialisations.forEach((s) => all.add(s)));
    return [...all];
  }, [profiles]);

  const regionOptions = useMemo(() => {
    const all = new Set<string>(REGIONS);
    profiles.forEach((p) => p.regions.forEach((r) => all.add(r)));
    return [...all];
  }, [profiles]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { alle: profiles.length };
    VIDEOGRAPHER_STATUSES.forEach((k) => (c[k.key] = profiles.filter((p) => p.status === k.key).length));
    return c;
  }, [profiles]);

  const list = useMemo(() => sortProfiles(profiles.filter((p) => matchesFilters(p, f))), [profiles, f]);
  const open = profiles.find((p) => p.id === openId) ?? null;
  const filtersActive = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <>
      <PageHeader
        title="Freelance videografen"
        description={`${profiles.length} freelancers · wie we kunnen inschakelen voor opnames · alleen zichtbaar voor het interne team`}
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> Freelancer toevoegen</Button>}
      />

      {/* Status */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[{ key: "alle", label: "Alle", help: "" }, ...VIDEOGRAPHER_STATUSES].map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.help}
            onClick={() => set("status", c.key)}
            className={cn("rounded-full px-3 py-1 text-xs font-semibold", f.status === c.key ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-surface)] text-[var(--color-ink-muted)] ring-1 ring-[var(--color-line)] hover:text-[var(--color-ink)]")}
          >
            {c.label} <span className="tabular-nums opacity-70">{counts[c.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Zoeken en filteren */}
      <div className="mb-4 grid grid-cols-1 gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="relative sm:col-span-2 lg:col-span-2">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--color-ink-faint)]" />
          <input className={cn(inputCls, "pl-8")} placeholder="Zoek op naam, woonplaats, specialisatie…" value={f.q} onChange={(e) => set("q", e.target.value)} aria-label="Zoeken" />
        </label>
        <select className={inputCls} value={f.region} onChange={(e) => set("region", e.target.value)} aria-label="Werkregio">
          <option value="">Alle regio&apos;s</option>
          {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className={inputCls} value={f.spec} onChange={(e) => set("spec", e.target.value)} aria-label="Specialisatie">
          <option value="">Alle specialisaties</option>
          {specOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <select className={inputCls} value={f.av} onChange={(e) => set("av", e.target.value)} aria-label="Beschikbaarheid">
            <option value="">Elke beschikbaarheid</option>
            <option value="beschikbaar">Bevestigd beschikbaar</option>
            <option value="inzetbaar">Beschikbaar of beperkt</option>
            <option value="niet_bevestigd">Niet (recent) bevestigd</option>
          </select>
          {filtersActive ? <button type="button" onClick={() => setF(EMPTY_FILTERS)} className="shrink-0 text-xs font-medium text-[var(--color-ink-muted)] underline">Wissen</button> : null}
        </div>
      </div>

      {profiles.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
          Nog geen freelance videografen. Voeg de eerste toe met &quot;Freelancer toevoegen&quot;.
        </p>
      ) : list.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
          Geen freelancers gevonden met deze filters.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => <VideographerCard key={p.id} p={p} onOpen={() => setOpenId(p.id)} />)}
        </div>
      )}

      {open ? <ProfilePanel key={open.id} p={open} history={history[open.id] ?? []} onClose={() => setOpenId(null)} /> : null}
      {creating ? <ProfileForm onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Kaart
 * ------------------------------------------------------------------ */

function WhatsAppButton({ p, className }: { p: Pick<VideographerProfile, "whatsapp" | "phone">; className?: string }) {
  const wa = whatsappUrl(p.whatsapp, p.phone);
  if (!wa) return <span className="inline-flex h-8 items-center rounded-[var(--radius-sm)] px-2 text-xs text-[var(--color-ink-faint)]">Geen nummer</span>;
  return (
    <a href={wa} target="_blank" rel="noopener noreferrer" className={cn(WA_BTN, className)} title="Opent WhatsApp met dit nummer, er wordt niets automatisch verstuurd">
      <MessageCircle className="size-4" /> Stuur WhatsApp
    </a>
  );
}

function VideographerCard({ p, onOpen }: { p: VideographerProfile; onOpen: () => void }) {
  const portfolio = p.portfolioUrl ?? p.links[0]?.url ?? null;
  const rate = rateText(p);
  return (
    <div className="flex flex-col rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)]">
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-3 text-left">
        <Avatar p={p} size={48} />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold text-[var(--color-ink)] hover:underline">{p.fullName}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{statusLabel(p.status)}</Badge>
          </span>
        </span>
      </button>

      <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-[var(--color-ink-muted)]">Regio</dt>
        <dd className="text-[var(--color-ink)]">{where(p) || <span className="text-[var(--color-ink-faint)]">Nog aanvullen</span>}</dd>
        <dt className="text-[var(--color-ink-muted)]">Beschikbaar</dt>
        <dd><AvailabilityLine p={p} compact /></dd>
        <dt className="text-[var(--color-ink-muted)]">Tarief</dt>
        <dd className="font-medium text-[var(--color-ink)]">{rate || <span className="font-normal text-[var(--color-ink-faint)]">Nog aanvullen</span>}</dd>
        <dt className="text-[var(--color-ink-muted)]">Bij ons</dt>
        <dd className="text-[var(--color-ink)]">
          {p.stats ? `${p.stats.past} opnames${p.stats.lastWorkOn ? ` · laatst ${fmtDate(p.stats.lastWorkOn)}` : ""}${p.stats.nextWorkOn ? ` · volgende ${fmtDate(p.stats.nextWorkOn)}` : ""}` : <span className="text-[var(--color-ink-faint)]">Geen opnames in het portaal</span>}
        </dd>
      </dl>

      {p.specialisations.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {p.specialisations.slice(0, 4).map((s) => <span key={s} className="rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink)]">{s}</span>)}
          {p.specialisations.length > 4 ? <span className="px-1 text-[11px] text-[var(--color-ink-muted)]">+{p.specialisations.length - 4}</span> : null}
        </div>
      ) : null}

      {p.missing.length ? (
        <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">Nog aanvullen: {p.missing.map((m) => PROFILE_FIELDS.find((x) => x.key === m)?.label.toLowerCase()).join(", ")}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <WhatsAppButton p={p} className="h-9 text-xs" />
        {portfolio ? (
          <a href={portfolio} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]">
            <ExternalLink className="size-3.5" /> Portfolio
          </a>
        ) : null}
        <button type="button" onClick={onOpen} className="ml-auto h-9 rounded-[var(--radius-sm)] px-3 text-xs font-semibold text-[var(--color-indigo-ink)] hover:bg-[var(--color-surface-sunken)]">
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
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-4 sm:px-5">
          <div className="min-w-0">{title}</div>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]" aria-label="Sluiten"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-ink-muted)]">{title}</h3>
      {children}
    </section>
  );
}

function Missing() {
  return <span className="text-[var(--color-ink-faint)]">Nog aanvullen</span>;
}

function ProfilePanel({ p, history, onClose }: { p: VideographerProfile; history: VideographerHistoryItem[]; onClose: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [avNote, setAvNote] = useState(p.availabilityNote ?? "");
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, done?: () => void) =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (!r.ok) setMsg(r.message ?? "Er ging iets mis.");
      else { done?.(); router.refresh(); }
    });

  if (editing) return <ProfileForm profile={p} onClose={() => setEditing(false)} onCreated={() => setEditing(false)} />;

  const allLinks: VideographerLink[] = [...(p.portfolioUrl ? [{ url: p.portfolioUrl, label: `Portfolio · ${labelForUrl(p.portfolioUrl)}` }] : []), ...p.links];
  const rate = rateText(p);

  return (
    <Drawer
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          <Avatar p={p} size={48} />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-[var(--color-ink)]">{p.fullName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
              <select
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 text-xs font-semibold text-[var(--color-ink)]"
                value={p.status}
                disabled={pending}
                onChange={(e) => act(() => setVideographerStatus(p.id, e.target.value))}
                aria-label="Status"
              >
                {VIDEOGRAPHER_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <span>Bijgewerkt {fmtDate(p.updatedAt, true)}{p.updatedBy ? ` door ${p.updatedBy.split(" ")[0]}` : ""}</span>
            </div>
          </div>
        </div>
      }
    >
      {msg ? <p className="mb-3 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[#a3271c]">{msg}</p> : null}

      <div className="mb-2 flex flex-wrap gap-2">
        <WhatsAppButton p={p} className="h-10 text-sm" />
        <Button variant="secondary" onClick={() => setEditing(true)}>Gegevens bewerken</Button>
        {p.status !== "niet_actief" ? (
          <Button variant="ghost" disabled={pending} onClick={() => act(() => setVideographerStatus(p.id, "niet_actief"))}>Op niet actief zetten</Button>
        ) : null}
      </div>
      <p className="mb-5 text-[11px] text-[var(--color-ink-faint)]">WhatsApp opent alleen het gesprek; er wordt niets automatisch verstuurd.</p>

      <Section title="Beschikbaarheid">
        <p className="text-sm"><AvailabilityLine p={p} /></p>
        {p.availabilityNote ? <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{p.availabilityNote}</p> : null}
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Net contact gehad? Leg vast wat de freelancer zei. Eerder voor ons gewerkt hebben betekent niet dat iemand nu beschikbaar is.</p>
        <input className={cn(inputCls, "mt-2")} placeholder="Toelichting, bijvoorbeeld: alleen op dinsdag en woensdag" value={avNote} onChange={(e) => setAvNote(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {AVAILABILITY.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={pending}
              onClick={() => act(() => confirmVideographerAvailability(p.id, a.key, avNote))}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"
            >
              {a.key === "onbekend" ? "Onbekend" : `${a.label} (vandaag)`}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Contact">
        <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
          <dt className="text-[var(--color-ink-muted)]">Telefoon</dt>
          <dd>{p.phone ? <a className="inline-flex items-center gap-1 hover:underline" href={`tel:${p.phone}`}><Phone className="size-3.5" />{formatPhone(p.phone)}</a> : <Missing />}</dd>
          <dt className="text-[var(--color-ink-muted)]">WhatsApp</dt>
          <dd>{p.whatsapp ? formatPhone(p.whatsapp) : p.phone ? <span className="text-[var(--color-ink-muted)]">Zelfde nummer</span> : <Missing />}</dd>
          <dt className="text-[var(--color-ink-muted)]">E-mail</dt>
          <dd className="break-all">{p.email ? <a className="inline-flex items-center gap-1 hover:underline" href={`mailto:${p.email}`}><Mail className="size-3.5" />{p.email}</a> : <Missing />}</dd>
          <dt className="text-[var(--color-ink-muted)]">Woonplaats</dt>
          <dd>{p.city ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{p.city}</span> : <Missing />}</dd>
          <dt className="text-[var(--color-ink-muted)]">Werkregio</dt>
          <dd>{p.regions.length ? p.regions.join(", ") : <Missing />}</dd>
        </dl>
      </Section>

      <Section title="Portfolio en eerdere video's">
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
          <dd>{p.specialisations.length ? p.specialisations.join(", ") : <Missing />}</dd>
          <dt className="text-[var(--color-ink-muted)]">Tarief (ex btw)</dt>
          <dd>
            {rate || <Missing />}
            {p.rateNote ? <span className="block text-xs text-[var(--color-ink-muted)]">{p.rateNote}</span> : null}
          </dd>
        </dl>
      </Section>

      <Section title="Samenwerking met Shortclips">
        {p.stats ? (
          <p className="text-sm text-[var(--color-ink-muted)]">
            Uit het portaal: {p.stats.past} opnames voor {p.stats.clients} klanten{p.stats.lastWorkOn ? `, laatst ${fmtDate(p.stats.lastWorkOn)}` : ""}{p.stats.nextWorkOn ? `, volgende ${fmtDate(p.stats.nextWorkOn)}` : ""}.
            {p.stats.recentClients.length ? ` O.a. ${p.stats.recentClients.join(", ")}.` : ""}
          </p>
        ) : <p className="text-sm text-[var(--color-ink-muted)]">{p.linkedUser ? "Nog geen opnames in het portaal." : "Niet gekoppeld aan een portaalaccount."}</p>}
        {p.collaborationNote ? <p className="mt-1 whitespace-pre-line text-sm">{p.collaborationNote}</p> : null}
      </Section>

      <Section title="Interne opmerkingen">
        <div className="flex gap-2">
          <input className={inputCls} placeholder="Opmerking toevoegen…" value={note} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && note.trim()) act(() => addVideographerNote(p.id, note), () => setNote("")); }} />
          <Button size="md" disabled={pending || !note.trim()} onClick={() => act(() => addVideographerNote(p.id, note), () => setNote(""))}>Toevoegen</Button>
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
                  {h.action === "freelance_videographers.update" && h.fields.length ? `: ${h.fields.map((x) => FIELD_LABEL[x] ?? x).join(", ")}` : ""} · {fmtDate(h.at, true)}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-[var(--color-ink-faint)]">{p.source === "portaal" ? "Automatisch aangemaakt vanuit het bestaande videograafaccount." : "Nog geen wijzigingen vastgelegd."}</p>}
        {p.sourceLabel ? <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">Bron: {p.sourceLabel}</p> : null}
      </Section>

      <div className="border-t border-[var(--color-line)] pt-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => { if (window.confirm(`${p.fullName} archiveren? Het profiel verdwijnt uit het overzicht maar blijft herleidbaar. Wil je iemand alleen niet inzetten, zet dan de status op Niet actief.`)) act(() => archiveVideographer(p.id), onClose); }}
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

/** Verkleint een foto in de browser tot een vierkante avatar (jpeg), zodat er weinig data wordt opgeslagen. */
async function resizeToAvatar(file: File, size = 256): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Geen canvas beschikbaar");
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

function ProfileForm({ profile, onClose, onCreated }: { profile?: VideographerProfile; onClose: () => void; onCreated: (id: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [s, setS] = useState({
    fullName: profile?.fullName ?? "",
    photo: profile?.photo ?? (null as string | null),
    city: profile?.city ?? "",
    regions: profile?.regions ?? ([] as string[]),
    phone: profile?.phone ?? "",
    whatsapp: profile?.whatsapp ?? "",
    email: profile?.email ?? "",
    portfolioUrl: profile?.portfolioUrl ?? "",
    links: profile?.links ?? ([] as VideographerLink[]),
    specialisations: profile?.specialisations ?? ([] as string[]),
    status: profile?.status ?? "in_gesprek",
    availability: profile?.availability ?? "onbekend",
    availabilityNote: profile?.availabilityNote ?? "",
    dayRate: profile?.dayRate != null ? String(profile.dayRate) : "",
    hourlyRate: profile?.hourlyRate != null ? String(profile.hourlyRate) : "",
    rateNote: profile?.rateNote ?? "",
    collaborationNote: profile?.collaborationNote ?? "",
  });
  const [newSpec, setNewSpec] = useState("");
  const [newRegion, setNewRegion] = useState("");
  const [newLink, setNewLink] = useState("");
  const up = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((x) => ({ ...x, [k]: v }));
  const toggle = (k: "specialisations" | "regions", v: string) => up(k, s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v]);
  const specs = Array.from(new Set([...SPECIALISATIONS, ...s.specialisations]));
  const regions = Array.from(new Set([...REGIONS, ...s.regions]));

  const onPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setErr(null);
    try {
      up("photo", await resizeToAvatar(file));
    } catch {
      setErr("Deze foto kon niet worden gelezen. Kies een jpeg-, png- of webp-bestand.");
    }
  };

  const save = () =>
    start(async () => {
      setErr(null);
      const r = profile ? await updateVideographer(profile.id, s) : await createVideographer(s);
      if (!r.ok) { setErr(r.message); return; }
      router.refresh();
      onCreated(profile ? profile.id : (r as unknown as { id: string }).id);
    });

  return (
    <Drawer onClose={onClose} title={<h2 className="text-lg font-semibold text-[var(--color-ink)]">{profile ? `${profile.fullName} bewerken` : "Freelancer toevoegen"}</h2>}>
      {err ? <p className="mb-3 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[#a3271c]">{err}</p> : null}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar p={{ fullName: s.fullName || "?", photo: s.photo }} size={64} />
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onPhoto(e.target.files)} />
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}><Camera className="size-4" /> {s.photo ? "Andere foto" : "Foto toevoegen"}</Button>
            {s.photo ? <Button type="button" variant="ghost" onClick={() => up("photo", null)}>Foto verwijderen</Button> : null}
          </div>
        </div>
        <div>
          <label className={labelCls}>Volledige naam *</label>
          <input className={inputCls} value={s.fullName} onChange={(e) => up("fullName", e.target.value)} autoFocus />
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {VIDEOGRAPHER_STATUSES.map((c) => (
              <button key={c.key} type="button" onClick={() => up("status", c.key)}
                className={cn("rounded-[var(--radius-sm)] border px-3 py-2 text-left text-xs", s.status === c.key ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line-strong)] text-[var(--color-ink)]")}>
                <span className="block font-semibold">{c.label}</span>
                <span className={cn("block", s.status === c.key ? "text-white/75" : "text-[var(--color-ink-muted)]")}>{c.help}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={labelCls}>Telefoon</label><input className={inputCls} inputMode="tel" value={s.phone} onChange={(e) => up("phone", e.target.value)} placeholder="06 12345678" /></div>
          <div><label className={labelCls}>WhatsApp (als afwijkend)</label><input className={inputCls} inputMode="tel" value={s.whatsapp} onChange={(e) => up("whatsapp", e.target.value)} placeholder="Leeg = zelfde nummer" /></div>
        </div>
        <div><label className={labelCls}>E-mailadres</label><input className={inputCls} type="email" value={s.email} onChange={(e) => up("email", e.target.value)} /></div>
        <div><label className={labelCls}>Woonplaats</label><input className={inputCls} value={s.city} onChange={(e) => up("city", e.target.value)} /></div>
        <div>
          <label className={labelCls}>Werkregio</label>
          <div className="flex flex-wrap gap-1.5">
            {regions.map((v) => (
              <button key={v} type="button" onClick={() => toggle("regions", v)}
                className={cn("rounded-full px-2.5 py-1 text-xs font-medium", s.regions.includes(v) ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink)]")}>
                {v}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className={inputCls} value={newRegion} onChange={(e) => setNewRegion(e.target.value)} placeholder="Eigen regio" />
            <Button type="button" variant="secondary" disabled={!newRegion.trim()} onClick={() => { toggle("regions", newRegion.trim()); setNewRegion(""); }}>Toevoegen</Button>
          </div>
        </div>
        <div>
          <label className={labelCls}>Portfolio of website</label>
          <input className={inputCls} value={s.portfolioUrl} onChange={(e) => up("portfolioUrl", e.target.value)} placeholder="https://…" />
          {s.links.length ? (
            <ul className="mt-2 space-y-1">
              {s.links.map((l) => (
                <li key={l.url} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">{l.label} · {l.url}</span>
                  <button type="button" onClick={() => up("links", s.links.filter((x) => x.url !== l.url))} className="text-[var(--color-ink-muted)]" aria-label="Link verwijderen"><X className="size-3.5" /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex gap-2">
            <input className={inputCls} value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="Eerdere video toevoegen (Vimeo, Instagram, YouTube…)" />
            <Button type="button" variant="secondary" disabled={!newLink.trim()} onClick={() => { const url = newLink.trim(); up("links", [...s.links, { url, label: labelForUrl(/^https?:/.test(url) ? url : `https://${url}`) }]); setNewLink(""); }}>Toevoegen</Button>
          </div>
        </div>
        <div>
          <label className={labelCls}>Specialisaties</label>
          <div className="flex flex-wrap gap-1.5">
            {specs.map((v) => (
              <button key={v} type="button" onClick={() => toggle("specialisations", v)}
                className={cn("rounded-full px-2.5 py-1 text-xs font-medium", s.specialisations.includes(v) ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-sunken)] text-[var(--color-ink)]")}>
                {v}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input className={inputCls} value={newSpec} onChange={(e) => setNewSpec(e.target.value)} placeholder="Eigen specialisatie" />
            <Button type="button" variant="secondary" disabled={!newSpec.trim()} onClick={() => { toggle("specialisations", newSpec.trim()); setNewSpec(""); }}>Toevoegen</Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={labelCls}>Dagprijs (€, ex btw)</label><input className={inputCls} inputMode="numeric" value={s.dayRate} onChange={(e) => up("dayRate", e.target.value)} placeholder="Alleen als bekend" /></div>
          <div><label className={labelCls}>Uurtarief (€, ex btw)</label><input className={inputCls} inputMode="numeric" value={s.hourlyRate} onChange={(e) => up("hourlyRate", e.target.value)} placeholder="Alleen als bekend" /></div>
        </div>
        <div><label className={labelCls}>Toelichting tarief</label><input className={inputCls} value={s.rateNote} onChange={(e) => up("rateNote", e.target.value)} placeholder="Bijv. inclusief montage, reiskosten apart" /></div>
        <div>
          <label className={labelCls}>Beschikbaarheid (alleen invullen als net bevestigd)</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select className={inputCls} value={s.availability} onChange={(e) => up("availability", e.target.value as typeof s.availability)}>
              {AVAILABILITY.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <input className={inputCls} value={s.availabilityNote} onChange={(e) => up("availabilityNote", e.target.value)} placeholder="Toelichting" />
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">Bij opslaan wordt vandaag vastgelegd als bevestigingsdatum.</p>
        </div>
        <div>
          <label className={labelCls}>Eerder werk voor Shortclips</label>
          <textarea className={cn(inputCls, "h-20 py-2")} value={s.collaborationNote} onChange={(e) => up("collaborationNote", e.target.value)} placeholder="Voor welke klanten, wanneer, hoe ging het?" />
        </div>
      </div>
      <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-[var(--color-line)] bg-[var(--color-canvas,#fff)] py-3">
        <Button disabled={pending || !s.fullName.trim()} onClick={save}>{pending ? "Opslaan…" : profile ? "Wijzigingen opslaan" : "Freelancer toevoegen"}</Button>
        <Button variant="ghost" onClick={onClose}>Annuleren</Button>
      </div>
    </Drawer>
  );
}
