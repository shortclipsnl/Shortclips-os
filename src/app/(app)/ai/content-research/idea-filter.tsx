import Link from "next/link";

const OPTIONS: Array<{ key: string; label: string }> = [
  { key: "alle", label: "Alle open" },
  { key: "open", label: "Nieuw" },
  { key: "interessant", label: "Interessant" },
  { key: "later", label: "Bewaard voor later" },
  { key: "doorgestuurd", label: "Doorgestuurd" },
  { key: "archief", label: "Archief" },
];

/** Statusfilter als links: deelbaar en werkt zonder client-state. */
export function IdeaFilter({ current, counts }: { current: string; counts: Record<string, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {OPTIONS.map((o) => {
        const active = current === o.key;
        return (
          <Link
            key={o.key}
            href={`?tab=ideeen${o.key === "alle" ? "" : `&filter=${o.key}`}`}
            scroll={false}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${active ? "bg-[var(--color-indigo-ink)] text-white" : "border border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
          >
            {o.label}
            <span className={`rounded-full px-1.5 text-2xs tabular-nums ${active ? "bg-white/20" : "bg-[var(--color-neutral-soft)]"}`}>{counts[o.key] ?? 0}</span>
          </Link>
        );
      })}
    </div>
  );
}
