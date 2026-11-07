import "server-only";
import type { InternInzicht, MonthlyAnalysis, ReportMetrics } from "./analysis";
import type { Beoordeling } from "./quality";
import { comparisonLines, docShell, esc, historyTable, LOGO, nf, pctText, signed, topBar } from "./pdf-shared";
import { CLIENT_CSS, deltaPill, platformBlock, videoPages } from "./pdf-html";

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
  /** Video's van de maand met miniatuur; `inzicht` bevat hier de interne les. */
  videos?: Array<{ titel: string; datum: string | null; platform: string | null; views: number; likes: number; reacties: number; shares: number; saves: number; thumb: string | null; inzicht: string | null }>;
};

const GREEN = "#12a150";

const CSS = `
  .warn { background: #fff4e5; border: 1px solid #f3d3a4; color: #6b4300; border-radius: 10px; padding: 8px 12px; font-size: 9px; margin-bottom: 14px; }
  .ins td:first-child { width: 20%; } .ins td.g { width: 34%; } .ins td.v { width: 36%; } .ins td.z { width: 10%; }
  .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: .1em; color: #5d5d78; font-weight: 600; }
  .kern { background: #00003b; color: #fff; border-radius: 14px; padding: 14px 18px; font-size: 12px; font-weight: 500; }
  .kern .h { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; opacity: .7; font-weight: 600; margin-bottom: 5px; }
  .dst { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .dsc { border-radius: 14px; padding: 12px 14px; }
  .dsc .h { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 7px; }
  .dsc ul { padding-left: 15px; margin: 0; } .dsc li { margin: 4px 0; font-size: 10px; }
  .dsc.go { background: #e6f6ec; } .dsc.go .h { color: ${GREEN}; }
  .dsc.stop { background: #eef0f5; } .dsc.stop .h { color: #3d3d58; }
  .dsc.test { background: #00003b; color: #fff; } .dsc.test .h { color: #8fe0b0; }
  .rol { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rc { border: 1px solid #e3e4ee; border-radius: 14px; padding: 12px 14px; page-break-inside: avoid; }
  .rc .h { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .rc .h b { color: #00003b; font-size: 12px; }
  .rc .h span { font-size: 8.5px; color: #5d5d78; }
  .rc ul { list-style: none; padding: 0; margin: 0; }
  .rc li { position: relative; padding-left: 18px; margin: 5px 0; font-size: 10px; }
  .rc li::before { content: ""; position: absolute; left: 0; top: 2px; width: 10px; height: 10px; border: 1.5px solid #00003b; border-radius: 3px; }
  .rc li small { display: block; color: #5d5d78; font-size: 8.5px; }
  .rc .leeg { color: #5d5d78; font-size: 9.5px; }
`;

const ROL_LABEL: Record<string, string> = { script: "Script", opname: "Opname", montage: "Montage", pm: "Projectmanager" };

function insights(title: string, list: InternInzicht[] | undefined, empty = "Geen gegevens om dit onderbouwd te beoordelen."): string {
  const rows = (list ?? []).map((i) => `<tr><td><b>${esc(i.titel)}</b></td><td class="g">${esc(i.gemeten) || "–"}</td><td class="v">${esc(i.verklaring) || "–"}</td><td class="z"><span class="chip">${esc(i.zekerheid || "hypothese")}</span></td></tr>`).join("");
  return `<h2>${esc(title)}</h2>${rows ? `<table class="ins"><tr><th>Onderwerp</th><th>Gemeten (feit)</th><th>Mogelijke verklaring</th><th>Zekerheid</th></tr>${rows}</table>` : `<p class="lead" style="margin:0">${esc(empty)}</p>`}`;
}

function fullMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long" });
}

/**
 * Interne teamrapportage (PDF 2): alleen voor het Shortclips-team. Begint met
 * wat er volgende maand anders moet (doorgaan, stoppen, testen en acties per
 * rol), daarna de cijfers, wat werkte en wat tegenviel, en een les per video.
 * Gemeten feiten en mogelijke verklaringen staan altijd apart.
 */
