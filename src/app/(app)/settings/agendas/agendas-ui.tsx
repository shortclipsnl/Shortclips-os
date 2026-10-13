"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { addCoupling, updateCoupling, removeCoupling } from "@/server/actions/calendar-couplings";

type Coupling = { id: string; calendarId: string; label: string | null; color: string; enabled: boolean };
type Available =
  | { ok: true; calendars: { id: string; summary: string; alreadyCoupled: boolean }[] }
  | { ok: false; message: string };

export function AgendasManager({
  couplings,
  available,
  colors,
}: {
  couplings: Coupling[];
  available: Available;
  colors: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Nieuwe-agenda-formulier
  const [pickId, setPickId] = useState("");
  const [manualId, setManualId] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(colors[0] ?? "#2E90FA");

  function act(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.message ?? "Er ging iets mis.");
      else router.refresh();
    });
  }

  function submitAdd() {
    const calendarId = (pickId || manualId).trim();
    if (!calendarId) {
      setError("Kies of typ een agenda-id.");
      return;
    }
    act(async () => {
      const res = await addCoupling({ calendarId, label: label.trim() || undefined, color });
      if (res.ok) {
        setPickId("");
        setManualId("");
        setLabel("");
      }
      return res;
    });
  }

  const pickable = available.ok ? available.calendars.filter((c) => !c.alreadyCoupled) : [];

  return (
    <div>
      {/* Gekoppelde agenda's */}
      {couplings.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[var(--color-ink-faint)]">Nog geen agenda&apos;s gekoppeld. Voeg hieronder je eerste agenda toe.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {couplings.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <label className="relative inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full ring-1 ring-[var(--color-line-strong)]" title="Kleur wijzigen" style={{ background: c.color }}>
                <input
                  type="color"
                  defaultValue={c.color}
                  onChange={(e) => act(() => updateCoupling({ id: c.id, color: e.target.value }))}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Kleur wijzigen"
                />
              </label>
              <div className="min-w-0 flex-1">
                <input
                  defaultValue={c.label ?? ""}
                  placeholder="Naam (bijv. Opnames, Milou, Feestdagen)"
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== (c.label ?? "")) act(() => updateCoupling({ id: c.id, label: v })); }}
                  className="w-full max-w-xs rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium hover:border-[var(--color-line)] focus:border-[var(--color-line-strong)] focus:bg-[var(--color-surface)] focus:outline-none"
                />
                <div className="truncate px-1.5 text-2xs text-[var(--color-ink-faint)]">{c.calendarId}</div>
              </div>
              <button
                type="button"
                onClick={() => act(() => updateCoupling({ id: c.id, enabled: !c.enabled }))}
                className={`rounded-full px-2.5 py-1 text-2xs font-medium ${c.enabled ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]"}`}
              >
                {c.enabled ? "Actief" : "Uit"}
              </button>
              <button
                type="button"
                onClick={() => act(() => removeCoupling(c.id))}
                className="rounded-[var(--radius-sm)] p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-bad-soft)] hover:text-[var(--color-bad)]"
                title="Ontkoppelen"
                aria-label="Ontkoppelen"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Nieuwe agenda toevoegen */}
      <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-5">
        <h3 className="mb-2 text-sm font-semibold">Agenda koppelen</h3>
        {available.ok ? (
          pickable.length > 0 ? (
            <select className="sc-input mb-2 w-full" value={pickId} onChange={(e) => { setPickId(e.target.value); const c = pickable.find((x) => x.id === e.target.value); if (c && !label) setLabel(c.summary); }}>
              <option value="">— Kies een agenda uit Google —</option>
              {pickable.map((c) => <option key={c.id} value={c.id}>{c.summary}</option>)}
            </select>
          ) : (
            <p className="mb-2 text-xs text-[var(--color-ink-muted)]">Alle beschikbare Google-agenda&apos;s zijn al gekoppeld. Typ hieronder eventueel een agenda-id in dat je gedeeld hebt gekregen.</p>
          )
        ) : (
          <p className="mb-2 text-xs text-[var(--color-warn)]">{available.message}</p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          {(!available.ok || pickable.length === 0) ? (
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-2xs font-medium text-[var(--color-ink-muted)]">Agenda-id (handmatig)</label>
              <input className="sc-input w-full" value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="naam@group.calendar.google.com" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-2xs font-medium text-[var(--color-ink-muted)]">Naam</label>
            <input className="sc-input w-full" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Weergavenaam" />
          </div>
          <div>
            <label className="mb-1 block text-2xs font-medium text-[var(--color-ink-muted)]">Kleur</label>
            <div className="flex items-center gap-1.5">
              {colors.map((hex) => (
                <button key={hex} type="button" onClick={() => setColor(hex)}
                  className={`size-6 rounded-full ring-2 ${color === hex ? "ring-[var(--color-ink)]" : "ring-transparent"}`}
                  style={{ background: hex }} aria-label={`Kleur ${hex}`} title={hex} />
              ))}
            </div>
          </div>
          <button type="button" onClick={submitAdd} disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3.5 text-sm font-medium text-white hover:bg-[var(--color-indigo-soft)] disabled:opacity-60">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Koppelen
          </button>
        </div>
        {error ? <p className="mt-2 text-xs font-medium text-[var(--color-bad)]">{error}</p> : null}
      </div>
    </div>
  );
}
