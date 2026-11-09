"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Upload } from "lucide-react";
import {
  createClient,
  deleteClient,
  setClientStatus,
  updateClient,
  type ClientInput,
} from "@/server/actions/clients";
import { Button, ErrorNote, InfoNote } from "@/components/ui";
import { CLIENT_STATUS } from "@/lib/statuses";

type UserOption = { id: string; fullName: string; primaryRole: string };

export type ClientDraft = {
  name: string;
  sector: string;
  website: string;
  legalName: string;
  logoUrl: string;
  description: string;
  color: string;
  status: string;
  coordinatorId: string;
  videographerId: string;
  monthlyVideoQuota: string;
  contentFocus: string;
  monthlyRevenue: string;
  startedOn: string;
  notes: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** "ja" = Shortclips plaatst, "nee" = klant plaatst zelf. */
  weHandlePosting: string;
  contractMonths: string;
};
type Draft = ClientDraft;

const STATUS_OPTIONS = ["active", "onboarding", "paused", "churned", "prospect"] as const;

/** Pakketten = soort content. Namen gelijk aan de offertesjablonen. */
const PACKAGES = [
  { value: "organisch", label: "Organische shorts", shorts: 8 },
  { value: "advertentie", label: "Advertentie creatives", shorts: 6 },
  { value: "beide", label: "Organisch + advertenties", shorts: 12 },
] as const;
const SHORTS_OPTIONS = [4, 6, 8, 12, 16];
const DURATION_OPTIONS = [3, 6, 12];
const DEFAULT_SECTORS = ["Bouw", "Installatie & techniek", "Interieur", "Automotive", "Makelaardij", "Zakelijke dienstverlening", "Recreatie", "Retail"];
const COORDINATOR_ROLES = ["owner", "admin", "operational_manager", "project_coordinator", "content_creator"];
const VIDEOGRAPHER_ROLES = ["videographer", "content_creator", "owner", "admin"];
/** Algemene mailproviders: daaruit leiden we geen website af. */
const GENERIC_MAIL = ["gmail.com", "hotmail.com", "outlook.com", "live.nl", "live.com", "icloud.com", "me.com", "yahoo.com", "kpnmail.nl", "ziggo.nl", "home.nl", "hotmail.nl", "planet.nl", "xs4all.nl", "msn.com"];
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

function contractEnd(startedOn: string, months: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startedOn) || !months) return null;
  const [y, m, d] = startedOn.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, d) - 86400000);
  return `${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
}

function websiteFromEmail(email: string): string | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain || !domain.includes(".") || GENERIC_MAIL.includes(domain)) return null;
  return `https://www.${domain.replace(/^www\./, "")}`;
}

