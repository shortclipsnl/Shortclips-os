"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge, Card } from "@/components/ui";

export type HistoryRow = {
  id: string;
  tool: string;
  toolLabel: string;
  title: string;
  clientName: string;
  createdAt: string;
  href: string;
};

const TOOLS = [
  { key: "", label: "Alles" },
  { key: "caption", label: "Captions" },
  { key: "briefing", label: "Briefings" },
  { key: "message", label: "Klantberichten" },
  { key: "research", label: "Bedrijfsonderzoek" },
];

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  const [q, setQ] = useState("");
  const [tool, setTool] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!tool || r.tool === tool) &&
        (!term || r.title.toLowerCase().includes(term) || r.clientName.toLowerCase().includes(term)),
    );
  }, [rows, q, tool]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 md:min-w-64">
          <Search className="size-4 text-[var(--color-ink-faint)]" />
          <input className="w-full bg-transparent text-sm outline-none" placeholder="Zoek op titel of klant…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTool(t.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${tool === t.key ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><p className="text-sm text-[var(--color-ink-muted)]">Niets gevonden. Gegenereerde resultaten verschijnen hier automatisch.</p></Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-[var(--color-line)]">
            {filtered.map((r) => (
              <li key={`${r.tool}-${r.id}`}>
                <Link href={r.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-2)]">
                  <span className="flex min-w-0 items-center gap-3">
                    <Badge tone="info">{r.toolLabel}</Badge>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-muted)]">{r.clientName}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">
                    {new Date(r.createdAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
