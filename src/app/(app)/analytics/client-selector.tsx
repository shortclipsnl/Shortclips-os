"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Search } from "lucide-react";
import { ClientLogo } from "@/components/ui";

export type SelectorClient = { slug: string; name: string; color: string | null; status: string; logoUrl: string | null };

/**
 * Prominente klantselector voor de resultatenpagina. Donkerblauwe balk met de
 * actieve klant groot in beeld en een doorzoekbare dropdown om snel te wisselen
 * — werkt ook met veel klanten.
 */
export function ClientSelector({
  clients,
  currentSlug,
}: {
  clients: SelectorClient[];
  currentSlug?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const current = clients.find((c) => c.slug === currentSlug) ?? null;
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? clients.filter((c) => c.name.toLowerCase().includes(term)) : clients;
  }, [clients, q]);

  function go(slug: string) {
    setOpen(false);
    setQ("");
    router.push(`/analytics/${slug}`);
  }

  return (
    <div className="relative mb-5 max-w-md">
      {/* Het hele veld is aanklikbaar; het pijltje staat direct naast de klantnaam. */}
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="inline-flex max-w-full items-center gap-2.5 rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-3.5 py-2.5 text-left text-white transition-colors hover:bg-[var(--color-indigo-soft)]"
      >
        <span className="text-2xs font-semibold uppercase tracking-wide text-white/50">Klant</span>
        {current ? <ClientLogo name={current.name} logoUrl={current.logoUrl} color={current.color} size={26} /> : null}
        <span className="min-w-0 truncate text-base font-bold tracking-tight">
          {current ? current.name : "Kies een klant"}
        </span>
        <ChevronDown className={`size-5 shrink-0 text-white/80 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <>
          {/* Klik buiten de lijst sluit de dropdown. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1.5 w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)]">
            <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
              <Search className="size-4 text-[var(--color-ink-faint)]" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Zoek klant…"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <ul className="max-h-80 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-sm text-[var(--color-ink-faint)]">Geen klant gevonden</li>
              ) : (
                filtered.map((c) => (
                  <li key={c.slug}>
                    <button
                      type="button"
                      onClick={() => go(c.slug)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-2)]"
                    >
                      <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={22} />
                      <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                      {c.status !== "active" ? <span className="shrink-0 text-2xs text-[var(--color-ink-faint)]">gestopt</span> : null}
                      {c.slug === currentSlug ? <Check className="size-4 shrink-0 text-[var(--color-good)]" /> : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
