"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

export type TabDef = { key: string; label: string; count?: number };

export function ClientTabs({ tabs }: { tabs: TabDef[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("tab") ?? tabs[0]!.key;

  return (
    <div className="-mx-1 mb-5 overflow-x-auto border-b border-[var(--color-line)]">
      <nav className="flex min-w-max gap-1 px-1" aria-label="Klantonderdelen">
        {tabs.map((tab) => {
          const active = current === tab.key;
          return (
            <Link
              key={tab.key}
              href={`${pathname}?tab=${tab.key}`}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "border-[var(--color-brand-500)] text-[var(--color-ink)]"
                  : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums",
                    active
                      ? "bg-[var(--color-brand-500)] text-white"
                      : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
