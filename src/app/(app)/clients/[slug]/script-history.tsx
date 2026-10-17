"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, CheckCircle2, MessageSquare, FileText, ExternalLink, Camera } from "lucide-react";
import { Badge, Card, EmptyState } from "@/components/ui";
import { SCRIPT_STATUS } from "@/lib/statuses";
import { formatDate } from "@/lib/format";
import type { ClientHub } from "@/server/clients";

type Script = ClientHub["scripts"][number];
type FileRow = ClientHub["files"][number];

function fmt(d: string | Date | null) {
  if (!d) return null;
  const iso = typeof d === "string" ? d : d.toISOString();
  return formatDate(iso);
}

/**
 * Scriptgeschiedenis per klant (§4): alle eerdere scripts, gegroepeerd per
 * opname/sessie, met hook/invalshoek, status, goedkeuring, versie en feedback.
 * Zoek-/filterbaar. Toont ook de scriptbestanden uit de Google Drive-map
 * "Scripts" zodat oude scripts niet handmatig opnieuw hoeven. Geen verzonnen
 * data — alleen wat in de scriptingmodule en Drive staat.
 */
export function ScriptHistory({ scripts, driveScripts, intelligenceHref }: {
  scripts: Script[];
  driveScripts: FileRow[];
  intelligenceHref: string | null;
}) {
  const [q, setQ] = useState("");
  const [pillar, setPillar] = useState("alle");
  const [format, setFormat] = useState("alle");
  const [status, setStatus] = useState("alle");
  const [approvedOnly, setApprovedOnly] = useState(false);

  const pillars = useMemo(() => [...new Set(scripts.map((s) => s.pillar).filter(Boolean))].sort() as string[], [scripts]);
  const formats = useMemo(() => [...new Set(scripts.map((s) => s.format).filter(Boolean))].sort() as string[], [scripts]);
  const statuses = useMemo(() => [...new Set(scripts.map((s) => s.status))], [scripts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scripts.filter((s) => {
      if (pillar !== "alle" && s.pillar !== pillar) return false;
      if (format !== "alle" && s.format !== format) return false;
      if (status !== "alle" && s.status !== status) return false;
      if (approvedOnly && !s.approvedAt) return false;
      if (needle) {
        const hay = `${s.title} ${s.hook ?? ""} ${s.pillar ?? ""} ${s.format ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [scripts, q, pillar, format, status, approvedOnly]);

  // Groeperen per opname (productionDayId). Scripts zonder opname onderaan.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; shootOn: string | null; shootTitle: string | null; items: Script[] }>();
    for (const s of filtered) {
      const key = s.productionDayId ?? "geen";
      let g = map.get(key);
      if (!g) { g = { key, shootOn: s.shootOn, shootTitle: s.shootTitle, items: [] }; map.set(key, g); }
      g.items.push(s);
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === "geen") return 1;
      if (b.key === "geen") return -1;
      return (b.shootOn ?? "").localeCompare(a.shootOn ?? "");
    });
  }, [filtered]);

  const selectCls = "sc-input h-8 w-auto py-0 text-xs";

  return (
    <div className="space-y-3">
      {/* Filterbalk */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-ink-faint)]" />
          <input className="sc-input h-8 w-52 py-0 pl-7 text-xs" placeholder="Zoek op onderwerp of hook…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {pillars.length > 0 ? (
          <select className={selectCls} value={pillar} onChange={(e) => setPillar(e.target.value)} aria-label="Pijler">
            <option value="alle">Alle pijlers</option>
            {pillars.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : null}
        {formats.length > 0 ? (
          <select className={selectCls} value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Format">
            <option value="alle">Alle formats</option>
            {formats.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        ) : null}
        <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="alle">Alle statussen</option>
          {statuses.map((s) => <option key={s} value={s}>{SCRIPT_STATUS[s]?.label ?? s}</option>)}
        </select>
        <button type="button" onClick={() => setApprovedOnly((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${approvedOnly ? "bg-[var(--color-good)] text-white" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]"}`}>
          <CheckCircle2 className="size-3.5" /> Alleen goedgekeurd
        </button>
        {intelligenceHref ? (
          <Link href={intelligenceHref} className="ml-auto text-xs font-medium text-[var(--color-brand-600)] hover:underline">
            Welke invalshoeken presteren het best? →
          </Link>
        ) : null}
      </div>

      <p className="text-2xs text-[var(--color-ink-faint)]">{filtered.length} van {scripts.length} scripts</p>

      {groups.length === 0 ? (
        <Card><EmptyState title="Geen scripts met deze filters" /></Card>
      ) : (
        groups.map((g) => (
          <Card key={g.key} padded={false}>
            <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-2.5">
              <Camera className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
              <span className="text-sm font-semibold">
                {g.key === "geen" ? "Zonder opname gekoppeld" : `Opname ${fmt(g.shootOn) ?? "—"}`}
              </span>
              {g.key !== "geen" && g.shootTitle ? <span className="truncate text-xs text-[var(--color-ink-muted)]">· {g.shootTitle}</span> : null}
              <span className="ml-auto shrink-0 text-2xs text-[var(--color-ink-faint)]">{g.items.length} script{g.items.length === 1 ? "" : "s"}</span>
            </div>
            <ul className="divide-y divide-[var(--color-line)]">
              {g.items.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/scripts/${s.id}`} className="font-medium hover:underline">{s.title}</Link>
                      {s.hook ? <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-ink-muted)]">“{s.hook}”</p> : null}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {s.pillar ? <Badge tone="info">{s.pillar}</Badge> : null}
                        {s.format ? <Badge tone="neutral">{s.format}</Badge> : null}
                        {s.currentVersion > 1 ? <span className="text-2xs text-[var(--color-ink-faint)]">v{s.currentVersion}</span> : null}
                        {s.clientNotes && s.clientNotes.trim() ? (
                          <span className="inline-flex items-center gap-1 text-2xs text-[var(--color-warn)]" title={s.clientNotes}>
                            <MessageSquare className="size-3" /> klantfeedback
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={SCRIPT_STATUS[s.status]?.tone ?? "neutral"}>{SCRIPT_STATUS[s.status]?.label ?? s.status}</Badge>
                      {s.approvedAt ? (
                        <span className="inline-flex items-center gap-1 text-2xs font-medium text-[var(--color-good)]">
                          <CheckCircle2 className="size-3" /> goedgekeurd {fmt(s.approvedAt)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      {/* Oude scripts uit Google Drive (map "Scripts") */}
      {driveScripts.length > 0 ? (
        <Card padded={false}>
          <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-2.5">
            <FileText className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
            <span className="text-sm font-semibold">Scriptbestanden uit Google Drive</span>
            <span className="ml-auto shrink-0 text-2xs text-[var(--color-ink-faint)]">{driveScripts.length}</span>
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {driveScripts.map((f) => (
              <li key={f.id}>
                <a href={f.externalUrl ?? "#"} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-[var(--color-surface-sunken)]">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {f.modifiedAt ? <span className="shrink-0 text-2xs text-[var(--color-ink-faint)]">{fmt(f.modifiedAt as string | Date)}</span> : null}
                  <ExternalLink className="size-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
