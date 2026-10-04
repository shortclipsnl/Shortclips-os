"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Hit = {
  kind: string;
  kindLabel: string;
  title: string;
  subtitle?: string | null;
  href: string;
  clientName?: string | null;
};

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Zoeken met vertraging, zodat er niet bij elke toetsaanslag een query loopt.
  useEffect(() => {
    // Te korte invoer: niets ophalen. De resultaten worden hieronder toch niet
    // getoond, dus er hoeft ook geen state gewist te worden.
    if (query.trim().length < 2) return;

    const controller = new AbortController();
    // Laden pas markeren wanneer het verzoek daadwerkelijk vertrekt: dat
    // voorkomt een extra render bij elke toetsaanslag.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setHits(data.hits ?? []);
        setActive(0);
      } catch {
        /* afgebroken zoekopdracht: negeren */
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Cmd/Ctrl-K opent de zoekbalk vanaf elke pagina.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(hit: Hit) {
    setOpen(false);
    setQuery("");
    if (hit.href.startsWith("http")) window.open(hit.href, "_blank", "noopener");
    else router.push(hit.href);
  }

  const hasQuery = query.trim().length >= 2;
  const visibleHits = hasQuery ? hits : [];

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, visibleHits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && visibleHits[active]) {
              e.preventDefault();
              go(visibleHits[active]);
            }
          }}
          placeholder="Zoek klanten, video's, scripts, bestanden, opmerkingen…"
          className="sc-input pr-16 pl-9"
          aria-label="Zoeken"
          role="combobox"
          aria-expanded={open}
          aria-controls="sc-search-results"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-[var(--color-line-strong)] px-1.5 py-0.5 text-2xs text-[var(--color-ink-faint)]">
          ⌘K
        </kbd>
      </div>

      {open && hasQuery ? (
        <div
          id="sc-search-results"
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
        >
          {loading && visibleHits.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-3 text-sm text-[var(--color-ink-muted)]">
              <Loader2 className="size-4 animate-spin" /> Zoeken…
            </p>
          ) : visibleHits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">
              Niets gevonden voor “{query}”.
            </p>
          ) : (
            <ul className="py-1">
              {visibleHits.map((hit, i) => (
                <li key={`${hit.kind}-${hit.href}-${i}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(hit)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left",
                      i === active && "bg-[var(--color-surface-sunken)]",
                    )}
                  >
                    <span className="w-24 shrink-0 text-2xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
                      {hit.kindLabel}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--color-ink)]">
                        {hit.title}
                      </span>
                      {hit.subtitle || hit.clientName ? (
                        <span className="block truncate text-xs text-[var(--color-ink-muted)]">
                          {[hit.clientName, hit.subtitle].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
