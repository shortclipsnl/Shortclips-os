import "server-only";
import type { MonthlyAnalysis } from "./analysis";

type Totals = {
  views?: number; reach?: number; posts?: number; followerGrowth?: number;
  engagements?: number; viewsGrowthPct?: number | null; avgPerPost?: number | null;
};

export type ReportPdfInput = {
  clientName: string;
  logoUrl: string | null;
  periodLabel: string;
  totals: Totals;
  analysis: MonthlyAnalysis | null;
  klanttekst: string;
};

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nf = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("nl-NL") : "—");
const pct = (n: number | null | undefined) => (typeof n === "number" ? `${n >= 0 ? "+" : ""}${n}%` : "—");
const signed = (n: number | null | undefined) => (typeof n === "number" ? `${n >= 0 ? "+" : ""}${n.toLocaleString("nl-NL")}` : "—");

/** Premium 3-pagina maandrapportage in de Shortclips-huisstijl. */
export function renderMonthlyReportHtml(input: ReportPdfInput): string {
  const { clientName, logoUrl, periodLabel, totals, analysis, klanttekst } = input;
  const a = analysis;
  const logo = logoUrl && /^https?:\/\//.test(logoUrl)
    ? `<img src="${esc(logoUrl)}" alt="" style="height:40px;max-width:160px;object-fit:contain" />`
    : `<div style="font-weight:700;font-size:18px;color:#00003b">${esc(clientName)}</div>`;

  const stat = (label: string, value: string, sub = "") =>
    `<div class="stat"><div class="sv">${value}</div><div class="sl">${esc(label)}</div>${sub ? `<div class="ss">${esc(sub)}</div>` : ""}</div>`;

  const topVideos = (a?.topVideos ?? []).slice(0, 3).map((v) => `
    <div class="card"><div class="ct">${esc(v.titel)}</div><div class="cm">${esc(v.waarom)}</div>${v.cijfers ? `<div class="cc">${esc(v.cijfers)}</div>` : ""}</div>`).join("");

  const watWerkt = (a?.analysis?.watWerkt ?? []).slice(0, 4).map((f) => `<li>${esc(f.punt)}</li>`).join("");
  const maandverg = (a?.maandvergelijking ?? []).slice(0, 3).map((m) => `<li>${esc(m)}</li>`).join("");
  const acties = (a?.strategischeActies ?? []).slice(0, 3).map((x, i) =>
    `<div class="actie"><div class="an">${i + 1}</div><div><div class="at">${esc(x.titel)}</div>${x.waarom ? `<div class="aw">${esc(x.waarom)}</div>` : ""}</div></div>`).join("");

  const persoonlijk = klanttekst.trim()
    ? klanttekst.trim().split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")
    : `<p>${esc("We hebben de resultaten van deze maand bekeken en onze aanpak voor volgende maand bepaald.")}</p>`;

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Inter, system-ui, -apple-system, sans-serif; color: #00003b; font-size: 12px; line-height: 1.55; margin: 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .head { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #FF6A00; padding-bottom: 14px; margin-bottom: 20px; }
  .brand { font-weight: 800; letter-spacing: -0.02em; color: #00003b; font-size: 15px; }
  .brand span { color: #2E90FA; }
  .kicker { font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: #2E90FA; font-weight: 700; }
  h1 { font-size: 26px; margin: 6px 0 2px; }
  .maand { color: #51516b; font-size: 13px; margin-bottom: 20px; }
  .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 22px; }
  .stat { flex: 1; min-width: 120px; background: #f4f7fb; border-radius: 12px; padding: 14px 16px; }
  .sv { font-size: 24px; font-weight: 800; color: #00003b; font-variant-numeric: tabular-nums; }
  .sl { font-size: 11px; color: #51516b; margin-top: 2px; }
  .ss { font-size: 10px; color: #2E90FA; margin-top: 2px; }
  h2 { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #6f6f82; margin: 22px 0 8px; border-left: 3px solid #FF6A00; padding-left: 8px; }
  .intro { background: #00003b; color: #fff; border-radius: 14px; padding: 18px 20px; font-size: 13px; }
  .card { border: 1px solid #e6e9f2; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; }
  .ct { font-weight: 700; }
  .cm { color: #51516b; font-size: 11.5px; margin-top: 2px; }
  .cc { color: #2E90FA; font-size: 11px; margin-top: 4px; font-weight: 600; }
  ul { margin: 0; padding-left: 18px; } li { margin: 3px 0; }
  .actie { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
  .an { width: 26px; height: 26px; border-radius: 50%; background: #FF6A00; color: #fff; font-weight: 800; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .at { font-weight: 700; } .aw { color: #51516b; font-size: 11.5px; }
  .foot { margin-top: 24px; color: #9a9ab0; font-size: 10px; }
</style></head><body>

  <section class="page">
    <div class="head">${logo}<div class="brand">short<span>clips</span></div></div>
    <div class="kicker">Maandrapportage</div>
    <h1>Jullie maand in beeld</h1>
    <div class="maand">${esc(clientName)} · ${esc(periodLabel)}</div>
    <div class="stats">
      ${stat("Weergaven", nf(totals.views), typeof totals.viewsGrowthPct === "number" ? `${pct(totals.viewsGrowthPct)} t.o.v. vorige maand` : "")}
      ${stat("Gepubliceerde video's", nf(totals.posts), totals.avgPerPost != null ? `gem. ${nf(totals.avgPerPost)} per video` : "")}
      ${stat("Interacties", nf(totals.engagements))}
      ${stat("Volgersgroei", signed(totals.followerGrowth))}
    </div>
    <h2>Samenvatting</h2>
    <div class="intro">${persoonlijk}</div>
    <div class="foot">Samengesteld door Shortclips op basis van de echte cijfers (Metricool). Geen geschatte of verzonnen data.</div>
  </section>

  <section class="page">
    <div class="head"><div class="kicker">Maandrapportage · ${esc(periodLabel)}</div><div class="brand">short<span>clips</span></div></div>
    <h1>Wat hebben we geleerd?</h1>
    ${topVideos ? `<h2>Best presterende video's</h2>${topVideos}` : ""}
    ${watWerkt ? `<h2>Wat werkte goed</h2><ul>${watWerkt}</ul>` : ""}
    ${maandverg ? `<h2>Ontwikkeling</h2><ul>${maandverg}</ul>` : ""}
  </section>

  <section class="page">
    <div class="head"><div class="kicker">Maandrapportage · ${esc(periodLabel)}</div><div class="brand">short<span>clips</span></div></div>
    <h1>Onze aanpak voor volgende maand</h1>
    <div class="intro">${persoonlijk}</div>
    ${acties ? `<h2>Concrete acties</h2>${acties}` : ""}
    <div class="foot">We denken actief mee over jullie contentstrategie. Vragen? Neem gerust contact op met je vaste contactpersoon bij Shortclips.</div>
  </section>

</body></html>`;
}
