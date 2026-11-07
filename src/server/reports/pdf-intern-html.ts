import "server-only";
import type { InternInzicht, MonthlyAnalysis, ReportMetrics } from "./analysis";
import type { Beoordeling } from "./quality";
import { comparisonLines, docShell, esc, historyTable, nf, pctText, signed, topBar } from "./pdf-shared";

export type InternPdfInput = {
  clientName: string;
  periodLabel: string;
  pmName: string | null;
  statusLabel: string;
  approvedAt: string | null;
  totals: Partial<ReportMetrics>;
  analysis: MonthlyAnalysis | null;
  beoordeling: Beoordeling;
  ontbrekend: string[];
};

const ROL: Record<string, string> = { script: "Script", opname: "Opname", montage: "Montage", pm: "Projectmanager" };

const CSS = `
  .warn { background: #fff4e5; border: 1px solid #f3d3a4; color: #6b4300; border-radius: 8px; padding: 7px 10px; font-size: 9px; margin-bottom: 14px; }
  .ins td:first-child { width: 20%; } .ins td.g { width: 34%; } .ins td.v { width: 36%; } .ins td.z { width: 12%; }
  .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: .1em; color: #5d5d78; font-weight: 600; }
`;

function insights(title: string, list: InternInzicht[] | undefined, empty = "Geen gegevens om dit onderbouwd te beoordelen."): string {
  const rows = (list ?? []).map((i) => `<tr><td><b>${esc(i.titel)}</b></td><td class="g">${esc(i.gemeten) || "–"}</td><td class="v">${esc(i.verklaring) || "–"}</td><td class="z"><span class="chip">${esc(i.zekerheid || "hypothese")}</span></td></tr>`).join("");
  return `<h2>${esc(title)}</h2>${rows ? `<table class="ins"><tr><th>Onderwerp</th><th>Gemeten (feit)</th><th>Mogelijke verklaring</th><th>Zekerheid</th></tr>${rows}</table>` : `<p class="lead" style="margin:0">${esc(empty)}</p>`}`;
}

function list(title: string, items: string[] | undefined): string {
  const li = (items ?? []).filter(Boolean).map((x) => `<li>${esc(x)}</li>`).join("");
  return li ? `<div><h2>${esc(title)}</h2><ul>${li}</ul></div>` : `<div><h2>${esc(title)}</h2><p class="lead" style="margin:0">Geen specifieke punten deze maand.</p></div>`;
}

/**
 * Interne teamrapportage (PDF 2): alleen voor het Shortclips-team. Gaat dieper
 * in op waarom video's wel of niet werkten en wat het team volgende maand
 * anders doet. Gemeten feiten en mogelijke verklaringen staan altijd apart.
 */
