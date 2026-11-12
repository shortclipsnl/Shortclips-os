"use client";

import { useState, useTransition } from "react";
import { setNotificationPreference } from "@/server/actions/client-app";
import type { PreferenceRow } from "@/server/client-app";

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
        checked ? "bg-[var(--color-indigo-ink)]" : "bg-[var(--color-line-strong)]"
      }`}
    >
      <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

/** Per soort melding kiezen: push in de app en/of e-mail. */
export function NotificationPreferences({ initial }: { initial: PreferenceRow[] }) {
  const [rows, setRows] = useState(initial);
  const [, start] = useTransition();

  function update(type: string, channel: "push" | "email", enabled: boolean) {
    setRows((prev) => prev.map((r) => (r.type === type ? { ...r, [channel]: enabled } : r)));
    start(async () => {
      const res = await setNotificationPreference({ type, channel, enabled });
      if (!res.ok) setRows((prev) => prev.map((r) => (r.type === type ? { ...r, [channel]: !enabled } : r)));
    });
  }

  return (
    <div>
      <div className="mb-2 grid grid-cols-[1fr_auto_auto] items-center gap-x-4 text-xs font-semibold text-[var(--color-ink-faint)]">
        <span>Soort melding</span>
        <span className="w-12 text-center">App</span>
        <span className="w-12 text-center">E-mail</span>
      </div>
      <ul className="divide-y divide-[var(--color-line)]">
        {rows.map((r) => (
          <li key={r.type} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 py-3">
            <span className="text-sm text-[var(--color-ink)]">{r.label}</span>
            <Switch checked={r.push} onChange={(v) => update(r.type, "push", v)} label={`${r.label} in de app`} />
            <Switch checked={r.email} onChange={(v) => update(r.type, "email", v)} label={`${r.label} per e-mail`} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
        Tussen 21:00 en 08:00 sturen we geen pushmeldingen, en nooit meer dan twee per dag. In het meldingencentrum zie je altijd alles.
      </p>
    </div>
  );
}
