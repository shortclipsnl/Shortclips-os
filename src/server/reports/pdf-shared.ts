import "server-only";
import type { MaandCijfers, Vergelijking } from "./metrics";
import { LOGO_ONDARK, LOGO_ONLIGHT } from "./brand-assets";

/** Gedeelde opmaak voor de klant- en de interne PDF (Shortclips-huisstijl: donkerblauw, wit, Poppins). */

export const NAVY = "#00003b";
export const INK = "#14143c";
export const MUTED = "#5d5d78";
export const LINE = "#e3e4ee";
export const SOFT = "#f4f5f9";

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const nf = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("nl-NL") : "–");
export const signed = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("nl-NL")}` : "–");

/** "+12,5%" of "–" wanneer niet te berekenen. */
export function pctText(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "–";
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : ""}${r.toLocaleString("nl-NL")}%`;
}

/** Korte maandnaam: "okt". */
export function shortMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "short" }).replace(".", "");
}

export const LOGO = { dark: LOGO_ONDARK, light: LOGO_ONLIGHT };

export const BASE_CSS = `
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Poppins, Arial, sans-serif; color: ${INK}; font-size: 10.5px; line-height: 1.55; margin: 0; }
  .page { width: 210mm; min-height: 297mm; padding: 16mm 16mm 18mm; page-break-after: always; position: relative; }
  .page:last-child { page-break-after: auto; }
  .cover { background: ${NAVY}; color: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 0 20mm; }
  .cover img { width: 150px; margin-bottom: 40px; }
  .cover .kicker { letter-spacing: .28em; text-transform: uppercase; font-size: 10px; opacity: .7; font-weight: 600; }
  .cover h1 { font-size: 34px; font-weight: 700; margin: 10px 0 6px; letter-spacing: -0.01em; color: #fff; }
  .cover .sub { font-size: 15px; opacity: .85; }
  .cover .foot { position: absolute; bottom: 16mm; left: 0; right: 0; font-size: 9px; opacity: .55; }
  .top { display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; border-bottom: 1px solid ${LINE}; margin-bottom: 18px; }
  .top img { height: 22px; }
  .top .meta { font-size: 9px; color: ${MUTED}; text-align: right; }
  h1 { font-size: 22px; font-weight: 700; color: ${NAVY}; margin: 0 0 4px; letter-spacing: -0.01em; }
  .lead { color: ${MUTED}; font-size: 11px; margin: 0 0 16px; }
  h2 { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: ${NAVY}; margin: 18px 0 8px; font-weight: 700; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .kpi { background: ${SOFT}; border-radius: 10px; padding: 11px 12px; }
  .kpi .v { font-size: 20px; font-weight: 700; color: ${NAVY}; font-variant-numeric: tabular-nums; }
  .kpi .l { font-size: 9.5px; color: ${MUTED}; }
  .kpi .d { font-size: 9px; color: ${NAVY}; margin-top: 3px; font-weight: 600; }
  .box { border: 1px solid ${LINE}; border-radius: 10px; padding: 11px 13px; margin-bottom: 8px; page-break-inside: avoid; }
  .box .t { font-weight: 600; color: ${NAVY}; }
  .box .s { color: ${MUTED}; margin-top: 2px; }
  .navybox { background: ${NAVY}; color: #fff; border-radius: 12px; padding: 14px 16px; font-size: 11px; }
  .navybox p { margin: 0 0 6px; } .navybox p:last-child { margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
  th { text-align: left; font-weight: 600; color: ${MUTED}; border-bottom: 1px solid ${LINE}; padding: 5px 6px; }
  td { border-bottom: 1px solid ${LINE}; padding: 5px 6px; vertical-align: top; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  ul { margin: 0; padding-left: 16px; } li { margin: 2px 0; }
  .num { display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: ${NAVY}; color: #fff; font-weight: 700; font-size: 10px; align-items: center; justify-content: center; margin-right: 8px; flex: 0 0 auto; }
  .row { display: flex; align-items: flex-start; margin-bottom: 9px; }
  .note { font-size: 8.5px; color: ${MUTED}; margin-top: 10px; }
  .chip { display: inline-block; border-radius: 99px; padding: 1px 7px; font-size: 8.5px; font-weight: 600; border: 1px solid ${LINE}; color: ${MUTED}; }
  .bars { display: flex; align-items: flex-end; gap: 10px; height: 120px; padding: 8px 4px 0; border-bottom: 1px solid ${LINE}; }
  .bar { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .bar .b { width: 100%; background: #c9cbe0; border-radius: 5px 5px 0 0; }
  .bar.cur .b { background: ${NAVY}; }
  .bar .bv { font-size: 8px; color: ${MUTED}; margin-bottom: 3px; }
  .barl { display: flex; gap: 10px; padding: 4px 4px 0; } .barl div { flex: 1; text-align: center; font-size: 8.5px; color: ${MUTED}; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
`;

