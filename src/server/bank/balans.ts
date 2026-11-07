import { sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { boekhoudBalansen } from "../../db/schema";
import type { XlsxSheet } from "../../lib/xlsx";

/**
 * Leest het blad "Balans" (en desgewenst "Winst- en verliesrekening") uit een
 * DigiBoox-export en bewaart een momentopname. Alleen data; verzint niets.
 * Geen `server-only`: ook gebruikt door het importscript.
 */

export type BalansRegel = { code: string; label: string; begin: number | null; eind: number | null };
export type BalansParse = { periode: string; regels: BalansRegel[]; winstVerlies: Record<string, number> | null };

const num = (s: string | undefined): number | null => {
  if (s == null || String(s).trim() === "") return null;
  let v = String(s).replace(/[€\s]/g, "");
  if (v.includes(",") && v.includes(".")) v = v.replace(/\./g, "").replace(",", ".");
  else if (v.includes(",")) v = v.replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseBalans(sheets: XlsxSheet[]): BalansParse | null {
  const all = (s: XlsxSheet) => s.rows.map((r) => r.map((c) => (c ?? "").trim()));
  const balans = sheets.find((s) => all(s).some((r) => r.some((c) => c === "Balans")) && all(s).some((r) => r.some((c) => /^1300 /.test(c) || /^1004 /.test(c))));
  if (!balans) return null;
  let periode = "";
  const regels: BalansRegel[] = [];
  for (const r of all(balans)) {
    const cells = r.filter(Boolean);
    if (!periode) {
      const p = cells.find((c) => /\d{2}-\d{2}-\d{4}\s*-\s*\d{2}-\d{2}-\d{4}/.test(c));
      if (p) periode = p;
    }
    const lab = cells[0] ?? "";
    const m = /^(\d{4})\s+(.+)$/.exec(lab);
    if (!m) continue;
    const nums = cells.slice(1).map(num).filter((n): n is number => n != null);
    regels.push({ code: m[1]!, label: m[2]!, begin: nums.length >= 2 ? nums[0]! : null, eind: nums.length ? nums.at(-1)! : null });
  }
  let winstVerlies: Record<string, number> | null = null;
  const wv = sheets.find((s) => all(s).some((r) => r.some((c) => c === "Winst- en verliesrekening")));
  if (wv) {
    winstVerlies = {};
    for (const r of all(wv)) {
      const cells = r.filter(Boolean);
      const lab = cells[0] ?? "";
      const v = num(cells.at(-1));
      if (/^\d{4} /.test(lab) && v != null) winstVerlies[lab] = v;
      if ((lab === "Winst" || lab === "Verlies") && v != null) winstVerlies[lab] = v;
    }
  }
  return regels.length ? { periode, regels, winstVerlies } : null;
}

export async function saveBalans(db: Db, bestand: string, b: BalansParse, peildatum = new Date().toISOString().slice(0, 10)) {
  await db
    .insert(boekhoudBalansen)
    .values({ peildatum, periode: b.periode.slice(0, 60), regels: b.regels, winstVerlies: b.winstVerlies, bronbestand: bestand.slice(0, 300) })
    .onConflictDoUpdate({
      target: boekhoudBalansen.peildatum,
      set: { periode: b.periode.slice(0, 60), regels: b.regels, winstVerlies: b.winstVerlies, bronbestand: bestand.slice(0, 300), importedAt: sql`now()`, updatedAt: sql`now()` },
    });
}
