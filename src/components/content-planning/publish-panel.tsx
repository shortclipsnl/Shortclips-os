"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";

/**
 * Posten: Handmatig (standaard) of Via Metricool. Eén keuze per bericht,
 * één hoofdknop, en altijd een bevestiging voordat er iets naar Metricool gaat.
 */

type Channel = { platform: string; connected: boolean; status: string; error: string | null };
type View = {
  mode: "handmatig" | "metricool";
  metricoolAvailable: boolean;
  live: boolean;
  channels: Channel[];
  blockers: string[];
  canPlan: boolean;
  canRevoke: boolean;
};

const NAME: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook" };
const STATUS: Record<string, { label: string; cls: string }> = {
  handmatig: { label: "Zelf posten", cls: "text-[var(--color-ink-muted)]" },
  niet_verstuurd: { label: "Nog inplannen", cls: "text-[var(--color-ink-muted)]" },
  wordt_verstuurd: { label: "Wordt verstuurd", cls: "text-[var(--color-info)]" },
  proef: { label: "Proefmodus, niet verstuurd", cls: "text-[var(--color-violet)]" },
  ingepland: { label: "Ingepland", cls: "text-[var(--color-good)]" },
  in_de_wacht: { label: "Gewijzigd, opnieuw inplannen", cls: "text-[var(--color-warn)]" },
  gepubliceerd: { label: "Online", cls: "text-[var(--color-good)]" },
  mislukt: { label: "Niet gelukt", cls: "text-[var(--color-bad)]" },
  geannuleerd: { label: "Nog inplannen", cls: "text-[var(--color-ink-muted)]" },
};

export function PublishPanel({ itemId, when, clientName }: { itemId: string; when: string; clientName: string }) {
  const [view, setView] = useState<View | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/contentplanning/items/${itemId}/publish`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { view: View | null; canEdit: boolean } | null) => {
        if (!alive || !d) return;
        setView(d.view);
        setCanEdit(d.canEdit);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [itemId]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/contentplanning/items/${itemId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json().catch(() => null)) as { result?: { ok: boolean; message: string }; view?: View } | null;
      if (d?.view) setView(d.view);
      if (d?.result) setMsg({ ok: d.result.ok, text: d.result.message });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  if (!view) return null;
  const mc = view.mode === "metricool";
  const toPlan = view.channels.filter((c) => c.connected && c.status !== "ingepland" && c.status !== "gepubliceerd" && c.status !== "handmatig");

  return (
    <div className="flex flex-col gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">Posten</span>
        <div className="inline-flex rounded-full border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-0.5" role="group" aria-label="Manier van posten">
          {(["handmatig", "metricool"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={!canEdit || busy || (m === "metricool" && !view.metricoolAvailable)}
              aria-pressed={view.mode === m}
              title={m === "metricool" && !view.metricoolAvailable ? "Deze klant heeft geen kanalen gekoppeld in Metricool" : undefined}
              onClick={() => view.mode !== m && act({ action: "mode", mode: m })}
              className={`rounded-full px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${view.mode === m ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)]"}`}
            >
              {m === "handmatig" ? "Handmatig" : "Via Metricool"}
            </button>
          ))}
        </div>
      </div>

      {mc ? (
        <ul className="flex flex-col gap-1">
          {view.channels.map((c) => {
            const st = c.connected ? STATUS[c.status] ?? STATUS.niet_verstuurd! : { label: "Zelf posten, niet gekoppeld in Metricool", cls: "text-[var(--color-ink-faint)]" };
            return (
              <li key={c.platform} className="flex items-center gap-2 text-xs">
                <PlatformIcon platform={c.platform} size={14} title={NAME[c.platform]} />
                <span className="w-20 font-medium">{NAME[c.platform] ?? c.platform}</span>
                <span className={st.cls}>{st.label}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-[var(--color-ink-muted)]">Het team post deze video zelf. Er gaat niets naar Metricool.</p>
      )}

      {mc && view.blockers.length ? (
        <p className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-2.5 py-1.5 text-xs text-[#8a5300]">{view.blockers.join(" ")}</p>
      ) : null}
      {mc && !view.live ? (
        <p className="text-2xs text-[var(--color-ink-faint)]">Proefmodus: alles wordt gecontroleerd, maar er gaat nog niets echt naar Metricool.</p>
      ) : null}
      {msg ? <p className={`text-xs ${msg.ok ? "text-[var(--color-good)]" : "text-[var(--color-bad)]"}`}>{msg.text}</p> : null}

      {canEdit && mc ? (
        confirm ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] p-2.5 text-xs text-[#5c3a00]" role="alertdialog" aria-label="Controle voor inplannen">
            <b>Klopt dit?</b>
            <span>{clientName} · {when}</span>
            <span>{toPlan.map((c) => NAME[c.platform] ?? c.platform).join(", ")}</span>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => act({ action: "plan", confirm: true })} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-good)] px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Ja, inplannen
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirm(false)} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 font-medium">
                Terug
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {view.canPlan ? (
              <button type="button" disabled={busy} onClick={() => setConfirm(true)} className="rounded-[var(--radius-sm)] bg-[var(--color-good)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                Inplannen via Metricool
              </button>
            ) : null}
            {view.canRevoke ? (
              <button type="button" disabled={busy} onClick={() => act({ action: "revoke" })} className="text-xs font-medium text-[var(--color-bad)] hover:underline disabled:opacity-50">
                Intrekken
              </button>
            ) : null}
            {busy ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : null}
          </div>
        )
      ) : null}
    </div>
  );
}