export const FONT_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">`;

export function topBar(right: string): string {
  return `<div class="top"><img src="${LOGO.light}" alt="Shortclips" /><div class="meta">${right}</div></div>`;
}

/** Staafdiagram van weergaven per maand (alleen maanden met meting). */
export function viewsBars(historie: MaandCijfers[]): string {
  const list = historie.filter((m) => m.meetdagen > 0);
  if (list.length < 2) return "";
  const max = Math.max(...list.map((m) => m.views), 1);
  const last = list[list.length - 1]!.maand;
  const bars = list.map((m) => `<div class="bar${m.maand === last ? " cur" : ""}"><div class="bv">${nf(m.views)}</div><div class="b" style="height:${Math.max(3, Math.round((m.views / max) * 100))}%"></div></div>`).join("");
  const labels = list.map((m) => `<div>${esc(shortMonth(m.maand))}</div>`).join("");
  return `<div class="bars">${bars}</div><div class="barl">${labels}</div>`;
}

/** Tabel met de maanden (oudste eerst). */
export function historyTable(historie: MaandCijfers[], withEngagementDetail = false): string {
  const list = historie.filter((m) => m.meetdagen > 0 || m.videos > 0);
  if (list.length === 0) return "";
  const head = `<tr><th>Maand</th><th class="n">Weergaven</th><th class="n">Bereik</th><th class="n">Interacties</th>${withEngagementDetail ? `<th class="n">Likes</th><th class="n">Reacties</th><th class="n">Shares</th><th class="n">Saves</th>` : ""}<th class="n">Volgers</th><th class="n">Video's</th><th class="n">Weergaven per video</th></tr>`;
  const body = list.map((m) => `<tr><td>${esc(shortMonth(m.maand))} ${esc(m.maand.slice(0, 4))}</td><td class="n">${m.meetdagen ? nf(m.views) : "–"}</td><td class="n">${m.meetdagen ? nf(m.reach) : "–"}</td><td class="n">${m.meetdagen ? nf(m.engagements) : "–"}</td>${withEngagementDetail ? `<td class="n">${m.meetdagen ? nf(m.likes) : "–"}</td><td class="n">${m.meetdagen ? nf(m.comments) : "–"}</td><td class="n">${m.meetdagen ? nf(m.shares) : "–"}</td><td class="n">${m.meetdagen ? nf(m.saves) : "–"}</td>` : ""}<td class="n">${m.meetdagen ? signed(m.followerGrowth) : "–"}</td><td class="n">${nf(m.videos)}</td><td class="n">${m.meetdagen && m.videos ? nf(m.views / m.videos) : "–"}</td></tr>`).join("");
  return `<table>${head}${body}</table>`;
}

/** Tekstregels voor de 3- en 6-maandsvergelijking (alleen wat berekend kon worden). */
export function comparisonLines(v: Vergelijking | null | undefined): string[] {
  if (!v) return [];
  const out: string[] = [];
  if (v.vsGem3.views !== null) out.push(`Weergaven ${pctText(v.vsGem3.views)} ten opzichte van het gemiddelde van de drie maanden ervoor.`);
  if (v.vsGem6.views !== null) out.push(`Weergaven ${pctText(v.vsGem6.views)} ten opzichte van het gemiddelde van de zes maanden ervoor.`);
  if (v.vsGem3.engagements !== null) out.push(`Interacties ${pctText(v.vsGem3.engagements)} ten opzichte van het gemiddelde van de drie maanden ervoor.`);
  if (out.length === 0) out.push(`Er ${v.maandenHistorie === 1 ? "is" : "zijn"} nog maar ${v.maandenHistorie} eerdere ${v.maandenHistorie === 1 ? "maand" : "maanden"} met cijfers; een vergelijking over drie of zes maanden volgt zodra die historie er is.`);
  return out;
}

export function docShell(title: string, css: string, body: string): string {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8" /><title>${esc(title)}</title>${FONT_LINK}<style>${BASE_CSS}${css}</style></head><body>${body}</body></html>`;
}
