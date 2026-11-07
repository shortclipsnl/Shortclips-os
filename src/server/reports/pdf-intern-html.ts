import "server-only";
import type { MonthlyAnalysis, ReportMetrics, VideoAnalyse } from "./analysis";
import type { Beoordeling } from "./quality";
import { comparisonLines, docShell, esc, historyTable, LOGO, nf, pctText, signed, topBar } from "./pdf-shared";
import { CLIENT_CSS, deltaPill, PLATFORM, platformBlock } from "./pdf-html";

export type InternVideo = {
  key: string; titel: string; datum: string | null; platform: string | null;
  views: number; likes: number; reacties: number; shares: number; saves: number;
  gemKijktijdSec: number | null; uitkijkPct?: number | null; scriptHook?: string | null;
  thumb: string | null; les?: string | null; analyse?: VideoAnalyse | null;
};

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
  videos?: InternVideo[];
};

const GREEN = "#12a150";
const HOOKS_PER_PAGE = 11;
const CARDS_PER_PAGE = 2;

const CSS = `
  .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: .1em; color: #5d5d78; font-weight: 600; }
  .kern { background: #00003b; color: #fff; border-radius: 14px; padding: 13px 17px; font-size: 12px; font-weight: 500; }
  .kern .h { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; opacity: .7; font-weight: 600; margin-bottom: 5px; }
  .dst { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .dsc { border-radius: 14px; padding: 12px 14px; }
  .dsc .h { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 7px; }
  .dsc ul { padding-left: 15px; margin: 0; } .dsc li { margin: 4px 0; font-size: 10px; }
  .dsc.go { background: #e6f6ec; } .dsc.go .h { color: ${GREEN}; }
  .dsc.stop { background: #eef0f5; } .dsc.stop .h { color: #3d3d58; }
  .dsc.test { background: #00003b; color: #fff; } .dsc.test .h { color: #8fe0b0; }
  .kpis.k6 .kt .v { font-size: 22px; }
  .verdict { display: inline-block; border-radius: 99px; padding: 2px 9px; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; }
  .verdict.herhalen { background: ${GREEN}; color: #fff; }
  .verdict.aanpassen { background: #00003b; color: #fff; }
  .verdict.stoppen { background: #e9eaf1; color: #3d3d58; }
  .ht { width: 100%; border-collapse: separate; border-spacing: 0 5px; }
  .ht th { font-size: 8px; letter-spacing: .1em; text-transform: uppercase; color: #5d5d78; font-weight: 600; text-align: left; padding: 0 8px; border: 0; }
  .ht th.n, .ht td.n { text-align: right; }
  .ht td { background: #f4f5f9; padding: 6px 8px; border: 0; vertical-align: middle; font-size: 9.5px; }
  .ht td:first-child { border-radius: 10px 0 0 10px; padding: 5px; width: 34px; }
  .ht td:last-child { border-radius: 0 10px 10px 0; }
  .ht .tn { width: 30px; height: 53px; border-radius: 6px; background: #00003b center/cover no-repeat; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 10px; }
  .ht .hk { font-weight: 600; color: #00003b; font-size: 10px; line-height: 1.3; }
  .ht .hm { font-size: 8px; color: #5d5d78; margin-top: 2px; }
  .ht td.big { font-weight: 700; color: #00003b; font-size: 11px; font-variant-numeric: tabular-nums; }
  .tag { display: inline-block; border: 1px solid #d5d7e4; border-radius: 99px; padding: 0 6px; font-size: 7.5px; color: #3d3d58; margin-right: 4px; }
  .vc { display: grid; grid-template-columns: 118px 1fr; gap: 16px; border: 1px solid #e3e4ee; border-radius: 16px; padding: 14px; margin-bottom: 14px; page-break-inside: avoid; }
  .vc.herhalen { border: 2px solid ${GREEN}; }
  .vc .big { width: 118px; height: 210px; border-radius: 12px; background: #00003b center/cover no-repeat; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; }
  .vc .top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .vc .tt { font-weight: 700; color: #00003b; font-size: 11.5px; line-height: 1.35; }
  .vc .mt { font-size: 8.5px; color: #5d5d78; margin-top: 2px; }
  .sts { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin: 9px 0; text-align: center; }
  .sts div { background: #f4f5f9; border-radius: 8px; padding: 5px 2px 4px; }
  .sts div.hl { background: #00003b; color: #fff; }
  .sts b { display: block; font-size: 11px; font-variant-numeric: tabular-nums; }
  .sts span { font-size: 7px; opacity: .75; }
  .hookbox { background: #fff7e0; border-left: 4px solid #e2a400; border-radius: 0 10px 10px 0; padding: 7px 10px; margin-bottom: 8px; }
  .hookbox .t { font-weight: 600; color: #00003b; font-size: 10.5px; }
  .why { font-size: 9.5px; color: #3d3d58; margin-bottom: 8px; }
  .les3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .les3 div { border: 1px solid #e3e4ee; border-radius: 10px; padding: 6px 8px; font-size: 9px; line-height: 1.35; }
  .les3 div .lbl { display: block; margin-bottom: 2px; }
  .rol { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rc { border: 1px solid #e3e4ee; border-radius: 14px; padding: 12px 14px; page-break-inside: avoid; }
  .rc .h { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .rc .h b { color: #00003b; font-size: 12px; } .rc .h span { font-size: 8.5px; color: #5d5d78; }
  .rc ul { list-style: none; padding: 0; margin: 0; }
  .rc li { position: relative; padding-left: 18px; margin: 5px 0; font-size: 10px; }
  .rc li::before { content: ""; position: absolute; left: 0; top: 2px; width: 10px; height: 10px; border: 1.5px solid #00003b; border-radius: 3px; }
  .rc li small { display: block; color: #5d5d78; font-size: 8.5px; }
  .rc .leeg { color: #5d5d78; font-size: 9.5px; }
`;

