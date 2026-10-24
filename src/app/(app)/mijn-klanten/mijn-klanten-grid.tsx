"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, FileText, Search } from "lucide-react";
import { ClientLogo } from "@/components/ui";
import type { MyClient } from "@/server/client-library";

function fmtDate(d: Date | string | null) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return null; }
}

export function MijnKlantenGrid({ clients }: { clients: MyClient[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(t) || (c.sector ?? "").toLowerCase().includes(t));
  }, [q, clients]);

  return (
    <div>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek een klant…"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-brand-500)]"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line-strong)] px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
          {clients.length === 0 ? "Je bent nog aan geen enkele klant gekoppeld. Zodra je aan de video's van een klant werkt, verschijnt die hier automatisch." : "Geen klant gevonden."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Link
              key={c.id}
              href={`/mijn-klanten/${c.slug}`}
              className="group flex flex-col rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-brand-500)] hover:shadow-[var(--shadow-raised)]"
            >
              <div className="flex items-center gap-3">
                <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-[var(--color-ink)] group-hover:text-[var(--color-brand-700)]">{c.name}</div>
                  {c.sector ? <div className="truncate text-xs text-[var(--color-ink-faint)]">{c.sector}</div> : null}
                </div>
              </div>
              {c.description ? <p className="mt-2 line-clamp-2 text-xs text-[var(--color-ink-muted)]">{c.description}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ${c.hasGuide ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-faint)]"}`}>
                  <BookOpen className="size-3" /> {c.hasGuide ? "Editing Guide" : "Geen guide"}
                </span>
                {c.richtlijnenCount > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-info-soft)] px-2 py-0.5 text-2xs font-medium text-[#0060a8]">{c.richtlijnenCount} richtlijn{c.richtlijnenCount === 1 ? "" : "en"}</span> : null}
                {c.docsCount > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-2xs font-medium text-[var(--color-ink-muted)]"><FileText className="size-3" /> {c.docsCount}</span> : null}
              </div>
              {fmtDate(c.lastUpdated) ? <div className="mt-2 text-2xs text-[var(--color-ink-faint)]">Laatst bijgewerkt {fmtDate(c.lastUpdated)}</div> : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
