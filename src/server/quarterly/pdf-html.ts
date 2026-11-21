import "server-only";
import { CLIENT_CSS } from "@/server/reports/pdf-html";
import { docShell, esc, escNum, LOGO, nf, pctText, signed, topBar } from "@/server/reports/pdf-shared";
import { PAKKET_LABEL, QUARTER_STATUS_META, kortDatum, langDatum, type HealthCriterium, type QuarterStatus } from "@/lib/kwartaal";
import type { Inzicht, QuarterIntern, QuarterKlant } from "@/lib/kwartaal-inhoud";
import type { KlantMetrics, KlantRapport } from "@/lib/kwartaal-klant";
import type { QuarterMetrics, SegmentCijfers } from "./metrics";

/**
 * PDF-opmaak van de kwartaalrapportage in de bestaande Shortclips-huisstijl
 * (zelfde bouwstenen als de maandrapportage). Twee documenten:
 *  - de klantversie, die uitsluitend `KlantRapport` als invoer accepteert;
 *  - de interne versie met de volledige cijfers en de interne verdieping.
 */

const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube Shorts", linkedin: "LinkedIn", totaal: "Alle kanalen" };
const plat = (p: string) => PLATFORM[p] ?? p;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const p = (t: string) => (t ? `<p>${escNum(t)}</p>` : "");
const ZEK: Record<string, string> = { bewezen: "Volgt uit de cijfers", waarschijnlijk: "Waarschijnlijk", hypothese: "Vermoeden, nog te toetsen" };

const EXTRA_CSS = `
  .q4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .dir { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .dirc { border: 1px solid #e3e4ee; border-radius: 12px; padding: 12px 14px; page-break-inside: avoid; }
  .dirc .h { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #5d5d78; font-weight: 700; margin-bottom: 5px; }
  .tag { display: inline-block; border-radius: 99px; padding: 1px 8px; font-size: 8px; font-weight: 600; background: #e9eaf1; color: #5d5d78; margin-left: 6px; vertical-align: 1px; }
  .imp { border: 1px solid #e3e4ee; border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; page-break-inside: avoid; }
  .imp .t { font-weight: 700; color: #00003b; font-size: 11.5px; margin-bottom: 6px; }
  .imp dl { display: grid; grid-template-columns: 118px 1fr; gap: 3px 10px; margin: 0; font-size: 10px; }
  .imp dt { color: #5d5d78; } .imp dd { margin: 0; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
  .charts .chart { height: 96px; }
  .lrn { border: 1px solid #e3e4ee; border-radius: 12px; padding: 10px 13px; margin-bottom: 7px; page-break-inside: avoid; }
  .lrn .h { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #5d5d78; font-weight: 700; margin-bottom: 4px; }
  .lrn .i { margin: 4px 0; } .lrn .i b { color: #00003b; } .lrn .i span { color: #5d5d78; }
  .vidq { display: grid; grid-template-columns: 62px 1fr; gap: 14px; border: 1px solid #e3e4ee; border-radius: 14px; padding: 11px 13px; margin-bottom: 9px; page-break-inside: avoid; }
  .vidq .th { width: 62px; height: 110px; border-radius: 9px; }
  .vidq .t { font-weight: 700; color: #00003b; font-size: 11.5px; line-height: 1.35; }
  .vidq .m { font-size: 9px; color: #5d5d78; margin: 2px 0 6px; }
  .vidq .w { font-size: 10px; margin-top: 5px; } .vidq .w b { color: #00003b; }
  .warn { border-left: 4px solid #f59e0b; background: #fff7e6; border-radius: 0 10px 10px 0; padding: 9px 12px; margin-bottom: 7px; font-size: 10px; page-break-inside: avoid; }
  .hc { display: grid; grid-template-columns: 150px 78px 1fr; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 1px solid #eef0f5; font-size: 10px; }
  .hc:last-child { border-bottom: 0; } .hc b { color: #00003b; }
  .lvl { display: inline-block; border-radius: 99px; padding: 2px 9px; font-size: 8.5px; font-weight: 700; text-align: center; }
  .lvl.goed { background: #e6f6ec; color: #12a150; } .lvl.aandacht { background: #fff3d6; color: #9a6a00; } .lvl.zorg { background: #fde8e8; color: #b42318; } .lvl.onbekend { background: #e9eaf1; color: #5d5d78; }
  .bron { font-size: 8px; color: #5d5d78; margin-top: 14px; border-top: 1px solid #e3e4ee; padding-top: 8px; }
`;