export function renderInternReportHtml(input: InternPdfInput): string {
  const { clientName, periodLabel, pmName, statusLabel, approvedAt, totals: t, analysis: a, beoordeling: b, ontbrekend } = input;
  const i = a?.intern;
  const v = t.vergelijking ?? null;
  const vm = v?.vsVorigeMaand;
  const meta = `<b>INTERN</b> · niet delen met de klant<br/>${esc(clientName)} · ${esc(periodLabel)}`;

  const kpiRows = [
    ["Weergaven", nf(t.views), vm?.views],
    ["Bereik", nf(t.reach), vm?.reach],
    ["Interacties", nf(t.engagements), vm?.engagements],
    ["Volgersgroei", signed(t.followerGrowth), null],
    ["Video's", nf(t.posts), vm?.videos],
    ["Weergaven per video", t.avgPerPost != null ? nf(t.avgPerPost) : "–", vm?.viewsPerVideo],
  ] as Array<[string, string, number | null | undefined]>;
  const kpiTable = `<table><tr><th>Cijfer</th><th class="n">Deze maand</th><th class="n">t.o.v. vorige maand</th><th class="n">t.o.v. gem. 3 mnd</th><th class="n">t.o.v. gem. 6 mnd</th></tr>${kpiRows.map(([l, val, d]) => {
    const g3 = l === "Weergaven" ? v?.vsGem3.views : l === "Interacties" ? v?.vsGem3.engagements : l === "Video's" ? v?.vsGem3.videos : undefined;
    const g6 = l === "Weergaven" ? v?.vsGem6.views : l === "Interacties" ? v?.vsGem6.engagements : l === "Video's" ? v?.vsGem6.videos : undefined;
    return `<tr><td>${esc(l)}</td><td class="n"><b>${val}</b></td><td class="n">${pctText(d)}</td><td class="n">${g3 === undefined ? "" : pctText(g3)}</td><td class="n">${g6 === undefined ? "" : pctText(g6)}</td></tr>`;
  }).join("")}</table>`;

  const formats = (t.formats ?? []).map((f) => `<tr><td>${esc(f.format)}</td><td class="n">${nf(f.videos)}</td><td class="n">${nf(f.gemViews)}</td><td class="n">${nf(f.gemInteracties)}</td></tr>`).join("");
  const acties = (i?.acties ?? []).map((x) => `<tr><td><b>${esc(x.actie)}</b></td><td>${esc(ROL[x.rol] ?? x.rol)}</td><td>${esc(x.waarom)}</td></tr>`).join("");
  const beperkingen = [...new Set([...(i?.dataBeperkingen ?? []), ...ontbrekend])].map((x) => `<li>${esc(x)}</li>`).join("");
  const beoordeling = [
    ["Wat viel positief op?", b.positief], ["Wat willen we verbeteren?", b.verbeteren], ["Wat doen we volgende maand concreet?", b.volgendeMaand],
  ].filter(([, x]) => (x ?? "").trim()).map(([q, x]) => `<div class="box"><div class="lbl">${esc(q)}</div><div style="white-space:pre-line">${esc(x)}</div></div>`).join("");

  const body = `
  <section class="page">
    ${topBar(meta)}
    <div class="warn">Interne teamrapportage. Bedoeld om van te leren; niet doorsturen naar de klant. <b>Gemeten</b> = feitelijk uit de cijfers. <b>Mogelijke verklaring</b> = interpretatie, niet bewezen tenzij de zekerheid "bewezen" is.</div>
    <h1>${esc(clientName)}</h1>
    <p class="lead" style="text-transform:none">${esc(periodLabel)} · Projectmanager: ${esc(pmName ?? "niet ingesteld")} · Status: ${esc(statusLabel)}${approvedAt ? ` · Goedgekeurd ${esc(new Date(approvedAt).toLocaleDateString("nl-NL"))}` : ""}</p>
    ${i?.kern ? `<div class="navybox"><p>${esc(i.kern)}</p></div>` : ""}
    <h2>Cijfers en vergelijking</h2>
    ${kpiTable}
    ${historyTable(t.historie ?? [], true) ? `<h2>Afgelopen maanden</h2>${historyTable(t.historie ?? [], true)}` : ""}
    <ul style="margin-top:8px">${comparisonLines(v).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    ${formats ? `<h2>Contentformats deze maand</h2><table><tr><th>Format</th><th class="n">Video's</th><th class="n">Gem. weergaven</th><th class="n">Gem. interacties</th></tr>${formats}</table>` : `<p class="note">Formats zijn deze maand niet aan video's gekoppeld; een formatvergelijking is daarom niet mogelijk.</p>`}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Wat werkte en waarom</h1>
    ${insights("Best presterende video's", i?.besteVideos)}
    ${insights("Hooks die werkten", i?.hooks)}
    ${insights("Onderwerpen met de meeste betrokkenheid", i?.onderwerpen)}
    ${insights("Contentformats om vaker te gebruiken", i?.formatsVaker)}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Wat viel tegen en wat leren we</h1>
    ${insights("Video's die tegenvielen en mogelijke oorzaken", i?.tegenvallers)}
    ${insights("Lessen over de videostructuur", i?.videostructuur)}
    ${insights("Onderwerpen om te vermijden of aan te passen", i?.vermijdenOfAanpassen)}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Wat doen we volgende maand anders</h1>
    <div class="two">
      ${list("Scripts", i?.scripts)}
      ${list("Opnames", i?.opnames)}
    </div>
    ${list("Montage", i?.montage)}
    <h2>Concrete acties voor komende maand</h2>
    ${acties ? `<table><tr><th>Actie</th><th>Wie</th><th>Waarom</th></tr>${acties}</table>` : `<p class="lead">Nog geen acties vastgesteld.</p>`}
    ${beoordeling ? `<h2>Beoordeling van het team</h2>${beoordeling}` : ""}
    ${beperkingen ? `<h2>Wat we niet konden meten</h2><ul>${beperkingen}</ul>` : ""}
  </section>`;

  return docShell(`Intern teamrapport ${clientName} ${periodLabel}`, CSS, body);
}
