import Link from "next/link";
import { CLIENT_STATUS_FILTERS, type ClientStatusFilter } from "@/lib/client-status";

/**
 * Filter op operationele pagina's: standaard alleen actieve klanten, met de
 * mogelijkheid om niet actieve of alle klanten te bekijken. Historische
 * informatie blijft zo bereikbaar, zonder dat niet actieve klanten het
 * dagelijkse werk vervuilen. Bekijken start nooit nieuwe werkzaamheden.
 */
export function ClientStatusTabs({
  basePath,
  current,
  params = {},
  counts,
}: {
  basePath: string;
  current: ClientStatusFilter;
  /** Overige queryparameters die behouden moeten blijven. */
  params?: Record<string, string | undefined>;
  counts?: Partial<Record<ClientStatusFilter, number>>;
}) {
  const href = (value: ClientStatusFilter) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "klanten") q.set(k, v);
    if (value !== "actief") q.set("klanten", value);
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Filter op klantstatus">
      {CLIENT_STATUS_FILTERS.map((f) => (
        <Link
          key={f.value}
          href={href(f.value)}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${current === f.value ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-surface)] text-[var(--color-ink-muted)] ring-1 ring-[var(--color-line)] hover:text-[var(--color-ink)]"}`}
        >
          {f.label}
          {counts?.[f.value] != null ? <span className="ml-1 tabular-nums opacity-70">{counts[f.value]}</span> : null}
        </Link>
      ))}
    </div>
  );
}