function pill(pct: number | null | undefined): string {
  if (typeof pct !== "number") return `<div class="pill na">Geen vergelijking</div>`;
  const cls = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  return `<div class="pill ${cls}">${pct > 0.5 ? "▲" : pct < -0.5 ? "▼" : "•"} ${pctText(pct)} t.o.v. vorig kwartaal</div>`;
}
const kpi = (label: string, value: string, pct?: number | null, sub?: string) =>
  `<div class="kt"><div class="v">${value}</div><div class="l">${esc(label)}</div>${pct === undefined ? (sub ? `<div class="pill na">${esc(sub)}</div>` : "") : pill(pct)}</div>`;

function barChart(segs: SegmentCijfers[], value: (s: SegmentCijfers) => number | null, fmt: (v: number) => string = nf): string {
  const vals = segs.map((s) => (s.dagen > 0 && s.meetdagen > 0 ? value(s) : null));
  if (vals.every((v) => v === null)) return `<p class="lead" style="margin:0">Niet gemeten in dit kwartaal.</p>`;
  const max = Math.max(...vals.map((v) => Math.abs(v ?? 0)), 1);
  const top = Math.max(...vals.map((v) => v ?? -Infinity));
  const cols = segs.map((s, i) => {
    const v = vals[i];
    return `<div class="col${v !== null && v === top ? " peak" : ""}"><div class="bv">${v === null ? "–" : esc(fmt(v))}</div><div class="b" style="height:${v === null ? 2 : Math.max(4, Math.round((Math.abs(v) / max) * 100))}%"></div></div>`;
  }).join("");
  return `<div class="chart">${cols}</div><div class="labels">${segs.map((s) => `<div>${esc(s.label)}</div>`).join("")}</div>`;
}

const inz = (list: Inzicht[]) => list.map((i) => `<div class="i"><b>${esc(i.punt)}</b>${i.zekerheid !== "bewezen" ? `<span class="tag">${esc(ZEK[i.zekerheid] ?? i.zekerheid)}</span>` : ""}${i.onderbouwing ? `<br><span>${escNum(i.onderbouwing)}</span>` : ""}</div>`).join("");
const lrn = (titel: string, list: Inzicht[]) => (list.length ? `<div class="lrn"><div class="h">${esc(titel)}</div>${inz(list)}</div>` : "");

/* ------------------------------------------------------------------ *
 * Gedeelde secties (klantgegevens)
 * ------------------------------------------------------------------ */

function kpiSection(m: KlantMetrics): string {
  const t = m.totaal;
  const pct = m.vorig?.vergelijkbaar ? m.vorig.pct : null;
  const c = (k: keyof NonNullable<typeof pct>) => (pct ? (pct[k] ?? null) : null);
  const extra: string[] = [];
  if (t.engagementPct !== null) extra.push(kpi("Interacties per 100 weergaven", t.engagementPct.toLocaleString("nl-NL"), undefined, "Gemiddelde"));
  if (m.kijktijd.gemSec !== null) extra.push(kpi("Gemiddelde kijktijd", `${m.kijktijd.gemSec} sec`, undefined, `${m.kijktijd.videosMetMeting} video's gemeten`));
  if (m.kijktijd.uitkijkPct !== null) extra.push(kpi("Uitkijkpercentage", `${m.kijktijd.uitkijkPct.toLocaleString("nl-NL")}%`, undefined, "Gemiddelde"));
  if (m.profielbezoeken !== null) extra.push(kpi("Profielbezoeken", nf(m.profielbezoeken), undefined, "Totaal"));
  if (m.websiteKlikken !== null) extra.push(kpi("Websiteklikken", nf(m.websiteKlikken), undefined, "Totaal"));
  if (m.conversies !== null) extra.push(kpi("Conversies", nf(m.conversies), undefined, "Totaal"));
  return `
    <div class="kpis">
      ${kpi("Gepubliceerde video's", nf(t.videos), c("videos"))}
      ${kpi("Weergaven", nf(t.views), c("views"))}
      ${kpi("Bereik (opgeteld per kanaal)", nf(t.reach), c("reach"))}
      ${kpi("Interacties", nf(t.engagements), c("engagements"))}
      ${kpi("Weergaven per video", t.gemViewsPerVideo !== null ? nf(t.gemViewsPerVideo) : "–", c("gemViewsPerVideo"))}
      ${kpi("Groei in volgers", signed(t.followerGrowth), c("followerGrowth"))}
    </div>
    ${extra.length ? `<div class="kpis" style="margin-top:10px">${extra.slice(0, 6).join("")}</div>` : ""}
    ${m.vorig && !m.vorig.vergelijkbaar ? `<p class="note">Een vergelijking met ${esc(m.vorig.label)} is niet opgenomen, omdat de twee periodes niet eerlijk te vergelijken zijn.</p>` : ""}
    ${!m.vorig ? `<p class="note">Dit is het eerste kwartaal van de samenwerking; er is nog geen eerder kwartaal om mee te vergelijken.</p>` : ""}`;
}

