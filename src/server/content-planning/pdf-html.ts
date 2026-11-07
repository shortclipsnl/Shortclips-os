import "server-only";
import { FONT_LINK } from "@/server/reports/pdf-shared";
import { PLATFORM_ICON_PATHS } from "@/components/platform-icon";
import type { ChecklistState } from "@/lib/content-planning-status";
import { CP_CALENDAR_BG, CP_CLOSING_BG, CP_COVER_BG, CP_STATUS_BG } from "./assets";
import type { ContentPlanningOverview, PlanningPost } from "./overview";

/**
 * Contentplanning-PDF, exact volgens het voorbeeldbestand
 * "Contentplanning 2026 Shortclips" (16:9, 4 pagina-ontwerpen).
 *
 * De vier originele pagina's worden ongewijzigd als achtergrond gebruikt. Net
 * als in het PowerPoint-sjabloon komen alleen de variabele gegevens er als
 * tekst overheen, op dezelfde posities en in dezelfde stijl als de tekstvakken
 * in het origineel (Poppins, #3D84FF / #000036):
 *  - voorpagina en afsluiter: ongewijzigd;
 *  - kalender: jaar, maand, weeknummer en per dag 4 vakken (zoals het
 *    sjabloon); meer dan 4 video's op een dag → vervolgpagina van dezelfde week;
 *  - "Alles staat klaar.": de vier blokken krijgen hun echte status. Zijn ze
 *    allemaal klaar, dan is de pagina identiek aan het origineel.
 *
 * Coördinaten zijn in pixels van de originele afbeeldingen (3001×1689, dia 20×11,25 inch).
 */

const W = 3001;
const PT = W / 20 / 72; // 1 pt in afbeeldingspixels (dia is 20 inch breed)
/** Afbeeldingspixels → inch op de pagina (geen CSS-schaal: die verschuift bij printen). */
const u = (n: number) => `${((n * 20) / W).toFixed(4)}in`;
const NAVY = "#000036";
const ACCENT = "#3d84ff";

const MONTHS = ["JANUARI", "FEBRUARI", "MAART", "APRIL", "MEI", "JUNI", "JULI", "AUGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DECEMBER"];
const SLOTS = 4;

/** Dagkolommen (binnenkant) en de vier vakken per dag, gemeten in het sjabloon. */
const COLS: Array<[number, number]> = [[227, 531], [600, 904], [974, 1278], [1350, 1654], [1722, 2026], [2095, 2399], [2469, 2773]];
const ROWS: Array<[number, number]> = [[678, 871], [877, 1069], [1076, 1268], [1275, 1467]];

/** De vier statusbadges ("KLAAR") in het sjabloon. */
const BADGES: Array<[number, number]> = [[272, 690], [928, 690], [1584, 690], [2238, 690]];
const BADGE_W = 198;
const BADGE_H = 72;

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** ISO-week; jaar en maand volgen de donderdag van die week. */
function isoWeek(mondayIso: string): { week: number; year: number; month: number } {
  const d = new Date(`${addDays(mondayIso, 3)}T12:00:00Z`);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { week, year, month: d.getUTCMonth() };
}

function icon(platform: string, size: number): string {
  const p = PLATFORM_ICON_PATHS[platform];
  return p ? `<svg viewBox="0 0 24 24" width="${u(size)}" height="${u(size)}" fill="${NAVY}"><path d="${p.path}"/></svg>` : "";
}

const CSS = `
  @page { size: 20in 11.25in; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Poppins, Arial, sans-serif; }
  .page { width: 20in; height: 11.25in; position: relative; overflow: hidden; page-break-after: always; background: #00003b; }
  .page:last-child { page-break-after: auto; }
  .canvas { position: absolute; inset: 0; }
  .canvas > img.bg { position: absolute; left: 0; top: 0; width: 20in; height: 11.25in; }
  .tx { position: absolute; white-space: nowrap; line-height: 1.2; }
  .slot { position: absolute; padding: ${u(14)} ${u(16)}; overflow: hidden; display: flex; flex-direction: column; color: ${NAVY}; }
  .slot .t { font-size: ${u(11 * PT)}; font-weight: 700; color: ${ACCENT}; line-height: 1.15; }
  .slot .n { font-size: ${u(12.5 * PT)}; font-weight: 600; line-height: 1.22; margin-top: ${u(4)}; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .slot .p { display: flex; gap: ${u(8)}; margin-top: auto; align-items: center; }
  .cover { position: absolute; background: #0f0f47; border-radius: ${u(40)}; }
  .badge { position: absolute; height: ${u(BADGE_H)}; border-radius: ${u(BADGE_H / 2)}; display: flex; align-items: center; padding: 0 ${u(28)};
           font-size: ${u(14 * PT)}; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
  .b-preparing { background: rgba(255,255,255,.10); color: #c9c9dc; }
  .b-action { background: rgba(255,154,60,.20); color: #ffb067; }
  .b-na { background: transparent; color: #8a8aa6; border: ${u(3)} dashed #4a4a78; }
`;

