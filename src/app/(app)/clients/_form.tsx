"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
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

type Draft = {
  name: string;
  sector: string;
  website: string;
  legalName: string;
  logoUrl: string;
  color: string;
  status: string;
  coordinatorId: string;
  videographerId: string;
  monthlyVideoQuota: string;
  monthlyRevenue: string;
  startedOn: string;
  notes: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

const STATUS_OPTIONS = ["active", "onboarding", "paused", "churned", "prospect"] as const;

export function ClientForm({
  mode,
  slug,
  initial,
  users,
  canSeeFinance,
  canDelete,
}: {
  mode: "create" | "edit";
  slug?: string;
  initial: Draft;
  users: UserOption[];
  canSeeFinance: boolean;
  canDelete: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toInput(): ClientInput {
    return {
      name: draft.name,
      sector: draft.sector,
      website: draft.website,
      legalName: draft.legalName,
      logoUrl: draft.logoUrl,
      color: draft.color,
      status: draft.status as ClientInput["status"],
      coordinatorId: draft.coordinatorId || null,
      videographerId: draft.videographerId || null,
      monthlyVideoQuota: Number(draft.monthlyVideoQuota) || 0,
      monthlyRevenue: draft.monthlyRevenue || null,
      startedOn: draft.startedOn || null,
      notes: draft.notes,
      contactName: draft.contactName,
      contactEmail: draft.contactEmail,
      contactPhone: draft.contactPhone,
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

  const coordinators = users;
  const videographers = users.filter((u) => u.primaryRole === "videographer" || u.primaryRole === "content_creator" || u.primaryRole === "owner" || u.primaryRole === "admin");

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Klantnaam" required>
          <input className="sc-input" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Bijv. Koops Interieur" />
        </Field>
        <Field label="Sector">
          <input className="sc-input" value={draft.sector} onChange={(e) => set("sector", e.target.value)} placeholder="Bijv. Bouw & interieur" />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Projectverantwoordelijke">
          <select className="sc-input" value={draft.coordinatorId} onChange={(e) => set("coordinatorId", e.target.value)}>
            <option value="">— Niemand —</option>
            {coordinators.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>
        </Field>
        <Field label="Vaste videograaf">
          <select className="sc-input" value={draft.videographerId} onChange={(e) => set("videographerId", e.target.value)}>
            <option value="">— Niemand —</option>
            {videographers.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Shorts per maand">
          <input className="sc-input" type="number" min={0} value={draft.monthlyVideoQuota} onChange={(e) => set("monthlyVideoQuota", e.target.value)} />
        </Field>
        <Field label="Status">
          <select className="sc-input" value={draft.status} onChange={(e) => set("status", e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{CLIENT_STATUS[s]?.label ?? s}</option>
            ))}
          </select>
        </Field>
        <Field label="Startdatum">
          <input className="sc-input" type="date" value={draft.startedOn} onChange={(e) => set("startedOn", e.target.value)} />
        </Field>
      </div>

      {canSeeFinance ? (
        <Field label="Maandomzet (€)" hint="Alleen zichtbaar voor finance.">
          <input className="sc-input" inputMode="decimal" value={draft.monthlyRevenue} onChange={(e) => set("monthlyRevenue", e.target.value)} placeholder="Bijv. 1500" />
        </Field>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Logo-URL">
          <input className="sc-input" value={draft.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Accentkleur" hint="Hex, bijv. #2E90FA.">
          <div className="flex items-center gap-2">
            <input className="sc-input flex-1" value={draft.color} onChange={(e) => set("color", e.target.value)} placeholder="#2E90FA" />
            <input type="color" aria-label="Kleur kiezen" className="size-9 shrink-0 cursor-pointer rounded border border-[var(--color-line)] bg-transparent" value={/^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : "#2E90FA"} onChange={(e) => set("color", e.target.value)} />
          </div>
        </Field>
      </div>

      <fieldset className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Contactpersoon</legend>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Naam">
            <input className="sc-input" value={draft.contactName} onChange={(e) => set("contactName", e.target.value)} />
          </Field>
          <Field label="E-mail" hint="Wordt gebruikt voor de portaallogin.">
            <input className="sc-input" type="email" value={draft.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
          </Field>
          <Field label="Telefoon">
            <input className="sc-input" value={draft.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <Field label="Interne notities" hint="Niet zichtbaar voor de klant.">
        <textarea className="sc-input resize-y" rows={3} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] pt-4">
        <Button onClick={save} disabled={pending || (mode === "edit" && !dirty) || !draft.name.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {mode === "create" ? "Klant aanmaken" : dirty ? "Wijzigingen opslaan" : "Geen wijzigingen"}
        </Button>
        {mode === "edit" ? (
          <Button variant="ghost" onClick={() => router.push(`/clients/${slug}`)} disabled={pending}>
            Annuleren
          </Button>
        ) : null}
      </div>

      {result ? (
        result.ok ? <InfoNote tone="good">{mode === "create" ? "Klant aangemaakt." : "Opgeslagen."}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}

      {mode === "edit" ? (
        <DangerZone slug={slug!} name={initial.name} status={draft.status} canDelete={canDelete} />
      ) : null}
    </div>
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
        Een gestopte klant behoudt alle historie (video&apos;s, resultaten, projecten); de portaaltoegang gaat automatisch dicht. Verwijderen haalt de klant overal weg en de Monday-import brengt &apos;m niet terug — de data blijft bewaard en is herstelbaar door een beheerder.
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

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="sc-label">
        {label}
        {required ? <span className="text-[var(--color-bad)]"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{hint}</p> : null}
    </div>
  );
}