function platformRows(m: KlantMetrics): string {
  const list = m.platforms.filter((x) => x.views > 0 || x.publicaties > 0);
  if (list.length === 0) return "";
  return `<h2>Per kanaal</h2><table><tr><th>Kanaal</th><th class="n">Weergaven</th><th class="n">Bereik</th><th class="n">Interacties</th><th class="n">Volgers</th><th class="n">Plaatsingen</th></tr>${list.map((x) => `<tr><td>${esc(plat(x.platform))}</td><td class="n">${nf(x.views)}</td><td class="n">${x.meetdagen ? nf(x.reach) : "–"}</td><td class="n">${x.meetdagen ? nf(x.engagements) : "–"}</td><td class="n">${x.meetdagen ? signed(x.followerGrowth) : "–"}</td><td class="n">${nf(x.publicaties)}</td></tr>`).join("")}</table>`;
}

function videoCards(klant: QuarterKlant, m: KlantMetrics, thumbs: Record<string, string>): string {
  const byKey = new Map(m.topVideos.map((v) => [v.key, v]));
  return klant.topVideos.map((t, i) => {
    const v = byKey.get(t.key);
    if (!v) return "";
    const th = thumbs[v.id];
    const chips = [
      `<span class="chip2">${nf(v.views)} weergaven</span>`,
      v.engagementPct !== null ? `<span class="chip2">${v.engagementPct.toLocaleString("nl-NL")} interacties per 100 weergaven</span>` : "",
      v.gemKijktijdSec !== null ? `<span class="chip2 g">${v.gemKijktijdSec} sec kijktijd</span>` : "",
      v.uitkijkPct !== null ? `<span class="chip2 g">${v.uitkijkPct.toLocaleString("nl-NL")}% uitgekeken</span>` : "",
    ].join("");
    return `<div class="vidq"><div class="th" style="${th ? `background-image:url('${th}')` : ""}">${th ? "" : i + 1}</div><div>
      <div class="t">${i + 1}. ${esc(v.titel)}</div>
      <div class="m">${v.datum ? esc(langDatum(v.datum)) : ""}${v.platforms.length ? ` · ${esc(v.platforms.map(plat).join(", "))}` : ""} · ${nf(v.likes)} likes · ${nf(v.reacties)} reacties · ${nf(v.shares)} shares · ${nf(v.saves)} saves</div>
      <div class="chips">${chips}</div>
      ${t.waarom ? `<div class="w"><b>Waarom dit werkte:</b> ${escNum(t.waarom)}${t.zekerheid !== "bewezen" ? `<span class="tag">${esc(ZEK[t.zekerheid] ?? "")}</span>` : ""}</div>` : ""}
      ${t.meenemen ? `<div class="w"><b>Dit nemen we mee:</b> ${escNum(t.meenemen)}</div>` : ""}
    </div></div>`;
  }).join("");
}

function opgeleverdBlock(klant: QuarterKlant, m: KlantMetrics): string {
  const g = m.geleverd;
  const tiles = [
    kpi("Opnamesessies", nf(g.opnamedagen)),
    g.pipelineBijgehouden ? kpi("Video's geproduceerd", nf(g.geproduceerd)) : "",
    kpi("Video's gepubliceerd", nf(g.gepubliceerd)),
    kpi("Concepten en scripts", nf(g.concepten)),
    kpi("Plaatsingen op de kanalen", nf(g.plaatsingen)),
    m.pakket.verwachtInKwartaal !== null ? kpi("Afgesproken voor dit kwartaal", nf(m.pakket.verwachtInKwartaal)) : "",
  ].filter(Boolean).join("");
  const doelen = m.doelen.length
    ? `<h2>Doelen en realisatie</h2><table><tr><th>Doel</th><th class="n">Doel</th><th class="n">Gerealiseerd</th><th class="n">Behaald</th></tr>${m.doelen.map((d) => `<tr><td>${esc(d.label)}</td><td class="n">${nf(d.target)}</td><td class="n">${d.gerealiseerd === null ? "Niet gemeten" : nf(d.gerealiseerd)}</td><td class="n">${d.behaald === null ? "–" : d.behaald ? "Ja" : "Nog niet"}</td></tr>`).join("")}</table>`
    : "";
  return `
    <div class="kpis">${tiles}</div>
    ${klant.opgeleverd.tekst ? `<h2>Shortclips als jullie contentafdeling</h2><div class="soft">${p(klant.opgeleverd.tekst)}</div>` : ""}
    ${klant.opgeleverd.diensten.length ? `<div class="chips" style="margin-top:8px">${klant.opgeleverd.diensten.map((d) => `<span class="chip2">${esc(cap(d))}</span>`).join("")}</div>` : ""}
    ${m.pakket.bijzonderheden.length ? m.pakket.bijzonderheden.map((b) => `<p class="note">${esc(b)}</p>`).join("") : ""}
    ${doelen}`;
}