export function ClientForm({
  mode,
  slug,
  initial,
  users,
  sectors = [],
  canSeeFinance,
  canDelete,
}: {
  mode: "create" | "edit";
  slug?: string;
  initial: Draft;
  users: UserOption[];
  sectors?: string[];
  canSeeFinance: boolean;
  canDelete: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [shortsAuto, setShortsAuto] = useState(false);
  const [websiteAuto, setWebsiteAuto] = useState(false);
  const [customShorts, setCustomShorts] = useState(!SHORTS_OPTIONS.includes(Number(initial.monthlyVideoQuota)) && Number(initial.monthlyVideoQuota) > 0);
  const [customDuration, setCustomDuration] = useState(Boolean(initial.contractMonths) && !DURATION_OPTIONS.includes(Number(initial.contractMonths)));
  const sectorOptions = useMemo(() => {
    const list = [...sectors];
    for (const d of DEFAULT_SECTORS) if (list.length < 10 && !list.some((x) => x.toLowerCase() === d.toLowerCase())) list.push(d);
    return list.slice(0, 10);
  }, [sectors]);
  const [customSector, setCustomSector] = useState(Boolean(initial.sector) && !sectorOptions.includes(initial.sector));
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const changes = (Object.keys(initial) as (keyof Draft)[]).filter((k) => draft[k] !== initial[k]).length;
  const dirty = changes > 0;

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function pickPackage(focus: string) {
    const pkg = PACKAGES.find((p) => p.value === focus);
    const next = { ...draft, contentFocus: focus };
    // Shorts per maand alleen automatisch invullen als het nog leeg is (of al uit een pakket kwam).
    if (pkg && (!Number(draft.monthlyVideoQuota) || shortsAuto)) {
      next.monthlyVideoQuota = String(pkg.shorts);
      setShortsAuto(true);
      setCustomShorts(false);
    }
    setDraft(next);
  }

  function setEmail(email: string) {
    const next = { ...draft, contactEmail: email };
    const site = websiteFromEmail(email);
    if (site && (!draft.website || websiteAuto)) {
      next.website = site;
      setWebsiteAuto(true);
    }
    setDraft(next);
  }

  function toInput(): ClientInput {
    const months = Number(draft.contractMonths) || null;
    return {
      name: draft.name,
      sector: draft.sector,
      website: draft.website,
      legalName: draft.legalName,
      logoUrl: draft.logoUrl,
      description: draft.description,
      color: draft.color,
      status: draft.status as ClientInput["status"],
      coordinatorId: draft.coordinatorId || null,
      videographerId: draft.videographerId || null,
      monthlyVideoQuota: Number(draft.monthlyVideoQuota) || 0,
      contentFocus: draft.contentFocus || null,
      monthlyRevenue: draft.monthlyRevenue || null,
      startedOn: draft.startedOn || null,
      notes: draft.notes,
      contactName: draft.contactName,
      contactEmail: draft.contactEmail,
      contactPhone: draft.contactPhone,
      weHandlePosting: draft.weHandlePosting !== "nee",
      contractMonths: months,
      contractTouched: draft.startedOn !== initial.startedOn || draft.contractMonths !== initial.contractMonths,
      packageTouched: draft.contentFocus !== initial.contentFocus || draft.monthlyVideoQuota !== initial.monthlyVideoQuota,
    };
  }

  function save() {
    start(async () => {
      const res = mode === "create" ? await createClient(toInput()) : await updateClient(slug!, toInput());
      setResult(res);
      if (res.ok && res.slug) {
        router.push(`/clients/${res.slug}`);
        router.refresh();
      } else if (res.ok) {
        router.refresh();
      }
    });
  }

  const coordinators = users.filter((u) => COORDINATOR_ROLES.includes(u.primaryRole) || u.id === initial.coordinatorId);
  const videographers = users.filter((u) => VIDEOGRAPHER_ROLES.includes(u.primaryRole) || u.id === initial.videographerId);
  const end = contractEnd(draft.startedOn, Number(draft.contractMonths));

  return (
    <div className="space-y-5">
      {/* Status bovenaan als knoppen */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-[var(--color-ink-muted)]">Status</span>
        <div className="flex flex-wrap gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
          {STATUS_OPTIONS.map((s) => (
            <Chip key={s} on={draft.status === s} onClick={() => set("status", s)} compact>
              {CLIENT_STATUS[s]?.label ?? s}
            </Chip>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Samenwerking */}
        <Section title="Samenwerking">
          <Group label="Pakket">
            {PACKAGES.map((p) => (
              <Chip key={p.value} on={draft.contentFocus === p.value} onClick={() => pickPackage(p.value)}>{p.label}</Chip>
            ))}
          </Group>
          <Group label="Shorts per maand" tag={shortsAuto ? "uit pakket" : undefined}>
            {SHORTS_OPTIONS.map((n) => (
              <Chip key={n} on={!customShorts && Number(draft.monthlyVideoQuota) === n} onClick={() => { set("monthlyVideoQuota", String(n)); setShortsAuto(false); setCustomShorts(false); }}>{n}</Chip>
            ))}
            <Chip on={customShorts} onClick={() => { setCustomShorts(true); setShortsAuto(false); }}>Anders</Chip>
            {customShorts ? (
              <input aria-label="Aantal shorts per maand" className="sc-input h-10 w-24" type="number" min={0} value={draft.monthlyVideoQuota} onChange={(e) => set("monthlyVideoQuota", e.target.value)} />
            ) : null}
          </Group>
          <Group label="Publicatie">
            <Chip on={draft.weHandlePosting !== "nee"} onClick={() => set("weHandlePosting", "ja")}>Shortclips plaatst</Chip>
            <Chip on={draft.weHandlePosting === "nee"} onClick={() => set("weHandlePosting", "nee")}>Klant plaatst zelf</Chip>
          </Group>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label htmlFor="startedOn" className="text-sm text-[var(--color-ink-muted)]">Startdatum</label>
              <input id="startedOn" className="sc-input h-10" type="date" value={draft.startedOn} onChange={(e) => set("startedOn", e.target.value)} />
            </div>
            <Group label="Contractduur">
              {DURATION_OPTIONS.map((n) => (
                <Chip key={n} on={!customDuration && Number(draft.contractMonths) === n} onClick={() => { set("contractMonths", String(n)); setCustomDuration(false); }}>{n} mnd</Chip>
              ))}
              <Chip on={customDuration} onClick={() => setCustomDuration(true)}>Anders</Chip>
              {customDuration ? (
                <input aria-label="Contractduur in maanden" className="sc-input h-10 w-20" type="number" min={1} max={60} value={draft.contractMonths} onChange={(e) => set("contractMonths", e.target.value)} />
              ) : null}
            </Group>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] px-4 py-3">
            <span className="text-sm text-[var(--color-ink-muted)]">Contracteinde</span>
            <span className="flex items-center gap-2 text-sm font-semibold">
              {end ?? "Kies startdatum en duur"}
              {end ? <Tag>automatisch berekend</Tag> : null}
            </span>
          </div>
          {canSeeFinance ? (
            <div className="flex flex-col gap-2 border-t border-[var(--color-line)] pt-4">
              <label htmlFor="monthlyRevenue" className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                Maandbedrag (€) <Tag>alleen zichtbaar met financiële rechten</Tag>
              </label>
              <input id="monthlyRevenue" className="sc-input h-10 max-w-48" inputMode="decimal" value={draft.monthlyRevenue} onChange={(e) => set("monthlyRevenue", e.target.value)} placeholder="Bijv. 1500" />
            </div>
          ) : null}
        </Section>

        {/* Contactpersonen */}
        <Section title="Contactpersonen">
          <Group label="Verantwoordelijke Shortclips">
            {coordinators.map((u) => (
              <Chip key={u.id} on={draft.coordinatorId === u.id} onClick={() => set("coordinatorId", u.id)} person={u.fullName}>{firstName(u.fullName)}</Chip>
            ))}
            <Chip on={!draft.coordinatorId} onClick={() => set("coordinatorId", "")}>Niemand</Chip>
          </Group>
          <Group label="Vaste videograaf">
            {videographers.map((u) => (
              <Chip key={u.id} on={draft.videographerId === u.id} onClick={() => set("videographerId", u.id)} person={u.fullName}>{firstName(u.fullName)}</Chip>
            ))}
            <Chip on={!draft.videographerId} onClick={() => set("videographerId", "")}>Niemand</Chip>
          </Group>
          <div className="flex flex-col gap-3 border-t border-[var(--color-line)] pt-4">
            <span className="text-sm text-[var(--color-ink-muted)]">Contactpersoon klant</span>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Naam" value={draft.contactName} onChange={(v) => set("contactName", v)} />
              <TextField label="E-mail" type="email" value={draft.contactEmail} onChange={setEmail} hint="Ook de portaallogin." />
              <TextField label="Telefoon" type="tel" value={draft.contactPhone} onChange={(v) => set("contactPhone", v)} />
            </div>
          </div>
        </Section>
      </div>

      {/* Klantprofiel */}
      <Section title="Klantprofiel">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Klantnaam" required value={draft.name} onChange={(v) => set("name", v)} placeholder="Bijv. Koops Interieur" />
          <TextField
            label="Website"
            value={draft.website}
            onChange={(v) => { set("website", v); setWebsiteAuto(false); }}
            placeholder="https://"
            tag={websiteAuto ? "uit e-mailadres" : undefined}
          />
        </div>
        <Group label="Sector">
          {sectorOptions.map((s) => (
            <Chip key={s} on={!customSector && draft.sector === s} onClick={() => { set("sector", s); setCustomSector(false); }}>{s}</Chip>
          ))}
          <Chip on={customSector} onClick={() => { setCustomSector(true); set("sector", ""); }}>Anders</Chip>
          {customSector ? (
            <input aria-label="Sector" className="sc-input h-10 w-56" value={draft.sector} onChange={(e) => set("sector", e.target.value)} placeholder="Typ de sector" autoFocus />
          ) : null}
        </Group>
        <details className="group border-t border-[var(--color-line)] pt-4">
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            Logo, accentkleur, omschrijving en interne notities <span className="text-xs group-open:hidden">· tonen</span>
          </summary>
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="sc-label">Klantlogo</label>
                <LogoPicker value={draft.logoUrl} onChange={(v) => set("logoUrl", v)} name={draft.name} />
              </div>
              <div>
                <label className="sc-label">Accentkleur</label>
                <div className="flex items-center gap-2">
                  <input className="sc-input flex-1" value={draft.color} onChange={(e) => set("color", e.target.value)} placeholder="#2E90FA" />
                  <input type="color" aria-label="Kleur kiezen" className="size-9 shrink-0 cursor-pointer rounded border border-[var(--color-line)] bg-transparent" value={/^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : "#2E90FA"} onChange={(e) => set("color", e.target.value)} />
                </div>
              </div>
            </div>
            <div>
              <label className="sc-label">Omschrijving</label>
              <textarea className="sc-input resize-y" rows={2} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="Wat voor bedrijf is dit? Staat in het klantportaal." />
            </div>
            <div>
              <label className="sc-label">Interne notities</label>
              <textarea className="sc-input resize-y" rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Niet zichtbaar voor de klant." />
            </div>
          </div>
        </details>
      </Section>

      {result && !result.ok ? <ErrorNote>{result.message}</ErrorNote> : null}
      {result?.ok && !dirty ? <InfoNote tone="good">{mode === "create" ? "Klant aangemaakt." : "Opgeslagen."}</InfoNote> : null}

      {/* Opslaan: blijft altijd in beeld */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] px-5 py-3.5 text-white shadow-lg">
        <span className="text-sm">
          {mode === "create" ? "Nieuwe klant" : changes === 0 ? "Geen wijzigingen" : `${changes} ${changes === 1 ? "wijziging" : "wijzigingen"}, nog niet opgeslagen`}
        </span>
        <div className="flex gap-2">
          {mode === "edit" ? (
            <button type="button" onClick={() => (dirty ? setDraft(initial) : router.push(`/clients/${slug}`))} disabled={pending} className="h-10 rounded-[var(--radius-md)] border border-white/35 px-4 text-sm font-medium text-white transition hover:bg-white/10">
              {dirty ? "Wijzigingen wissen" : "Terug"}
            </button>
          ) : null}
          <button type="button" onClick={save} disabled={pending || (mode === "edit" && !dirty) || !draft.name.trim()} className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] bg-white px-5 text-sm font-semibold text-[var(--color-indigo-ink)] transition hover:opacity-90 disabled:opacity-50">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "create" ? "Klant aanmaken" : "Opslaan"}
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <details className="sc-card group">
          <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            Klant stopzetten of verwijderen <span className="text-xs group-open:hidden">· tonen</span>
          </summary>
          <div className="px-5 pb-5">
            <DangerZone slug={slug!} name={initial.name} status={draft.status} canDelete={canDelete} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

/* ------------------------------ bouwstenen ------------------------------ */

function firstName(full: string): string {
  return full.split(" ")[0] || full;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sc-card flex flex-col gap-5 p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.08em]">{title}</h2>
      {children}
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-2xs font-medium text-[var(--color-ink-muted)]">{children}</span>;
}

function Group({ label, tag, children }: { label: string; tag?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <span className="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
        {label}
        {tag ? <Tag>{tag}</Tag> : null}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children, person, compact }: { on: boolean; onClick: () => void; children: React.ReactNode; person?: string; compact?: boolean }) {
  const initials = person ? person.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() : null;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border text-sm font-medium transition ${compact ? "h-8 px-3" : "h-10 px-4"} ${
        on
          ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white"
          : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-ink-faint)]"
      } ${compact && !on ? "border-transparent" : ""}`}
    >
      {initials ? (
        <span className={`grid size-6 place-items-center rounded-full text-2xs font-semibold ${on ? "bg-white text-[var(--color-indigo-ink)]" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink)]"}`}>{initials}</span>
      ) : null}
      {children}
    </button>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder, hint, tag, required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; hint?: string; tag?: string; required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-[var(--color-ink-muted)]">
      <span className="flex items-center gap-2">
        {label}
        {required ? <span className="text-[var(--color-bad)]">*</span> : null}
        {tag ? <Tag>{tag}</Tag> : null}
      </span>
      <input className="sc-input h-10 text-sm" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {hint ? <span className="text-2xs text-[var(--color-ink-faint)]">{hint}</span> : null}
    </label>
  );
}

