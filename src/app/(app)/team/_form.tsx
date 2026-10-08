"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  createTeamMember,
  setTeamMemberActive,
  updateTeamMember,
  type TeamMemberInput,
} from "@/server/actions/team";
import { Button, ErrorNote, InfoNote } from "@/components/ui";

const ROLES = [
  { value: "project_coordinator", label: "Projectcoördinator" },
  { value: "content_creator", label: "Content creative" },
  { value: "videographer", label: "Videograaf" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Beheerder" },
  { value: "finance", label: "Finance" },
  { value: "owner", label: "Eigenaar" },
];

type Draft = {
  fullName: string;
  email: string;
  primaryRole: string;
  jobTitle: string;
  phone: string;
  weeklyVideoCapacity: string;
  color: string;
  isInternal: boolean;
};

export function TeamMemberForm({
  mode,
  userId,
  initial,
  isActive,
  canDeactivate,
}: {
  mode: "create" | "edit";
  userId?: string;
  initial: Draft;
  isActive?: boolean;
  canDeactivate?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toInput(): TeamMemberInput {
    return {
      fullName: draft.fullName,
      email: draft.email,
      primaryRole: draft.primaryRole as TeamMemberInput["primaryRole"],
      jobTitle: draft.jobTitle || null,
      phone: draft.phone || null,
      weeklyVideoCapacity: Number(draft.weeklyVideoCapacity) || 0,
      color: draft.color || null,
      isInternal: draft.isInternal,
    };
  }

  function save() {
    start(async () => {
      const res = mode === "create" ? await createTeamMember(toInput()) : await updateTeamMember(userId!, toInput());
      setResult(res);
      if (res.ok) {
        router.push("/team");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Naam" required>
          <input className="sc-input" value={draft.fullName} onChange={(e) => set("fullName", e.target.value)} />
        </Field>
        <Field label="E-mailadres" required hint="Gebruikt om in te loggen en voor koppelingen.">
          <input className="sc-input" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Rol" hint="Bepaalt de toegangsrechten in het dashboard.">
          <select className="sc-input" value={draft.primaryRole} onChange={(e) => set("primaryRole", e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Functie / verantwoordelijkheid">
          <input className="sc-input" value={draft.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="Bijv. Content creative" />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Telefoon">
          <input className="sc-input" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Video-capaciteit / week" hint="0 als niet van toepassing.">
          <input className="sc-input" type="number" min={0} value={draft.weeklyVideoCapacity} onChange={(e) => set("weeklyVideoCapacity", e.target.value)} />
        </Field>
        <Field label="Accentkleur">
          <div className="flex items-center gap-2">
            <input className="sc-input flex-1" value={draft.color} onChange={(e) => set("color", e.target.value)} placeholder="#2E90FA" />
            <input type="color" aria-label="Kleur" className="size-9 shrink-0 cursor-pointer rounded border border-[var(--color-line)] bg-transparent" value={/^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : "#2E90FA"} onChange={(e) => set("color", e.target.value)} />
          </div>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!draft.isInternal} onChange={(e) => set("isInternal", !e.target.checked)} className="size-4 accent-[var(--color-indigo-ink)]" />
        Freelancer (extern)
      </label>

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] pt-4">
        <Button onClick={save} disabled={pending || (mode === "edit" && !dirty) || !draft.fullName.trim() || !draft.email.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {mode === "create" ? "Teamlid toevoegen" : dirty ? "Wijzigingen opslaan" : "Geen wijzigingen"}
        </Button>
        <Button variant="ghost" onClick={() => router.push("/team")} disabled={pending}>Annuleren</Button>
      </div>

      {mode === "create" ? (
        <InfoNote>Een nieuw teamlid verschijnt direct in de overzichten en is toewijsbaar aan klanten en taken. Om in te loggen stelt de persoon later een wachtwoord in.</InfoNote>
      ) : null}

      {result ? (
        result.ok ? <InfoNote tone="good">Opgeslagen.</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}

      {mode === "edit" && canDeactivate ? (
        <DeactivateControl userId={userId!} isActive={isActive ?? true} />
      ) : null}
    </div>
  );
}

function DeactivateControl({ userId, isActive }: { userId: string; isActive: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-4">
      <h3 className="text-sm font-semibold">Toegang</h3>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        {isActive
          ? "Deactiveren blokkeert het inloggen. Het teamlid blijft in de historie en overzichten staan."
          : "Dit teamlid is gedeactiveerd en kan niet inloggen."}
      </p>
      <div className="mt-3">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await setTeamMemberActive(userId, !isActive);
              if (res.ok) router.refresh();
              else setErr(res.message ?? "Mislukt");
            })
          }
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {isActive ? "Deactiveren" : "Weer activeren"}
        </Button>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
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
