import "server-only";
import type { XlsxSheet } from "@/lib/xlsx";

/**
 * Herkent de twee relevante Digiboox-exports en zet ze om naar maand- en
 * jaarcijfers die de Financiën-module kan invullen:
 *  - "Mutaties": omzet (Opbrengsten), kosten en financiële baten per maand.
 *  - "Winst- en verliesrekening": de jaartotalen (omzet, kosten, resultaat).
 * De bestanden zijn niet-vertrouwde downloads: we lezen ze als data en
 * verzinnen nooit getallen — ontbreekt iets, dan blijft het 0 en loggen we een
 * waarschuwing.
 */

export type DigibooxMonth = {
  period: string; // YYYY-MM
  revenue: number;
  cost: number;
  financeIncome: number;
};

export type DigibooxYear = {
  label: string;
  revenue: number;
  cost: number;
  financeIncome: number;
  result: number;
};

export type DigibooxParse = {
  kind: "mutaties" | "winstverlies" | "onbekend";
  months: DigibooxMonth[];
  year: DigibooxYear | null;
  warnings: string[];
};

const MONTHS: Record<string, string> = {
  januari: "01", februari: "02", maart: "03", april: "04", mei: "05", juni: "06",
  juli: "07", augustus: "08", september: "09", oktober: "10", november: "11", december: "12",
};

/** Robuuste getalconversie: accepteert "14436.52", "1.234,56" en "€ 1.234,56". */
function num(raw: string | undefined): number {
  if (!raw) return 0;
  let s = raw.replace(/[€\s]/g, "").trim();
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Europees: punt = duizendtal, komma = decimaal.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function monthHeaderToPeriod(cell: string): string | null {
  const m = /^([A-Za-zéëïü]+)\s+(\d{4})$/.exec(cell.trim());
  if (!m) return null;
  const mm = MONTHS[m[1]!.toLowerCase()];
  return mm ? `${m[2]}-${mm}` : null;
}

function label(row: string[]): string {
  // De eerste niet-lege cel is het label (Digiboox laat col 0 soms leeg).
  for (const c of row) if (c && c.trim()) return c.trim();
  return "";
}

function lastNumber(row: string[]): number {
  for (let i = row.length - 1; i >= 0; i--) {
    const v = row[i];
    if (v && /[0-9]/.test(v)) return num(v);
  }
  return 0;
}

export function parseDigiboox(sheets: XlsxSheet[]): DigibooxParse {
  const warnings: string[] = [];
  const monthMap = new Map<string, DigibooxMonth>();
  let year: DigibooxYear | null = null;
  let sawMutaties = false;
  let sawWinstVerlies = false;

  const getMonth = (period: string): DigibooxMonth => {
    let e = monthMap.get(period);
    if (!e) {
      e = { period, revenue: 0, cost: 0, financeIncome: 0 };
      monthMap.set(period, e);
    }
    return e;
  };

  for (const sheet of sheets) {
    const rows = sheet.rows;
    const flat = rows.map((r) => r.map((c) => (c ?? "").toLowerCase()));

    // --- Mutaties: zoek een rij met ≥2 maandkoppen ---
    let headerRow = -1;
    const colPeriod: (string | null)[] = [];
    for (let r = 0; r < rows.length; r++) {
      const periods = rows[r]!.map((c) => monthHeaderToPeriod(c || ""));
      const hits = periods.filter(Boolean).length;
      if (hits >= 2) {
        headerRow = r;
        for (let c = 0; c < periods.length; c++) colPeriod[c] = periods[c] ?? null;
        break;
      }
    }

    if (headerRow >= 0) {
      sawMutaties = true;
      for (let r = headerRow + 1; r < rows.length; r++) {
        const lab = label(rows[r]!).toLowerCase();
        if (!lab) continue;
        let field: keyof DigibooxMonth | null = null;
        if (lab.startsWith("opbrengst")) field = "revenue";
        else if (lab.startsWith("kosten")) field = "cost";
        else if (lab.startsWith("financiële baten") || lab.startsWith("financiele baten")) field = "financeIncome";
        if (!field) continue;
        for (let c = 0; c < rows[r]!.length; c++) {
          const period = colPeriod[c];
          if (!period) continue;
          const val = num(rows[r]![c]);
          if (val) (getMonth(period)[field] as number) += val;
        }
      }
      continue; // dit blad is afgehandeld
    }

    // --- Winst- en verliesrekening: jaartotalen ---
    const isWv = flat.some((r) => r.some((c) => c.includes("winst- en verliesrekening")));
    if (isWv) {
      sawWinstVerlies = true;
      let revenue = 0, cost = 0, fin = 0, result = 0;
      let periodLabel = "";
      for (const row of rows) {
        const lab = label(row).toLowerCase();
        const raw = label(row);
        if (/\d{2}-\d{2}-\d{4}\s*-\s*\d{2}-\d{2}-\d{4}/.test(raw) && !periodLabel) periodLabel = raw.trim();
        if (lab === "winst" || lab === "verlies") result = lastNumber(row);
        else if (lab === "opbrengsten" && !revenue) revenue = lastNumber(row);
        else if (lab === "kosten" && !cost) cost = lastNumber(row);
        else if ((lab === "financiële baten" || lab === "financiele baten") && !fin) fin = lastNumber(row);
      }
      // Eén W&V per boekhouding; latere bladen overschrijven niet als al gevuld.
      if (!year) year = { label: periodLabel || "Boekjaar", revenue, cost, financeIncome: fin, result };
    }
  }

  const months = [...monthMap.values()]
    .filter((m) => m.revenue || m.cost || m.financeIncome)
    .sort((a, b) => a.period.localeCompare(b.period));

  if (months.length === 0 && !year) {
    warnings.push("Geen herkenbare Digiboox-gegevens gevonden (verwacht een 'Mutaties'- of 'Winst- en verliesrekening'-export).");
  }

  return {
    kind: sawMutaties ? "mutaties" : sawWinstVerlies ? "winstverlies" : "onbekend",
    months,
    year,
    warnings,
  };
}
