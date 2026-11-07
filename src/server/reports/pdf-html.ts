import "server-only";
import type { MonthlyAnalysis, ReportMetrics } from "./analysis";
import { comparisonLines, docShell, esc, historyTable, LOGO, nf, pctText, signed, topBar, viewsBars } from "./pdf-shared";

export type ReportPdfInput = {
  clientName: string;
  logoUrl: string | null;
  periodLabel: string;
  totals: Partial<ReportMetrics>;
  analysis: MonthlyAnalysis | null;
  klanttekst: string;
};

/**
 * Klantversie van de maandrapportage (PDF 1): professioneel, begrijpelijk en
 * deelbaar. Bevat nooit interne analyse, kwaliteitscontrole of feedback.
 */
export function renderMonthlyReportHtml(input: ReportPdfInput): string {
  const { clientName, periodLabel, totals: t, analysis: a, klanttekst } = input;
  const v = t.vergelijking ?? null;
  const vm = v?.vsVorigeMaand;
  const historie = t.historie ?? [];
  const meta = `${esc(clientName)}<br/>Maandrapportage ${esc(periodLabel)}`;

  const kpi = (label: string, value: string, delta: number | null | undefined) =>
    `<div class="kpi"><div class="v">${value}</div><div class="l">${esc(label)}</div>${delta !== undefined ? `<div class="d">${delta === null ? "geen vergelijking" : `${pctText(delta)} t.o.v. vorige maand`}</div>` : ""}</div>`;

  const persoonlijk = klanttekst.trim()
    ? klanttekst.trim().split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")
    : `<p>${esc("We hebben de resultaten van deze maand bekeken en onze aanpak voor volgende maand bepaald.")}</p>`;

  const topVideos = (a?.topVideos ?? []).slice(0, 3).map((x, i) =>
    `<div class="box"><div class="row" style="margin:0"><span class="num">${i + 1}</span><div><div class="t">${esc(x.titel)}</div>${x.cijfers ? `<div class="s"><b>${esc(x.cijfers)}</b></div>` : ""}<div class="s">${esc(x.waarom)}</div></div></div></div>`).join("");
  const watWerkt = (a?.analysis?.watWerkt ?? []).slice(0, 4).map((f) => `<li>${esc(f.punt)}</li>`).join("");
  const ontwikkeling = [...(a?.maandvergelijking ?? []).slice(0, 3), ...(a?.analysis?.ontwikkelingen ?? []).slice(0, 2)].map((m) => `<li>${esc(m)}</li>`).join("");
  const vergelijk = comparisonLines(v).map((l) => `<li>${esc(l)}</li>`).join("");
  const conclusies = (a?.conclusies ?? []).map((c) => `<li>${esc(c)}</li>`).join("");
  const kansen = (a?.kansen ?? []).map((k) => `<div class="box"><div class="t">${esc(k.titel)}</div><div class="s">${esc(k.toelichting)}</div></div>`).join("");
  const acties = (a?.strategischeActies ?? []).slice(0, 3).map((x, i) =>
    `<div class="row"><span class="num">${i + 1}</span><div><div class="t" style="font-weight:600;color:#00003b">${esc(x.titel)}</div>${x.waarom ? `<div style="color:#5d5d78">${esc(x.waarom)}</div>` : ""}</div></div>`).join("");

  const engagementDetail = [
    ["Likes", t.likes], ["Reacties", t.comments], ["Shares", t.shares], ["Saves", t.saves],
  ].filter(([, n]) => typeof n === "number" && (n as number) > 0);

  const body = `
  <section class="page cover">
    <img src="${LOGO.dark}" alt="Shortclips" />
    <div class="kicker">Maandrapportage</div>
    <h1>${esc(clientName)}</h1>
    <div class="sub" style="text-transform:capitalize">${esc(periodLabel)}</div>
    <div class="foot">Samengesteld door Shortclips op basis van de gemeten cijfers. Geen geschatte of verzonnen data.</div>
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Jullie maand in beeld</h1>
    <p class="lead">De belangrijkste resultaten van ${esc(periodLabel)}.</p>
    <div class="grid3">
      ${kpi("Weergaven", nf(t.views), vm ? vm.views : undefined)}
      ${kpi("Bereik", nf(t.reach), vm ? vm.reach : undefined)}
      ${kpi("Interacties", nf(t.engagements), vm ? vm.engagements : undefined)}
      ${kpi("Volgersgroei", signed(t.followerGrowth), undefined)}
      ${kpi("Gepubliceerde video's", nf(t.posts), vm ? vm.videos : undefined)}
      ${kpi("Weergaven per video", t.avgPerPost != null ? nf(t.avgPerPost) : "–", vm ? vm.viewsPerVideo : undefined)}
    </div>
    ${engagementDetail.length ? `<h2>Betrokkenheid</h2><table><tr>${engagementDetail.map(([l]) => `<th class="n">${esc(l)}</th>`).join("")}${t.engagementRate != null ? `<th class="n">Interactiepercentage</th>` : ""}</tr><tr>${engagementDetail.map(([, n]) => `<td class="n">${nf(n)}</td>`).join("")}${t.engagementRate != null ? `<td class="n">${String(t.engagementRate).replace(".", ",")}%</td>` : ""}</tr></table>` : ""}
    <h2>Samenvatting</h2>
    <div class="navybox">${persoonlijk}</div>
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Ontwikkeling</h1>
    <p class="lead">Hoe de resultaten zich over de afgelopen maanden ontwikkelen.</p>
    ${viewsBars(historie) ? `<h2>Weergaven per maand</h2>${viewsBars(historie)}` : ""}
    ${historyTable(historie) ? `<h2>Cijfers per maand</h2>${historyTable(historie)}` : ""}
    ${vergelijk ? `<h2>Vergelijking met eerdere maanden</h2><ul>${vergelijk}</ul>` : ""}
    ${ontwikkeling ? `<h2>Belangrijkste ontwikkelingen</h2><ul>${ontwikkeling}</ul>` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Wat werkte deze maand</h1>
    <p class="lead">De video's en onderdelen die het sterkst presteerden.</p>
    ${topVideos ? `<h2>Best presterende video's</h2>${topVideos}` : `<p class="lead">De cijfers per video zijn voor deze maand nog niet beschikbaar.</p>`}
    ${watWerkt ? `<h2>Wat werkte goed</h2><ul>${watWerkt}</ul>` : ""}
    ${conclusies ? `<h2>Conclusies</h2><ul>${conclusies}</ul>` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Onze aanpak voor volgende maand</h1>
    <p class="lead">Wat we meenemen naar de nieuwe content.</p>
    ${kansen ? `<h2>Kansen en aanbevelingen</h2>${kansen}` : ""}
    ${acties ? `<h2>Concrete acties</h2>${acties}` : ""}
    <div class="navybox" style="margin-top:22px"><p><b>Samen bouwen we verder.</b> Heb je vragen over deze rapportage of ideeën voor volgende maand? Laat het ons weten via je vaste contactpersoon bij Shortclips.</p></div>
  </section>`;

  return docShell(`Maandrapportage ${clientName} ${periodLabel}`, "", body);
}
