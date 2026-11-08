"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { refreshBriefing, saveBriefingOverrides } from "@/server/actions/briefing";
import type { GuideHighlight } from "@/server/briefing/guide-highlights";

/**
 * Beheer voor Team Shortclips (editors zien dit niet). Bewust klein: bijwerken,
 * highlights corrigeren en het omslagbeeld kiezen. Scripts, links en deadlines
 * pas je aan bij de bron; de briefing volgt dan vanzelf.
 */
export function BriefingTeamPanel(props: {
  productionDayId: string;
  highlights: GuideHighlight[];
  corrected: boolean;
  stills: Array<{ id: string; name: string }>;
  coverAssetId: string | null;
  hasBriefing: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<GuideHighlight[]>(props.highlights);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.message ?? (r.ok ? "Opgeslagen." : "Mislukt."));
      if (r.ok) {
        setEditing(false);
        router.refresh();
      }
    });

  const set = (i: number, patch: Partial<GuideHighlight>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Team Shortclips</span>
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => refreshBriefing(props.productionDayId))}>
          <RefreshCw className="size-3.5" /> Nu bijwerken
        </Button>
        {props.hasBriefing ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setEditing((e) => !e)}>
            <Pencil className="size-3.5" /> Highlights corrigeren
          </Button>
        ) : null}
        {props.stills.length > 1 ? (
          <label className="ml-auto flex items-center gap-1.5 text-2xs text-[var(--color-ink-muted)]">
            Omslagbeeld
            <select
              className="max-w-[220px] rounded border border-[var(--color-line)] bg-transparent px-1.5 py-1 text-2xs"
              defaultValue={props.coverAssetId ?? ""}
              disabled={pending}
              onChange={(e) => run(() => saveBriefingOverrides({ productionDayId: props.productionDayId, coverAssetId: e.target.value || null }))}
            >
              {props.stills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {msg ? <p className="mt-2 text-2xs text-[var(--color-ink-muted)]">{msg}</p> : null}

      {editing ? (
        <div className="mt-3 space-y-2">
          <p className="text-2xs text-[var(--color-ink-muted)]">
            Max. 7 regels. Neem klantafspraken over zoals ze in de Editing Guide staan. Een correctie blijft staan bij automatische updates.
          </p>
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input value={r.categorie} onChange={(e) => set(i, { categorie: e.target.value })} className="w-28 rounded border border-[var(--color-line)] bg-transparent px-2 py-1 text-xs" />
              <input value={r.tekst} onChange={(e) => set(i, { tekst: e.target.value })} className="min-w-[240px] flex-1 rounded border border-[var(--color-line)] bg-transparent px-2 py-1 text-xs" />
              <label className="flex items-center gap-1 text-2xs"><input type="checkbox" checked={r.niet} onChange={(e) => set(i, { niet: e.target.checked })} /> Niet</label>
              <label className="flex items-center gap-1 text-2xs"><input type="checkbox" checked={r.kritiek} onChange={(e) => set(i, { kritiek: e.target.checked })} /> Klantafspraak</label>
              <button type="button" className="text-2xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                Verwijderen
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {rows.length < 7 ? (
              <Button size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { categorie: "", tekst: "", niet: false, kritiek: false }])}>
                Regel toevoegen
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => saveBriefingOverrides({ productionDayId: props.productionDayId, highlights: rows.filter((r) => r.tekst.trim() && r.categorie.trim()) }))}
            >
              Opslaan
            </Button>
            {props.corrected ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => saveBriefingOverrides({ productionDayId: props.productionDayId, highlights: null }))}>
                Terug naar automatisch
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
