"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { createPersonalPortalLink, type PortalLinkUserOption } from "@/server/actions/portal-access-links";
import { ACCESS_LINK_TTL_DAYS } from "@/lib/access-link";

const TARGETS = [
  { value: "/portal", label: "Overzicht" },
  { value: "/portal/scripts", label: "Scripts" },
  { value: "/portal/videos", label: "Video's" },
  { value: "/portal/content", label: "Contentplanning" },
  { value: "/portal/resultaten", label: "Resultaten" },
];

/**
 * Persoonlijke inloglink voor een klant maken en kopiëren, bijv. om in een
 * WhatsApp-bericht te zetten. De klant opent de pagina dan zonder in te loggen.
 */
export function PersonalLinkBox({ clientId, name }: { clientId: string; name: string }) {
  const [target, setTarget] = useState("/portal/videos");
  const [userId, setUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<PortalLinkUserOption[]>([]);
  const [link, setLink] = useState<{ url: string; userName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function make() {
    setError(null);
    setCopied(false);
    start(async () => {
      const res = await createPersonalPortalLink({ clientId, targetPath: target, userId });
      if (res.users) setUsers(res.users);
      if (!res.ok) {
        setLink(null);
        setError(res.message);
        return;
      }
      setUserId(res.userId);
      setLink({ url: res.url, userName: res.userName });
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Kopiëren lukte niet. Selecteer de link en kopieer handmatig.");
    }
  }

  return (
    <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2.5 ring-1 ring-[var(--color-line)]">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
        <KeyRound className="size-3.5" /> Persoonlijke inloglink voor {name}
      </div>
      <p className="mb-2 text-2xs text-[var(--color-ink-faint)]">
        Voor in WhatsApp. De klant opent de pagina met één tik, zonder wachtwoord. {ACCESS_LINK_TTL_DAYS} dagen geldig, alleen voor deze klant.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={target}
          onChange={(e) => { setTarget(e.target.value); setLink(null); }}
          className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
          aria-label="Link opent"
        >
          {TARGETS.map((t) => <option key={t.value} value={t.value}>Opent: {t.label}</option>)}
        </select>
        {users.length > 1 ? (
          <select
            value={userId ?? ""}
            onChange={(e) => { setUserId(e.target.value); setLink(null); }}
            className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
            aria-label="Voor wie"
          >
            {users.map((u) => <option key={u.id} value={u.id}>Voor: {u.name}</option>)}
          </select>
        ) : null}
        <button
          type="button"
          onClick={make}
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Link maken
        </button>
      </div>
      {link ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={link.url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] px-2 py-1.5 text-2xs"
            aria-label={`Persoonlijke link voor ${link.userName}`}
          />
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-good)] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Gekopieerd" : "Kopiëren"}
          </button>
        </div>
      ) : null}
      {link && users.length <= 1 ? <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">Voor {link.userName}.</p> : null}
      {error ? <p className="mt-2 text-2xs text-[var(--color-bad)]">{error}</p> : null}
    </div>
  );
}
