"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Loader2, Mail, Power, RotateCcw, UserPlus, Zap } from "lucide-react";
import {
  createTestPortal,
  invitePortalUser,
  resendPortalInvite,
  sendPortalPasswordReset,
  setPortalUserActive,
  type PortalAccountResult,
} from "@/server/actions/portal-accounts";

type PortalUser = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  hasPassword: boolean;
  lastLoginAt: string | null;
  invitedAt: string | null;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  active: { label: "Actief", cls: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  invited: { label: "Uitgenodigd", cls: "bg-[var(--color-warn-soft)] text-[#8a5300]" },
  suspended: { label: "Gedeactiveerd", cls: "bg-[var(--color-bad-soft)] text-[var(--color-bad)]" },
};

function fmt(d: string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return null; }
}

/** Eénmalige weergave van een link of wachtwoord, met kopieerknop. */
function OnceBanner({ res }: { res: PortalAccountResult }) {
  const [copied, setCopied] = useState(false);
  const value = res.password ?? res.link ?? "";
  if (!value && !res.emailSent) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* geen clipboard */ }
  }
  return (
    <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-good)]/30 bg-[var(--color-good-soft)]/50 p-3 text-xs">
      {res.emailSent ? (
        <p className="font-semibold text-[#1d6b4c]">E-mail verstuurd naar {res.email}. De klant stelt zelf een wachtwoord in.</p>
      ) : (
        <>
          <p className="font-semibold text-[#1d6b4c]">
            {res.password ? "Tijdelijk wachtwoord — je ziet het maar één keer. Geef het veilig door:" : "E-mail staat nog niet aan. Deel deze beveiligde link met de klant:"}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {res.email ? <code className="rounded bg-[var(--color-surface)] px-2 py-1 ring-1 ring-[var(--color-line)]">{res.email}</code> : null}
            <code className="max-w-full truncate rounded bg-[var(--color-surface)] px-2 py-1 font-semibold ring-1 ring-[var(--color-line)]">{value}</code>
            <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface)] px-2.5 py-1 font-semibold text-[var(--color-ink)] ring-1 ring-[var(--color-line)] hover:brightness-95">
              {copied ? <><Check className="size-3.5 text-[var(--color-good)]" /> Gekopieerd</> : <><Copy className="size-3.5" /> Kopieer</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ClientPortalManager({
  clientId,
  name,
  users,
}: {
  clientId: string;
  name: string;
  users: PortalUser[];
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [pending, startTransition] = useTransition();
  const [res, setRes] = useState<PortalAccountResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<PortalAccountResult>) {
    setErr(null);
    startTransition(async () => {
      try {
        const r = await fn();
        if (r.ok) { setRes(r); } else { setErr(r.message ?? "Er ging iets mis."); setRes(null); }
      } catch { setErr("Actie mislukt. Probeer het later opnieuw."); }
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline"
      >
        {open ? "Beheer sluiten" : "Portaaltoegang beheren"}
      </button>

      {open ? (
        <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3">
          {/* Eén-klik testportaal: maakt direct een login + tijdelijk wachtwoord,
              zodat je meteen met deze klant kunt testen (geen e-mail nodig). */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-brand-300)] bg-[var(--color-brand-50)] px-3 py-2">
            <span className="text-xs text-[var(--color-brand-700)]"><strong>Snel testen?</strong> Maak in één klik een portaallogin met wachtwoord.</span>
            <button type="button" disabled={pending} onClick={() => run(() => createTestPortal(clientId))} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-60">
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />} Testportaal + wachtwoord
            </button>
          </div>

          {/* Bestaande gebruikers */}
          {users.length > 0 ? (
            <ul className="mb-3 space-y-2">
              {users.map((u) => {
                const st = STATUS_LABEL[u.status] ?? { label: u.status, cls: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]" };
                const last = fmt(u.lastLoginAt);
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3 py-2 ring-1 ring-[var(--color-line)]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--color-ink)]">{u.email}</span>
                      <span className="block text-2xs text-[var(--color-ink-faint)]">{last ? `Laatste login ${last}` : u.status === "invited" ? "Nog niet ingelogd" : "Nog nooit ingelogd"}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold ${st.cls}`}>{st.label}</span>
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      {u.status === "invited" ? (
                        <button type="button" disabled={pending} onClick={() => run(() => resendPortalInvite(u.id))} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-semibold hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"><Mail className="size-3" /> Opnieuw</button>
                      ) : null}
                      <button type="button" disabled={pending} onClick={() => run(() => sendPortalPasswordReset({ userId: u.id, mode: "email" }))} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-semibold hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"><KeyRound className="size-3" /> Reset-mail</button>
                      <button type="button" disabled={pending} onClick={() => run(() => sendPortalPasswordReset({ userId: u.id, mode: "manual" }))} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-semibold hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"><RotateCcw className="size-3" /> Wachtwoord</button>
                      {u.status === "suspended" ? (
                        <button type="button" disabled={pending} onClick={() => run(() => setPortalUserActive(u.id, true))} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-good)]/40 px-2 py-1 text-2xs font-semibold text-[#1d6b4c] hover:bg-[var(--color-good-soft)] disabled:opacity-60"><Power className="size-3" /> Activeren</button>
                      ) : (
                        <button type="button" disabled={pending} onClick={() => run(() => setPortalUserActive(u.id, false))} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-bad)]/40 px-2 py-1 text-2xs font-semibold text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)] disabled:opacity-60"><Power className="size-3" /> Deactiveren</button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mb-3 text-xs text-[var(--color-ink-muted)]">Nog geen portaalgebruiker voor {name}. Nodig er hieronder een uit.</p>
          )}

          {/* Nieuwe gebruiker uitnodigen */}
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2.5 ring-1 ring-[var(--color-line)]">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]"><UserPlus className="size-3.5" /> Gebruiker toevoegen</div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[180px] flex-1">
                <span className="mb-0.5 block text-2xs text-[var(--color-ink-faint)]">E-mailadres</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="naam@bedrijf.nl" className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-brand-500)]" />
              </label>
              <label className="block min-w-[140px] flex-1">
                <span className="mb-0.5 block text-2xs text-[var(--color-ink-faint)]">Naam (optioneel)</span>
                <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contactpersoon" className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-brand-500)]" />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending || !email} onClick={() => run(() => invitePortalUser({ clientId, email, fullName: contactName, mode: "email" }))} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />} Uitnodigen per e-mail
              </button>
              <button type="button" disabled={pending || !email} onClick={() => run(() => invitePortalUser({ clientId, email, fullName: contactName, mode: "manual" }))} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60">
                <KeyRound className="size-3.5" /> Direct wachtwoord
              </button>
            </div>
          </div>

          {err ? <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">{err}</p> : null}
          {res ? <OnceBanner res={res} /> : null}
        </div>
      ) : null}
    </div>
  );
}