export function renderInternReportHtml(input: InternPdfInput): string {
  const { clientName, periodLabel, pmName, statusLabel, approvedAt, totals: t, analysis: a, beoordeling: b, ontbrekend } = input;
  const i = a?.intern;
  const v = t.vergelijking ?? null;
  const vm = v?.vsVorigeMaand;
  const historie = t.historie ?? [];
  const cur = historie[historie.length - 1];
  const prev = historie.length > 1 ? historie[historie.length - 2] : undefined;
  const maand = cur ? fullMonth(cur.maand) : periodLabel.split(" ")[0]!;
  const vorige = prev ? fullMonth(prev.maand) : "vorige maand";
  const volgende = cur ? new Date(Number(cur.maand.slice(0, 4)), Number(cur.maand.slice(5, 7)), 1).toLocaleDateString("nl-NL", { month: "long" }) : "volgende maand";
  const meta = `<b>INTERN</b> · niet delen met de klant<br/>${esc(clientName)} · ${esc(periodLabel)}`;

  // Doorgaan / stoppen / testen
  const lst = (items: string[] | undefined) => (items ?? []).length ? `<ul>${(items ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div style="font-size:9.5px;opacity:.7">Geen punten deze maand.</div>`;
  const dst = i && ((i.doorgaan ?? []).length || (i.stoppen ?? []).length || (i.testen ?? []).length)
    ? `<div class="dst"><div class="dsc go"><div class="h">Doorgaan</div>${lst(i.doorgaan)}</div><div class="dsc stop"><div class="h">Stoppen of minder</div>${lst(i.stoppen)}</div><div class="dsc test"><div class="h">Testen</div>${lst(i.testen)}</div></div>`
    : "";

  // Acties per rol: concrete acties met die rol + de losse aandachtspunten per discipline.
  const perRol = (rol: string, extra: string[] | undefined, wie: string) => {
    const acties = (i?.acties ?? []).filter((x) => x.rol === rol).map((x) => `<li>${esc(x.actie)}${x.waarom ? `<small>${esc(x.waarom)}</small>` : ""}</li>`);
    const losse = (extra ?? []).map((x) => `<li>${esc(x)}</li>`);
    const items = [...acties, ...losse];
    return `<div class="rc"><div class="h"><b>${esc(ROL_LABEL[rol] ?? rol)}</b><span>${esc(wie)}</span></div>${items.length ? `<ul>${items.join("")}</ul>` : `<div class="leeg">Geen specifieke punten.</div>`}</div>`;
  };
  const rollen = i ? `<div class="rol">${perRol("script", i.scripts, "scriptschrijvers")}${perRol("opname", i.opnames, "videografen")}${perRol("montage", i.montage, "editors")}${perRol("pm", [], pmName ? `verantwoordelijk: ${pmName}` : "projectmanager")}</div>` : "";

  const kpi = (label: string, value: string, delta: number | null | undefined) =>
    `<div class="kt"><div class="v">${value}</div><div class="l">${esc(label)}</div>${deltaPill(delta, "pill", ` vs ${vorige}`)}</div>`;

  const kpiRows = [
    ["Weergaven", nf(t.views), vm?.views, v?.vsGem3.views, v?.vsGem6.views],
    ["Interacties", nf(t.engagements), vm?.engagements, v?.vsGem3.engagements, v?.vsGem6.engagements],
    ["Video's", nf(t.posts), vm?.videos, v?.vsGem3.videos, v?.vsGem6.videos],
  ] as Array<[string, string, number | null | undefined, number | null | undefined, number | null | undefined]>;
  const cmp = `<table><tr><th>Cijfer</th><th class="n">${esc(maand)}</th><th class="n">t.o.v. ${esc(vorige)}</th><th class="n">t.o.v. gem. 3 mnd</th><th class="n">t.o.v. gem. 6 mnd</th></tr>${kpiRows.map(([l, val, d, g3, g6]) => `<tr><td>${esc(l)}</td><td class="n"><b>${val}</b></td><td class="n">${pctText(d)}</td><td class="n">${pctText(g3)}</td><td class="n">${pctText(g6)}</td></tr>`).join("")}</table>`;

  const formats = (t.formats ?? []).map((f) => `<tr><td>${esc(f.format)}</td><td class="n">${nf(f.videos)}</td><td class="n">${nf(f.gemViews)}</td><td class="n">${nf(f.gemInteracties)}</td></tr>`).join("");
  const beperkingen = [...new Set([...(i?.dataBeperkingen ?? []), ...ontbrekend])].map((x) => `<li>${esc(x)}</li>`).join("");
  const beoordeling = [
    ["Wat viel positief op?", b.positief], ["Wat willen we verbeteren?", b.verbeteren], ["Wat doen we volgende maand concreet?", b.volgendeMaand],
  ].filter(([, x]) => (x ?? "").trim()).map(([q, x]) => `<div class="box"><div class="lbl">${esc(q)}</div><div style="white-space:pre-line">${esc(x)}</div></div>`).join("");

  const body = `
  <section class="page cover">
    <img src="${LOGO.dark}" alt="Shortclips" />
    <div class="kicker">Interne teamrapportage</div>
    <h1>${esc(clientName)}</h1>
    <div class="sub" style="text-transform:capitalize">${esc(periodLabel)}</div>
    <div class="sub" style="font-size:11px;margin-top:14px;opacity:.75">Projectmanager: ${esc(pmName ?? "niet ingesteld")} · ${esc(statusLabel)}${approvedAt ? ` op ${esc(new Date(approvedAt).toLocaleDateString("nl-NL"))}` : ""}</div>
    <div class="foot">Alleen voor het Shortclips-team. Niet delen met de klant.</div>
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Wat moet er anders in ${esc(volgende)}</h1>
    <p class="lead">De belangrijkste lessen uit ${esc(maand)}, vertaald naar wat we volgende maand doen.</p>
    ${i?.kern ? `<div class="kern"><div class="h">De kern</div>${esc(i.kern)}</div>` : ""}
    ${dst ? `<h2>Doorgaan, stoppen, testen</h2>${dst}` : ""}
    ${rollen ? "" : `<p class="lead">De interne analyse ontbreekt nog. Gebruik 'AI opnieuw' op de controlepagina.</p>`}
  </section>

  ${rollen ? `<section class="page">
    ${topBar(meta)}
    <h1>Acties per rol</h1>
    <p class="lead">Wie past wat toe bij de volgende scripts, opnames en montages. Vink af wat gedaan is.</p>
    ${rollen}
  </section>` : ""}

  <section class="page">
    ${topBar(meta)}
    <h1>De cijfers van ${esc(maand)}</h1>
    <div class="kpis">
      ${kpi("Weergaven", nf(t.views), vm?.views)}
      ${kpi("Bereik", nf(t.reach), vm?.reach)}
      ${kpi("Interacties", nf(t.engagements), vm?.engagements)}
      ${kpi("Nieuwe volgers", signed(t.followerGrowth), vm?.followerGrowth)}
      ${kpi("Video's", nf(t.posts), vm?.videos)}
      ${kpi("Weergaven per video", t.avgPerPost != null ? nf(t.avgPerPost) : "–", vm?.viewsPerVideo)}
    </div>
    ${platformBlock(t.platforms ?? [], vorige)}
    <h2>Vergelijking met eerdere maanden</h2>
    ${cmp}
    <ul style="margin-top:8px">${comparisonLines(v).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    ${historyTable(historie, true) ? `<h2>Afgelopen maanden</h2>${historyTable(historie, true)}` : ""}
    ${formats ? `<h2>Contentformats deze maand</h2><table><tr><th>Format</th><th class="n">Video's</th><th class="n">Gem. weergaven</th><th class="n">Gem. interacties</th></tr>${formats}</table>` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <div class="warn"><b>Gemeten</b> = feitelijk uit de cijfers. <b>Mogelijke verklaring</b> = interpretatie, niet bewezen tenzij de zekerheid "bewezen" is.</div>
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

  ${videoPages(input.videos ?? [], maand, meta, { titel: "Per video: wat leren we", lead: "Elke video van deze maand met de cijfers en de les voor script, opname of montage." })}

  <section class="page">
    ${topBar(meta)}
    <h1>Beoordeling en kanttekeningen</h1>
    ${beoordeling ? `<h2>Beoordeling van het team</h2>${beoordeling}` : `<p class="lead">De persoonlijke beoordeling is nog niet ingevuld.</p>`}
    ${beperkingen ? `<h2>Wat we niet konden meten</h2><ul>${beperkingen}</ul>` : ""}
  </section>`;

  return docShell(`Intern teamrapport ${clientName} ${periodLabel}`, CLIENT_CSS + CSS, body);
}
