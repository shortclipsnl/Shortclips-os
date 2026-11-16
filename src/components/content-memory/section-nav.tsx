"use client";

import { useEffect, useState } from "react";

export type SectionNavItem = { id: string; n: number; label: string; color: string };

/**
 * Vaste balk bovenaan het Contentgeheugen: de zeven onderdelen in hun eigen
 * kleur. Het onderdeel dat in beeld is licht op, klikken springt ernaartoe.
 */
export function SectionNav({ items }: { items: SectionNavItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : Number.POSITIVE_INFINITY);
        const visible = [...seen.entries()].filter(([, top]) => Number.isFinite(top)).sort((a, b) => a[1] - b[1]);
        if (visible[0]) setActive(visible[0][0]);
      },
      { rootMargin: "-140px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [items]);

  const go = (id: string) => (ev: React.MouseEvent) => {
    const el = document.getElementById(id);
    if (!el) return;
    ev.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
    setActive(id);
  };

  return (
    <nav aria-label="Onderdelen van het Contentgeheugen" className="sticky top-16 z-30 -mx-1 px-1 py-2">
      <div className="flex gap-1 overflow-x-auto rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)]/92 p-1 shadow-[0_4px_18px_rgba(0,0,40,.07)] backdrop-blur [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((i) => {
          const on = i.id === active;
          return (
            <a
              key={i.id}
              href={`#${i.id}`}
              onClick={go(i.id)}
              aria-current={on ? "true" : undefined}
              style={on ? { background: `color-mix(in srgb, ${i.color} 15%, var(--color-surface))`, color: `color-mix(in srgb, ${i.color} 70%, var(--color-ink))` } : undefined}
              className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[12.5px] transition-colors ${on ? "font-semibold" : "font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"}`}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: i.color }} aria-hidden />
              <span className="tabular-nums opacity-60">{String(i.n).padStart(2, "0")}</span>
              {i.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