const LABEL: Record<Exclude<ChecklistState, "done">, string> = { preparing: "IN VOORBEREIDING", action: "ACTIE NODIG", na: "N.V.T." };

function page(bg: string, overlay = "", kind = ""): string {
  return `<section class="page"${kind ? ` data-page="${kind}"` : ""}><div class="canvas"><img class="bg" src="${bg}" alt="" />${overlay}</div></section>`;
}

function slot(p: PlanningPost, col: number, row: number): string {
  const [x1, x2] = COLS[col]!;
  const [y1, y2] = ROWS[row]!;
  return `<div class="slot" style="left:${u(x1)};top:${u(y1)};width:${u(x2 - x1)};height:${u(y2 - y1)}">
    ${p.scheduledAt ? `<div class="t">${esc(p.scheduledAt)} uur</div>` : ""}
    <div class="n">${esc(p.title)}</div>
    <div class="p">${p.platforms.map((pl) => icon(pl, 24)).join("")}</div>
  </div>`;
}

function calendarPages(o: ContentPlanningOverview): string[] {
  const byWeek = new Map<string, PlanningPost[]>();
  for (const p of o.posts) {
    const d = new Date(`${p.scheduledOn}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const k = d.toISOString().slice(0, 10);
    (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(p);
  }
  const mondays = [...byWeek.keys()].sort();
  if (mondays.length === 0) mondays.push(o.fromMonday); // lege planning: één lege kalender, niets verzonnen
  const out: string[] = [];
  for (const m of mondays) {
    const { week, year, month } = isoWeek(m);
    const days = Array.from({ length: 7 }, (_, i) => (byWeek.get(m) ?? []).filter((p) => p.scheduledOn === addDays(m, i)));
    const parts = Math.max(1, ...days.map((d) => Math.ceil(d.length / SLOTS)));
    for (let part = 0; part < parts; part++) {
      const head = `
        <div class="tx" style="left:${u(219)};top:${u(218)};font-size:${u(28 * PT)};font-weight:700;color:${ACCENT}">${year}</div>
        <div class="tx" style="left:${u(1338)};top:${u(326)};width:${u(385)};text-align:center;font-size:${u(22 * PT)};font-weight:700;color:${ACCENT}">${MONTHS[month]}</div>
        <div class="tx" style="left:${u(2573)};top:${u(296)};width:${u(209)};text-align:right;font-size:${u(40 * PT)};font-weight:700;color:${NAVY}">${String(week).padStart(2, "0")}</div>`;
      const slots = days.flatMap((list, col) => list.slice(part * SLOTS, (part + 1) * SLOTS).map((p, row) => slot(p, col, row))).join("");
      out.push(page(CP_CALENDAR_BG, head + slots, "kalender"));
    }
  }
  return out;
}

function statusPage(o: ContentPlanningOverview): string {
  const states = o.pdfCards;
  const allDone = states.every((s) => s === "done");
  let overlay = "";
  states.forEach((s, i) => {
    if (s === "done") return; // origineel "KLAAR" blijft staan
    const [x, y] = BADGES[i]!;
    overlay += `<div class="cover" style="left:${u(x - 6)};top:${u(y - 6)};width:${u(BADGE_W + 12)};height:${u(BADGE_H + 12)}"></div>`;
    overlay += `<div class="badge b-${s}" style="left:${u(x)};top:${u(y)}">${LABEL[s]}</div>`;
  });
  if (!allDone) {
    // Kop en intro van het sjabloon zeggen dat alles klaar is; dat klopt dan niet.
    overlay += `<div class="cover" style="left:${u(150)};top:${u(302)};width:${u(2412)};height:${u(246)};border-radius:0;background:#00003b"></div>`;
    overlay += `<div class="tx" style="left:${u(217)};top:${u(290)};font-size:${u(48 * PT)};font-weight:700;color:#fff;line-height:1.1">${esc(o.pdfHeadline)}</div>`;
    overlay += `<div class="tx" style="left:${u(219)};top:${u(428)};width:${u(2340)};white-space:normal;font-size:${u(19 * PT)};color:#a9a9bd;line-height:1.25">${esc(o.pdfSubline)}</div>`;
  }
  return page(CP_STATUS_BG, overlay, "status");
}

export function renderContentPlanningHtml(o: ContentPlanningOverview): string {
  const pages = [page(CP_COVER_BG), ...calendarPages(o), statusPage(o), page(CP_CLOSING_BG)];
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8" /><title>Contentplanning ${esc(o.clientName)}</title>${FONT_LINK}<style>${CSS}</style></head><body>${pages.join("")}</body></html>`;
}

export function contentPlanningFilename(o: ContentPlanningOverview): string {
  const safe = (o.clientName || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  return `Shortclips_Contentplanning_${safe}_${o.today}.pdf`;
}