const ROL_LABEL: Record<string, string> = { script: "Script", opname: "Opname", montage: "Montage", pm: "Projectmanager" };

function fullMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long" });
}
const sec = (n: number | null | undefined) => (typeof n === "number" ? `${Math.round(n)} s` : "–");
const pctv = (n: number | null | undefined) => (typeof n === "number" ? `${String(Math.round(n * 10) / 10).replace(".", ",")}%` : "–");
/** Eerste regel van de caption, zonder contact- en adresregels. */
const firstLine = (t: string) => { const l = (t || "").split("\n")[0]!.trim(); return l.length > 110 ? `${l.slice(0, 107)}…` : l; };
const shortDate = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }).replace(".", "") : "");

/** Gewogen (naar weergaven) gemiddelde over video's die de waarde hebben. */
function weighted(videos: InternVideo[], pick: (v: InternVideo) => number | null | undefined): number | null {
  const list = videos.filter((v) => typeof pick(v) === "number" && v.views > 0);
  const w = list.reduce((s, v) => s + v.views, 0);
  return w > 0 ? list.reduce((s, v) => s + (pick(v) as number) * v.views, 0) / w : null;
}

function hookOf(v: InternVideo): { text: string; bron: string } {
  if (v.analyse?.hook) return { text: v.analyse.hook, bron: v.analyse.hookBron === "script" ? "uit script" : "afgeleid uit caption" };
  if (v.scriptHook) return { text: v.scriptHook, bron: "uit script" };
  return { text: (v.titel || "").split(/[.!?\n]/)[0]!.slice(0, 110), bron: "eerste zin caption" };
}

function thumbDiv(cls: string, v: InternVideo): string {
  return v.thumb ? `<div class="${cls}" style="background-image:url('${v.thumb}')"></div>` : `<div class="${cls}">▶</div>`;
}

