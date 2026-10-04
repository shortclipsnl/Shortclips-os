"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";

export function ViewSwitch({
  options,
  param,
  fallback,
}: {
  options: Array<{ value: string; label: string }>;
  param: string;
  fallback: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(param) ?? fallback;

  function hrefFor(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === fallback) next.delete(param);
    else next.set(param, value);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-0.5">
      {options.map((o) => (
        <Link
          key={o.value}
          href={hrefFor(o.value)}
          className={cn(
            "rounded-[4px] px-3 py-1.5 text-xs font-medium transition-colors",
            current === o.value
              ? "bg-[var(--color-indigo-ink)] text-white"
              : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}