/* ------------------------------------------------------------------ *
 * Klantversie
 * ------------------------------------------------------------------ */

export function renderQuarterKlantHtml(r: KlantRapport): string {
  const { klant: k, metrics: m } = r;
  const meta = `${esc(r.clientName)} · Kwartaalrapportage ${esc(r.periodLabel)}`;
  const s = k.samenvatting;
  const periode = `${kortDatum(r.periodStart)} t/m ${langDatum(r.periodEnd)}`;
  const tegen = s.tegenvallers.map((t) => `<div class="hlc"><div><b>${esc(t.wat)}</b>${t.oorzaak ? `<br>${esc(t.oorzaak)}${t.zekerheid !== "bewezen" ? `<span class="tag">${esc(ZEK[t.zekerheid] ?? "")}</span>` : ""}` : ""}</div></div>`).join("");
  const heeftGeleerd = k.geleerd.onderwerpen.length + k.geleerd.hooks.length + k.geleerd.formats.length + k.geleerd.lengtes.length + k.geleerd.presentatoren.length + k.geleerd.doelgroep.length + k.geleerd.vaker.length + k.geleerd.minder.length > 0;
  const bron = `<div class="bron">Bronnen en meetperiode: ${m.bronnen.map((b) => `${esc(b.naam)} (${esc(b.periode)})`).join("; ")}. Alle cijfers zijn gemeten; er zijn geen geschatte of aangevulde waarden opgenomen.</div>`;

  const body = `
  <section class="page cover">
    <img src="${LOGO.dark}" alt="Shortclips" />
    <div class="kicker">Kwartaalrapportage</div>
    <h1>${esc(r.clientName)}</h1>
    <div class="sub">${esc(r.periodLabel)}</div>
    <div class="sub" style="font-size:11px;opacity:.65;margin-top:6px">${esc(periode)}</div>
    <div class="foot">Samengesteld door Shortclips op basis van de gemeten cijfers. Geen geschatte of verzonnen data.</div>
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Managementsamenvatting</h1>
    <p class="lead">Het kwartaal in één minuut.</p>
    <div class="navybox">${p(s.kern)}</div>
    ${s.resultaten.length ? `<h2>Belangrijkste resultaten</h2><ul class="checks">${s.resultaten.map((x) => `<li>${escNum(x)}</li>`).join("")}</ul>` : ""}
    ${s.positief ? `<h2>Grootste positieve ontwikkeling</h2><div class="hl"><div class="hlc pos"><div>${escNum(s.positief)}</div></div></div>` : ""}
    ${s.inzichten.length ? `<h2>Belangrijkste inzichten uit de content</h2><ul class="checks min">${s.inzichten.map((x) => `<li>${escNum(x)}</li>`).join("")}</ul>` : ""}
    ${tegen ? `<h2>Wat tegenviel en waarom</h2><div class="hl">${tegen}</div>` : ""}
    ${s.verbeterd.length ? `<h2>Wat Shortclips heeft verbeterd</h2><ul class="checks">${s.verbeterd.map((x) => `<li>${escNum(x)}</li>`).join("")}</ul>` : ""}
    ${s.kans ? `<h2>Belangrijkste kans voor het volgende kwartaal</h2><div class="kans"><div class="t">${esc(s.kans)}</div></div>` : ""}
    ${s.advies ? `<h2>Ons advies voor de komende drie maanden</h2><div class="soft">${p(s.advies)}</div>` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>De belangrijkste cijfers</h1>
    <p class="lead">Resultaten over ${esc(periode)}. Totalen, gemiddelden en groeipercentages staan apart vermeld.</p>
    ${kpiSection(m)}
    ${platformRows(m)}
    ${m.platforms.filter((x) => x.platform !== "totaal").length > 1 ? `<p class="note">Bereik is per kanaal opgeteld. Iemand die via twee kanalen is bereikt, telt twee keer mee.</p>` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Wat Shortclips heeft opgeleverd</h1>
    <p class="lead">Wat jullie de afgelopen drie maanden concreet hebben gekregen.</p>
    ${opgeleverdBlock(k, m)}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Ontwikkeling gedurende het kwartaal</h1>
    <p class="lead">Hoe de resultaten zich over de drie maanden hebben ontwikkeld.</p>
    <div class="charts">
      <div><h2>Weergaven</h2>${barChart(m.segmenten, (x) => x.views)}</div>
      <div><h2>Bereik</h2>${barChart(m.segmenten, (x) => x.reach)}</div>
      <div><h2>Interacties per 100 weergaven</h2>${barChart(m.segmenten, (x) => x.engagementPct, (v) => v.toLocaleString("nl-NL"))}</div>
      <div><h2>Groei in volgers</h2>${barChart(m.segmenten, (x) => x.followerGrowth, (v) => signed(v))}</div>
      <div><h2>Weergaven per video</h2>${barChart(m.segmenten, (x) => x.gemViewsPerVideo)}</div>
      <div><h2>Gepubliceerde video's</h2>${barChart(m.segmenten, (x) => x.videos)}</div>
    </div>
    ${k.trends.length ? `<h2>Opvallende trends</h2><div class="dev">${k.trends.map((t, i) => `<div class="devc"><div class="n">${i + 1}</div><div><b>${esc(t.titel)}</b><br>${esc(t.beschrijving)}${t.verklaring ? `<br><span style="color:#5d5d78">${esc(t.verklaring)}</span>${t.zekerheid !== "bewezen" ? `<span class="tag">${esc(ZEK[t.zekerheid] ?? "")}</span>` : ""}` : ""}</div></div>`).join("")}</div>` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Best presterende content</h1>
    <p class="lead">Gekozen op weergaven, interactie en kijktijd, en op het doel waarvoor de video is gemaakt.</p>
    ${videoCards(k, m, r.thumbs) || `<p class="lead">Voor dit kwartaal zijn geen cijfers per video beschikbaar.</p>`}
  </section>

  ${heeftGeleerd ? `<section class="page">
    ${topBar(meta)}
    <h1>Wat hebben we geleerd?</h1>
    <p class="lead">Inzichten over jullie doelgroep, gebaseerd op de eigen resultaten van dit kwartaal.</p>
    ${lrn("Onderwerpen die werken", k.geleerd.onderwerpen)}
    ${lrn("Openingszinnen die aandacht trekken", k.geleerd.hooks)}
    ${lrn("Formats", k.geleerd.formats)}
    ${lrn("Videolengte", k.geleerd.lengtes)}
    ${lrn("Presentatoren", k.geleerd.presentatoren)}
    ${lrn("Vragen en reacties van de doelgroep", k.geleerd.doelgroep)}
    <div class="two" style="margin-top:10px">
      ${k.geleerd.vaker.length ? `<div><h2>Dit maken we vaker</h2><ul class="checks">${k.geleerd.vaker.map((x) => `<li>${escNum(x)}</li>`).join("")}</ul></div>` : "<div></div>"}
      ${k.geleerd.minder.length ? `<div><h2>Dit maken we minder vaak</h2><ul class="checks min">${k.geleerd.minder.map((x) => `<li>${escNum(x)}</li>`).join("")}</ul></div>` : "<div></div>"}
    </div>
  </section>` : ""}

  <section class="page">
    ${topBar(meta)}
    <h1>Zakelijke impact</h1>
    <p class="lead">Wat aantoonbaar is, wat een indicatie is en wat niet gemeten kan worden.</p>
    ${k.impact.direct.length ? `<h2>Direct meetbare resultaten</h2><ul class="checks">${k.impact.direct.map((x) => `<li>${escNum(x)}</li>`).join("")}</ul>` : ""}
    ${k.impact.indirect.length ? `<h2>Indirecte indicatoren</h2><ul class="checks min">${k.impact.indirect.map((x) => `<li>${escNum(x)}</li>`).join("")}</ul>` : ""}
    ${k.impact.kwalitatief.length ? `<h2>Kwalitatieve inzichten</h2><ul class="checks min">${k.impact.kwalitatief.map((x) => `<li>${escNum(x)}</li>`).join("")}</ul>` : ""}
    ${k.impact.nietMeetbaar ? `<h2>Wat we niet kunnen meten</h2><div class="soft">${p(k.impact.nietMeetbaar)}</div>` : ""}
    ${k.verbeterpunten.length ? `<h2>Verbeterpunten en kansen</h2>${k.verbeterpunten.map((v, i) => `<div class="imp"><div class="t">${i + 1}. ${esc(v.constatering)}</div><dl><dt>Waarom belangrijk</dt><dd>${esc(v.belang)}</dd><dt>Actie van Shortclips</dt><dd>${esc(v.actie)}</dd><dt>Verwacht resultaat</dt><dd>${esc(v.verwachtResultaat)}</dd>${v.verantwoordelijke ? `<dt>Verantwoordelijke</dt><dd>${esc(cap(v.verantwoordelijke))}</dd>` : ""}</dl></div>`).join("")}` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Plan voor het volgende kwartaal</h1>
    <p class="lead">Zo vertalen we de inzichten naar de komende drie maanden.</p>
    ${k.plan.binnenPakket.length ? `<h2>Binnen jullie huidige pakket</h2><div class="steps">${k.plan.binnenPakket.map((a, i) => `<div class="step"><div class="sn">Actie ${i + 1}</div><div class="st">${esc(a.titel)}</div><div class="sw">${esc(a.toelichting)}</div></div>`).join("")}</div>` : ""}
    ${k.plan.aanvullend.length ? `<h2>Aanvullende voorstellen (buiten het huidige pakket)</h2>${k.plan.aanvullend.map((a) => `<div class="kans"><div class="t">${esc(a.titel)}</div><div class="s">${esc(a.toelichting)}</div></div>`).join("")}` : ""}
    <h2>Conclusie</h2>
    <div class="concl">
      ${p(k.conclusie.kern)}
      ${k.conclusie.bereikt ? `<div class="h" style="margin-top:10px">Wat is er bereikt</div>${p(k.conclusie.bereikt)}` : ""}
      ${k.conclusie.kansen ? `<div class="h" style="margin-top:10px">Waar liggen de grootste kansen</div>${p(k.conclusie.kansen)}` : ""}
      ${k.conclusie.verbeteringen ? `<div class="h" style="margin-top:10px">Wat Shortclips verbetert</div>${p(k.conclusie.verbeteringen)}` : ""}
      ${k.conclusie.prioriteiten.length ? `<div class="h" style="margin-top:10px">Prioriteiten voor de komende drie maanden</div><ul>${k.conclusie.prioriteiten.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </div>
    ${bron}
  </section>`;

  return docShell(`Kwartaalrapportage ${r.clientName} ${r.periodLabel}`, CLIENT_CSS + EXTRA_CSS, body);
}

/** Compact directieoverzicht: één pagina, in twee minuten te lezen. */
export function renderQuarterDirectieHtml(r: KlantRapport): string {
  const { klant: k, metrics: m } = r;
  const d = k.directie;
  const body = `
  <section class="page">
    ${topBar(`${esc(r.clientName)} · Directieoverzicht ${esc(r.periodLabel)}`)}
    <h1>Directieoverzicht ${esc(r.periodLabel)}</h1>
    <p class="lead">${esc(r.clientName)} · ${esc(kortDatum(r.periodStart))} t/m ${esc(langDatum(r.periodEnd))}</p>
    ${kpiSection(m)}
    <h2>In vier antwoorden</h2>
    <div class="dir">
      <div class="dirc"><div class="h">Wat hebben we bereikt?</div>${escNum(d.bereikt)}</div>
      <div class="dirc"><div class="h">Wat heeft het opgeleverd?</div>${escNum(d.opgeleverd)}</div>
      <div class="dirc"><div class="h">Wat hebben we geleerd?</div>${escNum(d.geleerd)}</div>
      <div class="dirc"><div class="h">Wat doen we volgend kwartaal?</div>${escNum(d.volgend)}</div>
    </div>
    <div class="bron">Volledige onderbouwing in de kwartaalrapportage. Alle cijfers zijn gemeten, niets is geschat.</div>
  </section>`;
  return docShell(`Directieoverzicht ${r.clientName} ${r.periodLabel}`, CLIENT_CSS + EXTRA_CSS, body);
}

/* ------------------------------------------------------------------ *
 * Interne versie
 * ------------------------------------------------------------------ */

export type InternPdfInput = {
  clientName: string; pmName: string | null; title: string; periodLabel: string; periodStart: string; periodEnd: string;
  status: QuarterStatus; voorlopig: boolean; versie: number; approvedAt: string | null;
  metrics: QuarterMetrics; klant: QuarterKlant; klantMetrics: KlantMetrics; intern: QuarterIntern; ontbrekend: string[];
  health: HealthCriterium[]; thumbs: Record<string, string>;
};

export function renderQuarterInternHtml(i: InternPdfInput): string {
  const m = i.metrics;
  const meta = `INTERN · ${esc(i.clientName)} · ${esc(i.periodLabel)}`;
  const s = i.klant.samenvatting;
  const stand = `${QUARTER_STATUS_META[i.status].label}${i.voorlopig ? " · voorlopige cijfers" : ""} · versie ${i.versie}`;
  const rows = m.segmenten.map((x) => `<tr><td>${esc(cap(x.label))}</td><td class="n">${x.meetdagen ? nf(x.views) : "–"}</td><td class="n">${x.meetdagen ? nf(x.reach) : "–"}</td><td class="n">${x.meetdagen ? nf(x.engagements) : "–"}</td><td class="n">${x.meetdagen ? nf(x.likes) : "–"}</td><td class="n">${x.meetdagen ? nf(x.comments) : "–"}</td><td class="n">${x.meetdagen ? nf(x.shares) : "–"}</td><td class="n">${x.meetdagen ? nf(x.saves) : "–"}</td><td class="n">${x.meetdagen ? signed(x.followerGrowth) : "–"}</td><td class="n">${nf(x.videos)}</td><td class="n">${x.meetdagen}/${x.dagen}</td></tr>`).join("");
  const videos = m.videos.slice(0, 25).map((v, n) => `<tr><td>${n + 1}</td><td>${esc(v.titel.slice(0, 70))}</td><td>${esc(v.platforms.map(plat).join(", "))}</td><td class="n">${nf(v.views)}</td><td class="n">${v.engagementPct === null ? "–" : v.engagementPct.toLocaleString("nl-NL")}</td><td class="n">${v.gemKijktijdSec === null ? "–" : `${v.gemKijktijdSec}s`}</td><td class="n">${v.uitkijkPct === null ? "–" : `${v.uitkijkPct.toLocaleString("nl-NL")}%`}</td><td>${esc(v.format ?? "–")}</td></tr>`).join("");

  const body = `
  <section class="page cover">
    <img src="${LOGO.dark}" alt="Shortclips" />
    <div class="kicker">Interne kwartaalrapportage · niet delen met de klant</div>
    <h1>${esc(i.clientName)}</h1>
    <div class="sub">${esc(i.periodLabel)}</div>
    <div class="sub" style="font-size:11px;opacity:.65;margin-top:6px">${esc(stand)}${i.pmName ? ` · verantwoordelijke: ${esc(i.pmName)}` : ""}</div>
    <div class="foot">Alleen voor bevoegde medewerkers van Shortclips.</div>
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Hoe staat deze samenwerking ervoor</h1>
    <p class="lead">${esc(kortDatum(i.periodStart))} t/m ${esc(langDatum(i.periodEnd))} · ${esc(PAKKET_LABEL[m.pakket.type])}${m.pakket.videosPerMaand !== null ? ` · ${m.pakket.videosPerMaand} video's per maand` : ""} · bron pakket: ${esc(m.pakket.bron)}</p>
    ${i.intern.kern ? `<div class="navybox">${p(i.intern.kern)}</div>` : ""}
    <h2>Kwartaalgezondheid (per criterium, met onderbouwing)</h2>
    <div class="box">${i.health.map((h) => `<div class="hc"><b>${esc(h.label)}</b><span class="lvl ${h.niveau}">${esc(h.niveau === "onbekend" ? "Onbekend" : cap(h.niveau))}</span><span>${esc(h.toelichting)}</span></div>`).join("")}</div>
    ${i.ontbrekend.length ? `<h2>Ontbrekende gegevens</h2>${i.ontbrekend.map((o) => `<div class="warn">${esc(o)}</div>`).join("")}` : ""}
    ${m.dataKwaliteit.length ? `<h2>Datakwaliteit</h2><ul>${m.dataKwaliteit.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
    ${m.vorig && !m.vorig.vergelijkbaar ? `<h2>Vergelijking met ${esc(m.vorig.label)}</h2><ul>${m.vorig.redenen.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Alle resultaten</h1>
    <p class="lead">Volledige cijfers per maand, per kanaal en per video.</p>
    ${kpiSection(i.klantMetrics)}
    <h2>Per maand</h2>
    <table><tr><th>Periode</th><th class="n">Weergaven</th><th class="n">Bereik</th><th class="n">Interacties</th><th class="n">Likes</th><th class="n">Reacties</th><th class="n">Shares</th><th class="n">Saves</th><th class="n">Volgers</th><th class="n">Video's</th><th class="n">Gemeten</th></tr>${rows}</table>
    ${platformRows(i.klantMetrics)}
    <h2>Geleverd</h2>
    <table><tr><th>Opnamesessies</th><th>Geproduceerd</th><th>Opgeleverd</th><th>Gepubliceerd</th><th>Plaatsingen</th><th>Concepten</th><th>Afgesproken</th></tr><tr><td>${nf(m.geleverd.opnamedagen)}</td><td>${m.geleverd.pipelineBijgehouden ? nf(m.geleverd.geproduceerd) : "Niet bijgehouden"}</td><td>${m.geleverd.pipelineBijgehouden ? nf(m.geleverd.opgeleverd) : "Niet bijgehouden"}</td><td>${nf(m.geleverd.gepubliceerd)}</td><td>${nf(m.geleverd.plaatsingen)}</td><td>${nf(m.geleverd.concepten)}</td><td>${m.pakket.verwachtInKwartaal === null ? "Niet vastgelegd" : nf(m.pakket.verwachtInKwartaal)}</td></tr></table>
    ${m.pakket.bijzonderheden.map((b) => `<p class="note">${esc(b)}</p>`).join("")}
    ${m.pakket.type === "advertentie" || m.pakket.type === "beide" ? `<div class="warn">${esc(m.advertenties.toelichting)}</div>` : ""}
  </section>

  ${videos ? `<section class="page">
    ${topBar(meta)}
    <h1>Video's van het kwartaal</h1>
    <p class="lead">Unieke video's, ontdubbeld over kanalen. Weergaven en interacties zijn per video over de kanalen opgeteld.</p>
    <table><tr><th>#</th><th>Video</th><th>Kanalen</th><th class="n">Weergaven</th><th class="n">Interacties per 100</th><th class="n">Kijktijd</th><th class="n">Uitgekeken</th><th>Format</th></tr>${videos}</table>
    ${m.formats.length ? `<h2>Formats</h2><table><tr><th>Format</th><th class="n">Video's</th><th class="n">Weergaven</th><th class="n">Gemiddeld per video</th></tr>${m.formats.map((f) => `<tr><td>${esc(f.format)}</td><td class="n">${f.videos}</td><td class="n">${nf(f.views)}</td><td class="n">${nf(f.gemViews)}</td></tr>`).join("")}</table>` : ""}
  </section>` : ""}

  <section class="page">
    ${topBar(meta)}
    <h1>Kritische analyse</h1>
    <p class="lead">Waar wij zelf beter moeten worden.</p>
    ${i.intern.risicos.length ? `<h2>Risico's</h2>${i.intern.risicos.map((r) => `<div class="warn"><b>${esc(r.titel)}</b><br>${esc(r.toelichting)}</div>`).join("")}` : ""}
    ${s.tegenvallers.length ? `<h2>Tegenvallende prestaties</h2>${s.tegenvallers.map((t) => `<div class="box"><div class="t">${esc(t.wat)}</div><div class="s">${esc(t.oorzaak)} <span class="tag">${esc(ZEK[t.zekerheid] ?? "")}</span></div></div>`).join("")}` : ""}
    ${i.intern.kritisch.length ? `<h2>Kritische verbeterpunten voor Shortclips</h2><ul>${i.intern.kritisch.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${m.verbetermonitor ? `<h2>Opvolging verbeterpunten uit ${esc(m.verbetermonitor.periodLabel)}</h2><table><tr><th>Verbeterpunt</th><th>Status</th><th>Notitie</th></tr>${m.verbetermonitor.items.map((x) => `<tr><td>${esc(x.titel)}</td><td>${esc(cap(x.status))}</td><td>${esc(x.note ?? "")}</td></tr>`).join("")}</table>${i.intern.opvolging ? `<div class="soft" style="margin-top:8px">${p(i.intern.opvolging)}</div>` : ""}` : `<p class="note">Er is geen vorige kwartaalrapportage met verbeterpunten om op te volgen.</p>`}
    ${i.intern.acties.length ? `<h2>Nog uit te voeren acties</h2><table><tr><th>Actie</th><th>Wie</th><th>Waarom</th></tr>${i.intern.acties.map((a) => `<tr><td>${esc(a.actie)}</td><td>${esc(cap(a.rol))}</td><td>${esc(a.waarom)}</td></tr>`).join("")}</table>` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Voorbereiding klantgesprek</h1>
    <p class="lead">Niet voor de klant bestemd.</p>
    ${i.intern.gesprek.length ? `<h2>Adviezen voor het gesprek</h2><ul class="checks min">${i.intern.gesprek.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${i.intern.commercieel.length ? `<h2>Commerciële kansen</h2>${i.intern.commercieel.map((c) => `<div class="kans"><div class="t">${esc(c.kans)}</div><div class="s">${esc(c.onderbouwing)}</div></div>`).join("")}` : ""}
    ${i.intern.toelichting ? `<h2>Interne toelichting</h2><div class="soft">${i.intern.toelichting.split(/\n+/).map(p).join("")}</div>` : ""}
    <h2>Wat de klant te zien krijgt</h2>
    <div class="soft">${p(s.kern)}${p(i.klant.conclusie.kern)}</div>
    <h2>Bronnen en meetperiodes</h2>
    <table><tr><th>Bron</th><th>Periode</th><th>Opmerking</th></tr>${m.bronnen.map((b) => `<tr><td>${esc(b.naam)}</td><td>${esc(b.periode)}</td><td>${esc(b.opmerking ?? "")}</td></tr>`).join("")}</table>
  </section>`;

  return docShell(`Interne kwartaalrapportage ${i.clientName} ${i.periodLabel}`, CLIENT_CSS + EXTRA_CSS, body);
}