function DangerZone({
  slug,
  name,
  status,
  canDelete,
}: {
  slug: string;
  name: string;
  status: string;
  canDelete: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const router = useRouter();
  const stopped = status === "churned" || status === "paused";

  return (
    <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-bad-soft)] p-4">
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">Klant stopzetten of verwijderen</h3>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        Een gestopte klant behoudt alle historie (video&apos;s, resultaten, projecten); de portaaltoegang gaat automatisch dicht. Verwijderen haalt de klant overal weg — de data blijft bewaard en is herstelbaar door een beheerder.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setClientStatus(slug, stopped ? "active" : "churned");
              setResult(res);
              if (res.ok) router.refresh();
            })
          }
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {stopped ? "Weer op actief zetten" : "Op gestopt zetten (archiveren)"}
        </Button>
      </div>

      {canDelete ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--color-line)] pt-4">
          <div className="min-w-56 flex-1">
            <label className="sc-label">Typ de klantnaam om te verwijderen</label>
            <input className="sc-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={name} />
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || confirm.trim() !== name}
            onClick={() =>
              start(async () => {
                const res = await deleteClient(slug, confirm);
                setResult(res);
                if (res.ok) {
                  router.push("/clients");
                  router.refresh();
                }
              })
            }
          >
            <Trash2 className="size-3.5" />
            Definitief verwijderen
          </Button>
        </div>
      ) : null}

      {result && !result.ok ? <ErrorNote>{result.message}</ErrorNote> : null}
    </div>
  );
}

