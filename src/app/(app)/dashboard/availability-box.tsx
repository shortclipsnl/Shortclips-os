"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { setMyAvailabilityPeriods } from "@/server/actions/availability";
import { describePeriod, type AvailabilityPeriod } from "@/lib/availability";

type RowMode = "dag" | "periode" | "terugkerend";

type Row = AvailabilityPeriod & { mode: RowMode };

function newId() {
  try { return crypto.randomUUID(); } catch { return `r${Math.random().toString(36).slice(2)}`; }
}

function toRow(p: AvailabilityPeriod): Row {
  const mode: RowMode = p.from ? (p.to && p.to !== p.from ? "periode" : "dag") : "terugkerend";
  return { ...p, mode };
}

/**
 * Beschikbaarheidskaart op Vandaag: hier geef je per periode aan wanneer je
 * (on)beschikbaar bent. Elke regel toont direct de bijbehorende datum of periode,
 * zodat voor het team en voor jezelf meteen duidelijk is waarvoor het geldt.
 */
export function AvailabilityBox({ note, periods }: { note: string | null; periods: AvailabilityPeriod[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);

  const initialRows = useMemo<Row[]>(() => (periods ?? []).map(toRow), [periods]);
  const [rows, setRows] = useState<Row[]>(initialRows);

  // Legacy: oude vrije notitie zonder gestructureerde periodes — tonen we als
  // losse regels zodat niets verloren gaat, met de knop om over te stappen.
  const legacyLines = (note ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const hasStructured = (periods ?? []).length > 0;
  const count = periods?.length ?? 0;

  function openEdit() {
    // Bij een lege, maar wel bestaande vrije notitie: elke regel als terugkerend item overnemen.
    const seed: Row[] = hasStructured
      ? (periods ?? []).map(toRow)
      : legacyLines.map((line) => ({ id: newId(), from: null, to: null, label: line, note: "niet beschikbaar", mode: "terugkerend" as RowMode }));
    setRows(seed.length ? seed : [{ id: newId(), from: null, to: null, label: null, note: "niet beschikbaar", mode: "dag" }]);
    setEditing(true);
  }

  function update(id: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function setMode(id: string, mode: RowMode) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, mode, from: mode === "terugkerend" ? null : r.from, to: mode === "periode" ? r.to : null, label: mode === "terugkerend" ? r.label : null } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { id: newId(), from: null, to: null, label: null, note: "niet beschikbaar", mode: "dag" }]);
  }
  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  function save() {
    const payload: AvailabilityPeriod[] = rows
      .map((r) => ({
        id: r.id,
        from: r.mode === "terugkerend" ? null : r.from,
        to: r.mode === "periode" ? r.to : null,
        label: r.mode === "terugkerend" ? (r.label?.trim() || null) : null,
        note: r.note?.trim() ?? "",
      }))
      // Lege rijen (geen datum, geen omschrijving, geen notitie) laten vallen.
      .filter((r) => r.from || r.label || r.note);
    start(async () => {
      await setMyAvailabilityPeriods(payload);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)]">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <CalendarOff className="size-4 text-[var(--color-warn)]" />
        <h2 className="text-sm font-bold tracking-tight">Mijn beschikbaarheid</h2>
        {count > 0 || legacyLines.length > 0 ? (
          <span className="rounded-full bg-[var(--color-warn-soft)] px-2.5 py-0.5 text-2xs font-bold text-[#8a5300]">
            {Math.max(count, legacyLines.length)} moment{Math.max(count, legacyLines.length) === 1 ? "" : "en"} genoteerd
          </span>
        ) : (
          <span className="rounded-full bg-[var(--color-good-soft)] px-2.5 py-0.5 text-2xs font-bold text-[#1d6b4c]">Volledig beschikbaar</span>
        )}
        {!editing ? (
          <button type="button" onClick={openEdit} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline">
            <Pencil className="size-3.5" /> Aanpassen
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-[var(--color-ink-muted)]">
        Geef per periode aan wanneer je er <strong>niet</strong> bent. Kies een losse dag, een periode (van–tot) of een
        terugkerend moment; bij iedere regel staat meteen voor welke datum of periode het geldt.
      </p>

      {editing ? (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="sc-input h-8 w-32 py-0 text-xs"
                  value={r.mode}
                  onChange={(e) => setMode(r.id, e.target.value as RowMode)}
                  aria-label="Soort periode"
                >
                  <option value="dag">Losse dag</option>
                  <option value="periode">Periode</option>
                  <option value="terugkerend">Terugkerend</option>
                </select>

                {r.mode === "terugkerend" ? (
                  <input
                    className="sc-input h-8 min-w-40 flex-1 py-0 text-xs"
                    placeholder="Bijv. woensdagmiddagen"
                    value={r.label ?? ""}
                    onChange={(e) => update(r.id, { label: e.target.value })}
                    aria-label="Terugkerende periode"
                  />
                ) : (
                  <>
                    <input
                      className="sc-input h-8 w-36 py-0 text-xs"
                      type="date"
                      value={r.from ?? ""}
                      onChange={(e) => update(r.id, { from: e.target.value || null })}
                      aria-label={r.mode === "periode" ? "Van" : "Datum"}
                    />
                    {r.mode === "periode" ? (
                      <>
                        <span className="text-xs text-[var(--color-ink-faint)]">t/m</span>
                        <input
                          className="sc-input h-8 w-36 py-0 text-xs"
                          type="date"
                          min={r.from ?? undefined}
                          value={r.to ?? ""}
                          onChange={(e) => update(r.id, { to: e.target.value || null })}
                          aria-label="Tot en met"
                        />
                      </>
                    ) : null}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  className="ml-auto shrink-0 rounded p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface)] hover:text-[var(--color-bad)]"
                  aria-label="Regel verwijderen"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="sc-input h-8 min-w-48 flex-1 py-0 text-xs"
                  placeholder="Wat geldt er? Bijv. niet beschikbaar / alleen ochtend"
                  value={r.note}
                  onChange={(e) => update(r.id, { note: e.target.value })}
                  aria-label="Wat geldt er"
                />
                {/* Directe terugkoppeling: voor welke periode geldt deze regel. */}
                <span className="shrink-0 rounded-full bg-[var(--color-surface)] px-2.5 py-1 text-2xs font-semibold text-[var(--color-ink)] ring-1 ring-[var(--color-line)]">
                  {describePeriod(r)}
                </span>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]"
          >
            <Plus className="size-3.5" /> Periode toevoegen
          </button>

          <div className="mt-1 flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setRows(initialRows); setEditing(false); }} className="text-xs text-[var(--color-ink-muted)]">Annuleren</button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-ink)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Opslaan
            </button>
          </div>
        </div>
      ) : hasStructured ? (
        <ul className="space-y-1.5">
          {(periods ?? []).map((p) => (
            <li key={p.id} className="flex items-start gap-2.5 text-sm text-[var(--color-ink)]">
              <span className="mt-0.5 shrink-0 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-2xs font-semibold text-[#8a5300]">{describePeriod(p)}</span>
              <span className="min-w-0">{p.note || "niet beschikbaar"}</span>
            </li>
          ))}
        </ul>
      ) : legacyLines.length > 0 ? (
        <ul className="space-y-1.5">
          {legacyLines.map((it, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--color-ink)]">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--color-warn)]" />
              <span className="min-w-0">{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-ink-muted)]">Je staat als <strong className="text-[var(--color-ink)]">volledig beschikbaar</strong>. Geef via &ldquo;Aanpassen&rdquo; per periode door wanneer je er niet bent.</p>
      )}
    </div>
  );
}
