"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, Loader2, Send, ShieldCheck, Smartphone } from "lucide-react";
import {
  loadClientAppStatus,
  sendManualClientNotification,
  setClientLoginCodeRequired,
} from "@/server/actions/client-app";

type Status = Extract<Awaited<ReturnType<typeof loadClientAppStatus>>, { ok: true }>;

const LINKS = [
  { value: "/portal", label: "Overzicht" },
  { value: "/portal/videos", label: "Video's" },
  { value: "/portal/scripts", label: "Scripts" },
  { value: "/portal/planning", label: "Planning" },
  { value: "/portal/resultaten", label: "Resultaten" },
  { value: "/portal/samenwerking", label: "Samenwerking" },
];

const STATUS_LABEL: Record<string, string> = { sent: "Aangeboden", failed: "Mislukt", expired: "Verlopen" };

function fmt(d: string | null) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Klant-app per klant: inlogcode aan/uit, aangemelde apparaten, laatste
 * pushmeldingen en handmatig een melding sturen. Laadt pas bij openen.
 */
export function ClientAppPanel({ clientId, name }: { clientId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [href, setHref] = useState("/portal");
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || status) return;
    let alive = true;
    loadClientAppStatus(clientId)
      .then((res) => {
        if (!alive) return;
        if (res.ok) setStatus(res);
        else setError(res.message ?? "Laden mislukt.");
      })
      .catch(() => alive && setError("Laden mislukt."));
    return () => {
      alive = false;
    };
  }, [open, status, clientId]);

  function reload() {
    loadClientAppStatus(clientId).then((res) => res.ok && setStatus(res)).catch(() => undefined);
  }

  function toggleCode(next: boolean) {
    setError(null);
    start(async () => {
      const res = await setClientLoginCodeRequired(clientId, next);
      if (res.ok) setStatus((s) => (s ? { ...s, loginCodeRequired: next } : s));
      else setError(res.message ?? "Opslaan mislukt.");
    });
  }

  function send() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await sendManualClientNotification({ clientId, title, body, href, alsoEmail });
      if (!res.ok) {
        setError(res.message ?? "Versturen mislukt.");
        return;
      }
      setNotice(res.message ?? "Verstuurd.");
      setTitle("");
      setBody("");
      reload();
    });
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">
        {open ? "App en meldingen sluiten" : "App en meldingen"}
      </button>

      {open ? (
        <div className="mt-2 space-y-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3">
          {!status && !error ? (
            <p className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
              <Loader2 className="size-3.5 animate-spin" /> Laden…
            </p>
          ) : null}

          {status ? (
            <>
              {/* Inlogcode */}
              <label className="flex items-start gap-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2.5 ring-1 ring-[var(--color-line)]">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={status.loginCodeRequired}
                  disabled={pending}
                  onChange={(e) => toggleCode(e.target.checked)}
                />
                <span>
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
                    <ShieldCheck className="size-3.5" /> Inlogcode per e-mail op een nieuw apparaat
                  </span>
                  <span className="block text-2xs text-[var(--color-ink-faint)]">
                    Aanbevolen voor grote merken en agencies. De klant vult de code één keer per apparaat in.
                  </span>
                </span>
              </label>

              {/* Apparaten en laatste pushes */}
              <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2.5 ring-1 ring-[var(--color-line)]">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
                  <Smartphone className="size-3.5" /> {status.devices.length} apparaat{status.devices.length === 1 ? "" : "en"} met meldingen
                </div>
                {!status.pushReady ? (
                  <p className="mt-1 text-2xs text-[#8a5300]">Push staat nog uit: VAPID-sleutels ontbreken in de omgevingsvariabelen.</p>
                ) : null}
                {status.devices.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5 text-2xs text-[var(--color-ink-muted)]">
                    {status.devices.map((d, i) => (
                      <li key={i}>
                        {d.email} · {d.platform === "ios" ? "iPhone" : d.platform === "android" ? "Android" : "Computer"}
                        {d.lastSuccessAt ? ` · laatst bereikt ${fmt(d.lastSuccessAt)}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {status.deliveries.length > 0 ? (
                  <>
                    <div className="mt-2 text-2xs font-semibold text-[var(--color-ink-faint)]">Laatste pushmeldingen</div>
                    <ul className="mt-1 space-y-0.5 text-2xs text-[var(--color-ink-muted)]">
                      {status.deliveries.map((d) => (
                        <li key={d.id}>
                          {fmt(d.createdAt)} · {d.title} ·{" "}
                          <span className={d.status === "sent" ? "text-[#1d6b4c]" : "text-[var(--color-bad)]"}>
                            {STATUS_LABEL[d.status] ?? d.status}
                            {d.statusCode ? ` (${d.statusCode})` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>

              {/* Handmatige melding */}
              <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2.5 ring-1 ring-[var(--color-line)]">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
                  <BellRing className="size-3.5" /> Melding sturen aan {name}
                </div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  placeholder="Titel, bijv. Er is een nieuwe update over jouw content"
                  className="mb-2 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-brand-500)]"
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={240}
                  rows={2}
                  placeholder="Korte toelichting (optioneel). Zichtbaar op het vergrendelscherm, dus geen vertrouwelijke details."
                  className="mb-2 w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-brand-500)]"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={href}
                    onChange={(e) => setHref(e.target.value)}
                    className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
                    aria-label="Openen op pagina"
                  >
                    {LINKS.map((l) => (
                      <option key={l.value} value={l.value}>
                        Opent: {l.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
                    <input type="checkbox" checked={alsoEmail} onChange={(e) => setAlsoEmail(e.target.checked)} /> Ook per e-mail
                  </label>
                  <button
                    type="button"
                    disabled={pending || title.trim().length < 3}
                    onClick={send}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Versturen
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {error ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-bad-soft)] px-3 py-2 text-xs text-[var(--color-bad)]">{error}</p> : null}
          {notice ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-good-soft)] px-3 py-2 text-xs text-[#1d6b4c]">{notice}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