/** Hook-overzicht: alle video's in één scanbare tabel. */
function hookPages(videos: InternVideo[], meta: string, maand: string): string {
  if (videos.length === 0) return "";
  const pages: string[] = [];
  for (let start = 0; start < videos.length; start += HOOKS_PER_PAGE) {
    const rows = videos.slice(start, start + HOOKS_PER_PAGE).map((v, k) => {
      const i = start + k;
      const h = hookOf(v);
      const inter = v.likes + v.reacties + v.shares + v.saves;
      const verdict = v.analyse?.oordeel;
      return `<tr><td>${thumbDiv("tn", v)}</td><td><div class="hk">#${i + 1} ${esc(h.text)}</div><div class="hm">${v.analyse?.hookType ? `<span class="tag">${esc(v.analyse.hookType)}</span>` : ""}${esc(h.bron)} · ${esc([v.platform ? PLATFORM[v.platform] ?? v.platform : "", shortDate(v.datum)].filter(Boolean).join(" · "))}</div></td><td class="n big">${nf(v.views)}</td><td class="n">${sec(v.gemKijktijdSec)}</td><td class="n">${pctv(v.uitkijkPct)}</td><td class="n">${nf(inter)}</td><td>${verdict ? `<span class="verdict ${verdict}">${esc(verdict)}</span>` : ""}</td></tr>`;
    }).join("");
    pages.push(`<section class="page">${topBar(meta)}<h1>${start === 0 ? `Hooks van ${esc(maand)}` : "Hooks (vervolg)"}</h1>${start === 0 ? `<p class="lead">Alle video's op een rij, van meeste naar minste weergaven. Kijktijd en uitkijkpercentage zoals het platform ze meet ("–" = niet gemeten).</p>` : ""}<table class="ht"><tr><th></th><th>Hook</th><th class="n">Weergaven</th><th class="n">Gem. kijktijd</th><th class="n">Uitgekeken</th><th class="n">Interacties</th><th>Oordeel</th></tr>${rows}</table></section>`);
  }
  return pages.join("");
}

/** Per video een kaart: grote miniatuur, cijfers, hook, oordeel en de les per discipline. */
function videoCards(videos: InternVideo[], meta: string): string {
  if (videos.length === 0) return "";
  const card = (v: InternVideo, i: number) => {
    const a = v.analyse;
    const h = hookOf(v);
    const les3 = a && (a.script || a.opname || a.montage)
      ? `<div class="les3"><div><span class="lbl">Script</span>${esc(a.script || "–")}</div><div><span class="lbl">Opname</span>${esc(a.opname || "–")}</div><div><span class="lbl">Montage</span>${esc(a.montage || "–")}</div></div>`
      : v.les ? `<div class="why">${esc(v.les)}</div>` : "";
    return `<div class="vc ${a?.oordeel ?? ""}">${thumbDiv("big", v)}<div style="min-width:0">
      <div class="top"><div><div class="tt">#${i + 1} ${esc(firstLine(v.titel) || "Video")}</div><div class="mt">${esc([v.platform ? PLATFORM[v.platform] ?? v.platform : "", shortDate(v.datum)].filter(Boolean).join(" · "))}</div></div>${a ? `<span class="verdict ${a.oordeel}">${esc(a.oordeel)}</span>` : ""}</div>
      <div class="sts"><div class="hl"><b>${nf(v.views)}</b><span>weergaven</span></div><div class="hl"><b>${sec(v.gemKijktijdSec)}</b><span>gem. kijktijd</span></div><div class="hl"><b>${pctv(v.uitkijkPct)}</b><span>uitgekeken</span></div><div><b>${nf(v.likes)}</b><span>likes</span></div><div><b>${nf(v.reacties)}</b><span>reacties</span></div><div><b>${nf(v.shares)}</b><span>shares</span></div><div><b>${nf(v.saves)}</b><span>saves</span></div></div>
      <div class="hookbox"><span class="lbl">Hook · ${esc(h.bron)}${a?.hookType ? ` · ${esc(a.hookType)}` : ""}</span><div class="t">${esc(h.text)}</div></div>
      ${a?.waarom ? `<div class="why"><b>Waarom:</b> ${esc(a.waarom)}</div>` : ""}
      ${les3}
    </div></div>`;
  };
  const pages: string[] = [];
  for (let start = 0; start < videos.length; start += CARDS_PER_PAGE) {
    const chunk = videos.slice(start, start + CARDS_PER_PAGE).map((v, k) => card(v, start + k)).join("");
    pages.push(`<section class="page">${topBar(meta)}${start === 0 ? `<h1>Per video: wat leren we</h1><p class="lead">Per video de hook, de kijktijd en wat we meenemen naar script, opname en montage.</p>` : ""}${chunk}</section>`);
  }
  return pages.join("");
}

/**
 * Interne teamrapportage (PDF 2): alleen voor het Shortclips-team. Gebouwd rond
 * de video's: eerst de kern en doorgaan/stoppen/testen, dan het hook-overzicht,
 * per video een kaart met hook, kijktijd en lessen, de acties per rol en tot
 * slot de cijfers. Wat gemeten is staat los van interpretatie.
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
  const videos = input.videos ?? [];

  const gemKijktijd = weighted(videos, (x) => x.gemKijktijdSec);
  const gemUitkijk = weighted(videos, (x) => x.uitkijkPct ?? null);
  const telling = { herhalen: 0, aanpassen: 0, stoppen: 0 } as Record<string, number>;
  for (const x of videos) if (x.analyse) telling[x.analyse.oordeel] = (telling[x.analyse.oordeel] ?? 0) + 1;

  const kt = (label: string, value: string, extra = "") => `<div class="kt"><div class="v">${value}</div><div class="l">${esc(label)}</div>${extra}</div>`;

  const lst = (items: string[] | undefined) => (items ?? []).length ? `<ul>${(items ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div style="font-size:9.5px;opacity:.7">Geen punten deze maand.</div>`;
  const dst = i && ((i.doorgaan ?? []).length || (i.stoppen ?? []).length || (i.testen ?? []).length)
    ? `<div class="dst"><div class="dsc go"><div class="h">Doorgaan</div>${lst(i.doorgaan)}</div><div class="dsc stop"><div class="h">Stoppen of minder</div>${lst(i.stoppen)}</div><div class="dsc test"><div class="h">Testen</div>${lst(i.testen)}</div></div>`
    : "";

  const perRol = (rol: string, extra: string[] | undefined, wie: string) => {
    const acties = (i?.acties ?? []).filter((x) => x.rol === rol).map((x) => `<li>${esc(x.actie)}${x.waarom ? `<small>${esc(x.waarom)}</small>` : ""}</li>`);
    const items = [...acties, ...(extra ?? []).map((x) => `<li>${esc(x)}</li>`)];
    return `<div class="rc"><div class="h"><b>${esc(ROL_LABEL[rol] ?? rol)}</b><span>${esc(wie)}</span></div>${items.length ? `<ul>${items.join("")}</ul>` : `<div class="leeg">Geen specifieke punten.</div>`}</div>`;
  };
  const rollen = i ? `<div class="rol">${perRol("script", i.scripts, "scriptschrijvers")}${perRol("opname", i.opnames, "videografen")}${perRol("montage", i.montage, "editors")}${perRol("pm", [], pmName ? `verantwoordelijk: ${pmName}` : "projectmanager")}</div>` : "";

  const kpiRows = [
    ["Weergaven", nf(t.views), vm?.views, v?.vsGem3.views, v?.vsGem6.views],
    ["Interacties", nf(t.engagements), vm?.engagements, v?.vsGem3.engagements, v?.vsGem6.engagements],
    ["Video's", nf(t.posts), vm?.videos, v?.vsGem3.videos, v?.vsGem6.videos],
  ] as Array<[string, string, number | null | undefined, number | null | undefined, number | null | undefined]>;
  const cmp = `<table><tr><th>Cijfer</th><th class="n">${esc(maand)}</th><th class="n">t.o.v. ${esc(vorige)}</th><th class="n">t.o.v. gem. 3 mnd</th><th class="n">t.o.v. gem. 6 mnd</th></tr>${kpiRows.map(([l, val, d, g3, g6]) => `<tr><td>${esc(l)}</td><td class="n"><b>${val}</b></td><td class="n">${pctText(d)}</td><td class="n">${pctText(g3)}</td><td class="n">${pctText(g6)}</td></tr>`).join("")}</table>`;

  const beperkingen = [...new Set([...(i?.dataBeperkingen ?? []), ...ontbrekend])].map((x) => `<li>${esc(x)}</li>`).join("");
  const beoordeling = [
    ["Wat viel positief op?", b.positief], ["Wat willen we verbeteren?", b.verbeteren], ["Wat doen we volgende maand concreet?", b.volgendeMaand],
  ].filter(([, x]) => (x ?? "").trim()).map(([q, x]) => `<div class="box"><div class="lbl">${esc(q)}</div><div style="white-space:pre-line">${esc(x)}</div></div>`).join("");

  const oordeelRegel = videos.some((x) => x.analyse)
    ? `<div style="margin-top:8px;font-size:9.5px"><span class="verdict herhalen">${telling.herhalen ?? 0} herhalen</span> <span class="verdict aanpassen">${telling.aanpassen ?? 0} aanpassen</span> <span class="verdict stoppen">${telling.stoppen ?? 0} stoppen</span></div>`
    : "";

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
    <h1>${esc(maand.charAt(0).toUpperCase() + maand.slice(1))} in één oogopslag</h1>
    <p class="lead">Wat moet er anders in ${esc(volgende)}?</p>
    <div class="kpis k6">
      ${kt("Weergaven", nf(t.views), deltaPill(vm?.views, "pill", ` vs ${vorige}`))}
      ${kt("Video's", nf(t.posts), deltaPill(vm?.videos, "pill", ` vs ${vorige}`))}
      ${kt("Interacties", nf(t.engagements), deltaPill(vm?.engagements, "pill", ` vs ${vorige}`))}
      ${kt("Gem. kijktijd per video", sec(gemKijktijd), `<div class="pill na">gewogen naar weergaven</div>`)}
      ${kt("Gem. uitgekeken", pctv(gemUitkijk), `<div class="pill na">gewogen naar weergaven</div>`)}
      ${kt("Nieuwe volgers", signed(t.followerGrowth), deltaPill(vm?.followerGrowth, "pill", ` vs ${vorige}`))}
    </div>
    ${oordeelRegel}
    ${i?.kern ? `<h2>De kern</h2><div class="kern">${esc(i.kern)}</div>` : ""}
    ${dst ? `<h2>Doorgaan, stoppen, testen</h2>${dst}` : ""}
    ${!i ? `<p class="lead">De interne analyse ontbreekt nog. Gebruik 'AI opnieuw' op de controlepagina.</p>` : ""}
  </section>

  ${hookPages(videos, meta, maand)}

  ${videoCards(videos, meta)}

  ${rollen ? `<section class="page">
    ${topBar(meta)}
    <h1>Acties per rol voor ${esc(volgende)}</h1>
    <p class="lead">Wie past wat toe bij de volgende scripts, opnames en montages. Vink af wat gedaan is.</p>
    ${rollen}
  </section>` : ""}

  <section class="page">
    ${topBar(meta)}
    <h1>De cijfers</h1>
    ${platformBlock(t.platforms ?? [], vorige)}
    <h2>Vergelijking met eerdere maanden</h2>
    ${cmp}
    <ul style="margin-top:8px">${comparisonLines(v).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    ${historyTable(historie, true) ? `<h2>Afgelopen maanden</h2>${historyTable(historie, true)}` : ""}
    ${beoordeling ? `<h2>Beoordeling van het team</h2>${beoordeling}` : ""}
    ${beperkingen ? `<h2>Wat we niet konden meten</h2><ul>${beperkingen}</ul>` : ""}
  </section>`;

  return docShell(`Intern teamrapport ${clientName} ${periodLabel}`, CLIENT_CSS + CSS, body);
}
