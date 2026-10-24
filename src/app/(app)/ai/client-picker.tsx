"use client";

import { ClientLogo } from "@/components/ui";

export type PickerClient = { id: string; name: string; logoUrl?: string | null; color?: string | null };

/**
 * Scanbare klantkiezer met logo's: chips met het klantlogo + naam, zodat je in
 * één oogopslag de juiste klant aanwijst in plaats van een platte dropdown.
 */
export function ClientPicker({
  clients,
  value,
  onChange,
  placeholder = "Kies een klant…",
}: {
  clients: PickerClient[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  if (clients.length === 0) {
    return <p className="text-sm text-[var(--color-ink-faint)]">Geen klanten beschikbaar.</p>;
  }
  return (
    <div className="max-h-56 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5">
      <div className="flex flex-wrap gap-1.5">
        {clients.map((c) => {
          const selected = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              aria-pressed={selected}
              className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-sm font-medium transition ${
                selected
                  ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white"
                  : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand-500)]"
              }`}
              title={c.name}
            >
              <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={20} />
              <span className="max-w-[12rem] truncate pr-0.5">{c.name}</span>
            </button>
          );
        })}
      </div>
      {!value ? <p className="px-1 pt-1.5 text-2xs text-[var(--color-ink-faint)]">{placeholder}</p> : null}
    </div>
  );
}