/** Verkleint een geüploade afbeelding naar max 256px en levert een data-URL,
 *  zodat het logo direct opgeslagen kan worden zonder externe opslag. SVG blijft
 *  ongewijzigd (vector). */
function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.type === "image/svg+xml") {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Lezen mislukt"));
      r.readAsDataURL(file);
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas niet beschikbaar"));
        ctx.drawImage(img, 0, 0, w, h);
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve(canvas.toDataURL(type, 0.9));
      };
      img.onerror = () => reject(new Error("Ongeldige afbeelding"));
      img.src = String(r.result);
    };
    r.onerror = () => reject(new Error("Lezen mislukt"));
    r.readAsDataURL(file);
  });
}

function LogoPicker({ value, onChange, name }: { value: string; onChange: (v: string) => void; name: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(file?: File) {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      onChange(await readLogo(file));
    } catch {
      setErr("Kon dit bestand niet verwerken. Kies een PNG, JPG of SVG.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)]">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={name || "Logo"} className="size-full object-contain" />
        ) : (
          <span className="text-2xs text-[var(--color-ink-faint)]">geen logo</span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Logo uploaden
          </button>
          {value ? (
            <button type="button" onClick={() => onChange("")} className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-bad)]">
              Verwijderen
            </button>
          ) : null}
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <input className="sc-input text-xs" value={value.startsWith("data:") ? "" : value} onChange={(e) => onChange(e.target.value)} placeholder="of plak een logo-URL (https://…)" />
        {err ? <p className="text-xs text-[var(--color-bad)]">{err}</p> : null}
      </div>
    </div>
  );
}

