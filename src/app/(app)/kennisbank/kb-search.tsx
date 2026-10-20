"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Search, Loader2, ArrowRight } from "lucide-react";
import { searchKennisbankLessons } from "@/server/actions/kennisbank";
import type { KbSearchHit } from "@/server/kennisbank";

/**
 * Zoekbalk bovenaan de kennisbank: typ een vraag of trefwoord en zie meteen de
 * lessen (met korte tekstfragment) waar het antwoord in staat. Zoekt in zowel de
 * lestitels als de lesinhoud via de bestaande searchKennisbank-logica, met een
 * kleine vertraging zodat het pas zoekt als je even stopt met typen.
 */
export function KbSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<KbSearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const id = setTimeout(() => {
      start(async () => {
        const res = await searchKennisbankLessons(query);
        if (cancelled) return;
        setHits(res);
        setSearched(true);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q]);

  const active = q.trim().length >= 2;

  return (
    <div className="mb-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--color-ink-faint)]" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek in de kennisbank — bijv. 'onboarding', 'facturatie', 'editing'…"
          aria-label="Zoek in de kennisbank"
          className="h-12 w-full rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] pl-12 pr-11 text-sm text-[var(--color-ink)] outline-none transition focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-500)]/25"
        />
        {pending ? (
          <Loader2 className="absolute right-4 top-1/2 size-5 -translate-y-1/2 animate-spin text-[var(--color-ink-faint)]" />
        ) : null}
      </div>

      {active ? (
        <div className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-sm">
          {hits.length === 0 ? (
            <p className="px-4 py-4 text-sm text-[var(--color-ink-muted)]">
              {searched ? "Niets gevonden. Probeer andere woorden." : "Zoeken…"}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {hits.map((h) => (
                <li key={h.lessonId}>
                  <Link
                    href={`/kennisbank/${h.courseId}?les=${h.lessonId}`}
                    className="group flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-sunken)]/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--color-ink)]">{h.lessonTitle}</span>
                        <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-2xs font-medium text-[var(--color-ink-muted)]">
                          {h.courseTitle}
                        </span>
                      </span>
                      {h.snippet ? (
                        <span className="mt-0.5 block line-clamp-2 text-xs text-[var(--color-ink-muted)]">{h.snippet}</span>
                      ) : null}
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-[var(--color-ink-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--color-brand-600)]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
