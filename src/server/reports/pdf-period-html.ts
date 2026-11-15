import "server-only";
import type { PortalResults } from "@/server/portal";
import type { PeriodReview } from "@/server/period-review";
import { capitalize } from "@/lib/portal-periods";
import { docShell, esc, LOGO, nf, signed, topBar } from "./pdf-shared";

/**
 * PDF van een periodeoverzicht (kwartaaloverzicht, maandoverzicht of een vrije
 * periode) in de Shortclips-huisstijl. Pagina 1 is het volledige overzicht op
 * één A4: managementsamenvatting, kerncijfers, vergelijking, wat werkt,
 * bedrijfsimpact en advies. Pagina 2 is de bijlage met de cijfers per platform
 * en de best presterende video's.
 *
 * Dezelfde gegevens als de resultatenpagina (PortalResults + PeriodReview): er
 * is dus geen tweede rapportagesysteem. De uitgebreide, door het team
 * gecontroleerde maandrapportage blijft de bestaande maand-PDF.
 */

const GREEN = "#12a150";
const GREEN_SOFT = "#e6f6ec";
const NAVY = "#00003b";

const CSS = `
  .page { padding: 0 0 12mm; }
  .hero { background: ${NAVY}; color: #fff; padding: 8mm 14mm 6.5mm; }
  .hero .r { display: flex; align-items: center; justify-content: space-between; }
  .hero img { height: 24px; }
  .hero .cl { font-size: 10px; opacity: .75; text-align: right; }
  .hero .k { letter-spacing: .24em; text-transform: uppercase; font-size: 8.5px; opacity: .65; font-weight: 600; margin-top: 10px; }
  .hero h1 { color: #fff; font-size: 22px; margin: 2px 0 1px; }
  .hero .s { font-size: 10.5px; opacity: .8; }
  .body { padding: 5.5mm 14mm 0; }
  h2 { margin: 10px 0 5px; }
  .ms { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .msc { background: #f4f5f9; border-radius: 12px; padding: 9px 11px; font-size: 9.3px; line-height: 1.45; }
  .msc .q { font-weight: 700; color: ${NAVY}; font-size: 10px; margin-bottom: 4px; display: flex; gap: 6px; }
  .msc .q b { flex: 0 0 auto; width: 16px; height: 16px; border-radius: 50%; background: ${NAVY}; color: #fff; font-size: 8.5px; display: flex; align-items: center; justify-content: center; }
  .kp { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; }
  .kc { background: ${NAVY}; color: #fff; border-radius: 12px; padding: 10px 11px 9px; }
  .kc .v { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .kc .l { font-size: 8.5px; opacity: .75; margin-top: 1px; }
  .pl { display: inline-block; border-radius: 99px; padding: 1px 7px; font-size: 8px; font-weight: 600; margin-top: 6px; background: rgba(255,255,255,.14); color: #fff; }
  .pl.up { background: ${GREEN_SOFT}; color: ${GREEN}; }
  .cols { display: grid; grid-template-columns: 1.15fr 1fr; gap: 12px; }
  .ct { width: 100%; border-collapse: separate; border-spacing: 0 3px; font-size: 9.5px; }
  .ct th { font-size: 7.8px; letter-spacing: .08em; text-transform: uppercase; color: #5d5d78; font-weight: 600; text-align: right; padding: 0 8px 1px; border: 0; }
  .ct th:first-child { text-align: left; }
  .ct td { background: #f4f5f9; padding: 5px 8px; border: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .ct td:first-child { text-align: left; border-radius: 8px 0 0 8px; font-weight: 600; color: ${NAVY}; }
  .ct td:last-child { border-radius: 0 8px 8px 0; font-weight: 700; }
  .ct td.c { background: ${NAVY}; color: #fff; font-weight: 700; }
  .up { color: ${GREEN}; } .dn { color: #3d3d58; } .na { color: #8a8aa0; }
  .mo { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .moc { border: 1px solid #e3e4ee; border-radius: 10px; padding: 7px 9px; }
  .moc .h { font-size: 8px; text-transform: uppercase; letter-spacing: .08em; color: #5d5d78; font-weight: 600; }
  .moc .v { font-size: 14px; font-weight: 700; color: ${NAVY}; font-variant-numeric: tabular-nums; }
  .moc .d { font-size: 8px; color: #5d5d78; }
  .moc .b { height: 4px; border-radius: 99px; background: #e9eaf1; margin: 5px 0 4px; overflow: hidden; } .moc .b div { height: 100%; background: ${NAVY}; }
  .wk { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .wkc { border: 1.5px solid ${NAVY}; border-radius: 10px; padding: 7px 9px; }
  .wkc .h { font-size: 7.8px; text-transform: uppercase; letter-spacing: .08em; color: #5d5d78; font-weight: 600; display: flex; justify-content: space-between; align-items: flex-start; gap: 4px; }
  .wkc .q { font-size: 8.4px; font-style: italic; color: #5d5d78; margin-top: 2px; }
  .wkc .v { font-size: 10.5px; font-weight: 700; color: ${NAVY}; line-height: 1.3; margin-top: 3px; }
  .wkc .d { font-size: 8px; color: #5d5d78; margin-top: 2px; }
  .tag { display: inline-block; border-radius: 99px; padding: 0 6px; font-size: 7.5px; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
  .tag.g { background: ${GREEN_SOFT}; color: ${GREEN}; } .tag.a { background: #e9eaf1; color: ${NAVY}; } .tag.n { background: #f1f1f4; color: #6b6b85; }
  .im { font-size: 9.2px; line-height: 1.45; }
  .im .rw { display: flex; gap: 7px; align-items: flex-start; padding: 2.5px 0; }
  .gm { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-bottom: 4px; }
  .gmc { background: #e6f6ec; border-radius: 8px; padding: 5px 8px; }
  .gmc b { display: block; font-size: 11.5px; color: #00003b; font-variant-numeric: tabular-nums; }
  .gmc span { font-size: 7.8px; color: #3f4a45; }
  .im .rw .tag { margin-top: 2px; flex: 0 0 auto; }
  .adv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
  .adc { background: ${NAVY}; color: #fff; border-radius: 12px; padding: 9px 11px 10px; }
  .adc .n { font-size: 8px; letter-spacing: .14em; text-transform: uppercase; color: #8fe0b0; font-weight: 700; }
  .adc .t { font-weight: 700; font-size: 10.5px; line-height: 1.35; margin: 3px 0; }
  .adc .w { font-size: 8.6px; opacity: .8; }
  .empty { border: 1px dashed #c9cbe0; border-radius: 10px; padding: 9px 11px; color: #5d5d78; font-size: 9.5px; }
  .foot { position: absolute; left: 14mm; right: 14mm; bottom: 6mm; font-size: 7.8px; color: #8a8aa0; display: flex; justify-content: space-between; }
  .p2 { padding: 16mm 14mm 18mm; }
`;

export type PeriodPdfInput = {
  clientName: string;
  r: PortalResults;
  review: PeriodReview;
};

const PLAT: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", linkedin: "LinkedIn" };
const nlDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function pill(pct: number | null, versus: string): string {
  if (pct === null) return `<span class="pl">geen vergelijking</span>`;
  if (pct === 0) return `<span class="pl">gelijk aan ${esc(versus)}</span>`;
  return `<span class="pl${pct > 0 ? " up" : ""}">${pct > 0 ? "+" : "−"}${Math.abs(pct)}% t.o.v. ${esc(versus)}</span>`;
}
function diff(pct: number | null): string {
  if (pct === null) return `<span class="na">–</span>`;
  if (pct === 0) return `<span class="na">gelijk</span>`;
  return `<span class="${pct > 0 ? "up" : "dn"}">${pct > 0 ? "+" : "−"}${Math.abs(pct)}%</span>`;
}

export function periodReportTitle(review: PeriodReview): string {
  return review.mode === "kwartaal" ? "Kwartaaloverzicht" : review.mode === "maand" ? "Maandoverzicht" : "Resultatenrapport";
}

export function renderPeriodReportHtml({ clientName, r, review }: PeriodPdfInput): string {
  const title = periodReportTitle(review);
  const label = capitalize(review.label);
  const running = review.mode !== "vrij" && !review.complete;
  const versus = review.prevLabel ?? "de vorige periode";
  const versusLong = review.prevLabel ? (running ? `dezelfde dagen in ${review.prevLabel}` : review.prevLabel) : "de vorige periode";
  const next = review.mode === "kwartaal" ? "het volgende kwartaal" : "de volgende periode";

  const hero = `
    <div class="hero">
      <div class="r"><img src="${LOGO.dark}" alt="Shortclips" /><div class="cl">${esc(clientName)}</div></div>
      <div class="k">${esc(title)}</div>
      <h1>${esc(label)}</h1>
      <div class="s">${esc(nlDate(r.periodStart))} t/m ${esc(nlDate(r.periodEnd))}${running ? " · deze periode loopt nog, de cijfers zijn voorlopig" : ""}</div>
    </div>`;

  if (!r.hasData || !review.summary) {
    const body = `<div class="page">${hero}<div class="body"><div class="empty" style="margin-top:14px">Voor deze periode zijn er nog geen resultaten beschikbaar. Zodra de kanalen cijfers leveren, verschijnen ze automatisch in dit rapport.</div></div></div>`;
    return docShell(`${title} ${label} ${clientName}`, CSS, body);
  }

  const s = review.summary;
  const ms = [
    [review.mode === "kwartaal" ? "Wat heeft Shortclips dit kwartaal bereikt?" : "Wat heeft Shortclips bereikt?", s.bereikt],
    ["Welke waarde heeft dit opgeleverd?", s.waarde],
    [review.mode === "kwartaal" ? "Wat gaan we volgend kwartaal verbeteren?" : "Wat gaan we verbeteren?", s.verbeteren],
  ].map(([q, a], i) => `<div class="msc"><div class="q"><b>${i + 1}</b><span>${esc(q)}</span></div>${esc(a)}</div>`).join("");

  const kpis = [
    ["Weergaven", nf(r.metrics.views), pill(r.deltas.views, versus)],
    ["Bereik", nf(r.metrics.reach), pill(r.deltas.reach, versus)],
    ["Interacties", nf(r.metrics.engagements), pill(r.deltas.engagements, versus)],
    ["Nieuwe volgers", signed(r.metrics.followerGrowth), pill(r.deltas.followerGrowth, versus)],
    ["Gepubliceerde video's", nf(r.metrics.publishedVideos), pill(r.deltas.publishedVideos, versus)],
  ].map(([l, v, p]) => `<div class="kc"><div class="v">${v}</div><div class="l">${esc(l)}</div>${p}</div>`).join("");

  const cmpRows = ([
    ["Weergaven", r.prev.views, r.metrics.views, r.deltas.views, nf],
    ["Bereik", r.prev.reach, r.metrics.reach, r.deltas.reach, nf],
    ["Interacties", r.prev.engagements, r.metrics.engagements, r.deltas.engagements, nf],
    ["Nieuwe volgers", r.prev.followerGrowth, r.metrics.followerGrowth, r.deltas.followerGrowth, signed],
    ["Gepubliceerde video's", r.prev.publishedVideos, r.metrics.publishedVideos, r.deltas.publishedVideos, nf],
  ] as Array<[string, number, number, number | null, (n: unknown) => string]>)
    .map(([l, p, c, d, f]) => `<tr><td>${esc(l)}</td><td>${f(p)}</td><td class="c">${f(c)}</td><td>${diff(d)}</td></tr>`).join("");
  const cmp = `<table class="ct"><tr><th>Vergeleken met ${esc(versusLong)}</th><th>${esc(capitalize(versus))}</th><th>${esc(label)}</th><th>Verschil</th></tr>${cmpRows}</table>`;

  const maxM = Math.max(1, ...review.months.map((m) => m.views));
  const months = review.months.length
    ? `<div class="mo">${review.months.map((m) => `<div class="moc"><div class="h">${esc(capitalize(m.label))}</div>${m.measured
        ? `<div class="v">${nf(m.views)}</div><div class="b"><div style="width:${Math.max(4, Math.round((m.views / maxM) * 100))}%"></div></div><div class="d">weergaven · ${m.videos} video's · ${signed(m.followers)} volgers</div>`
        : `<div class="d" style="margin-top:4px">Nog geen cijfers</div>`}</div>`).join("")}</div>`
    : "";
  const best = r.videos.filter((v) => v.views > 0).slice(0, 3);
  const bestList = best.length
    ? `<div class="im">${best.map((v, i) => `<div class="rw"><span class="tag a">${i + 1}</span><span><b style="color:${NAVY}">${esc(v.title)}</b> · ${nf(v.views)} weergaven</span></div>`).join("")}</div>`
    : `<div class="empty">Voor deze periode zijn er geen cijfers per video beschikbaar.</div>`;

  const works = review.works.length
    ? `<div class="wk">${review.works.slice(0, 4).map((w) => `<div class="wkc"><div class="h"><span>${esc(w.label)}</span><span class="tag ${w.status === "bewezen" ? "g" : "a"}">${w.status === "bewezen" ? "Bewezen" : "Veelbelovend"}</span></div><div class="v">${esc(w.value)}</div>${w.quote ? `<div class="q">“${esc(w.quote)}”</div>` : ""}<div class="d">${esc(w.detail)}</div></div>`).join("")}</div>`
    : `<div class="empty">${esc(review.worksNote ?? "Nog geen conclusies beschikbaar.")}</div>`;

  const gemeten = review.impact.gemeten.slice(0, 6);
  const impactRows = [
    gemeten.length
      ? `<div class="rw" style="padding-bottom:1px"><span class="tag g">Gemeten</span><span>Rechtstreeks uit de kanalen:</span></div><div class="gm">${gemeten.map((g) => `<div class="gmc"><b>${esc(g.value)}</b><span>${esc(g.label)}</span></div>`).join("")}</div>`
      : "",
    ...review.impact.afgeleid.slice(0, 2).map((t) => `<div class="rw"><span class="tag a">Afgeleid</span><span>${esc(t)}</span></div>`),
    `<div class="rw"><span class="tag n">Niet gemeten</span><span>${esc(review.impact.nietGemeten.map((n) => n.label).join(", "))}. Deze gegevens komen niet uit de social kanalen.</span></div>`,
  ].join("");

  const KIND: Record<string, string> = { behouden: "Behouden", verbeteren: "Verbeteren", testen: "Anders aanpakken" };
  const advice = review.advice.length
    ? `<div class="adv">${review.advice.slice(0, 3).map((a) => `<div class="adc"><div class="n">${KIND[a.kind]}</div><div class="t">${esc(a.title)}</div><div class="w">${esc(a.text)}</div></div>`).join("")}</div>`
    : `<div class="empty">Het advies voor ${esc(next)} volgt zodra er genoeg video's met resultaten zijn, of staat bij de meest recente periode.</div>`;

  const page1 = `
  <div class="page">
    ${hero}
    <div class="body">
      <h2 style="margin-top:0">Managementsamenvatting</h2>
      <div class="ms">${ms}</div>
      <h2>Belangrijkste resultaten</h2>
      <div class="kp">${kpis}</div>
      <div class="cols">
        <div><h2>Vergelijking</h2>${cmp}${months ? `<h2>Per maand</h2>${months}` : ""}</div>
        <div><h2>Best presterende content</h2>${bestList}<h2>Bedrijfsimpact</h2><div class="im">${impactRows}</div></div>
      </div>
      <h2>Wat werkt voor dit bedrijf <span class="tag a" style="letter-spacing:0;text-transform:none">Afgeleid uit alle video's tot nu toe</span></h2>
      ${works}
      <h2>Advies voor ${esc(next)}</h2>
      ${advice}
    </div>
    <div class="foot"><span>Shortclips · ${esc(title)} ${esc(label)} · ${esc(clientName)}</span><span>Cijfers automatisch uit de gekoppelde kanalen${r.lastUpdated ? `, bijgewerkt op ${esc(nlDate(r.lastUpdated))}` : ""}</span></div>
  </div>`;

  // Bijlage: per platform en de best presterende video's.
  const plats = r.platforms.filter((p) => p.state === "data");
  const dash = (n: number | null, f: (n: unknown) => string = nf) => (n === null ? "–" : f(n));
  const platTable = plats.length
    ? `<table><tr><th>Platform</th><th class="n">Weergaven</th><th class="n">Bereik</th><th class="n">Interacties</th><th class="n">Volgers</th><th class="n">Video's</th></tr>${plats.map((p) => `<tr><td><b>${esc(PLAT[p.platform] ?? p.platform)}</b></td><td class="n">${dash(p.views)}</td><td class="n">${dash(p.reach)}</td><td class="n">${dash(p.interactions)}</td><td class="n">${dash(p.followerGrowth, signed)}</td><td class="n">${p.videoCount}</td></tr>`).join("")}</table>`
    : `<div class="empty">Geen cijfers per platform voor deze periode.</div>`;
  const missing = r.platforms.filter((p) => p.state !== "data").map((p) => `${PLAT[p.platform] ?? p.platform} (${p.state === "stil" ? "geen activiteit" : "niet gekoppeld"})`);
  const top = r.videos.filter((v) => v.views > 0).slice(0, 12);
  const videoTable = top.length
    ? `<table><tr><th>#</th><th>Video</th><th>Geplaatst</th><th>Platforms</th><th class="n">Weergaven</th><th class="n">Likes</th><th class="n">Reacties</th><th class="n">Shares</th></tr>${top.map((v, i) => `<tr><td>${i + 1}</td><td><b>${esc(v.title)}</b></td><td>${esc(nlDate(v.publishedAt))}</td><td>${esc(v.platforms.map((x) => PLAT[x.platform] ?? x.platform).join(", "))}</td><td class="n">${nf(v.views)}</td><td class="n">${nf(v.likes)}</td><td class="n">${nf(v.comments)}</td><td class="n">${nf(v.shares)}</td></tr>`).join("")}</table>`
    : `<div class="empty">Voor deze periode zijn er geen cijfers per video beschikbaar via de gekoppelde kanalen.</div>`;
  const highlights = review.highlights.length ? `<h2>Opvallend in deze periode</h2><ul>${review.highlights.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "";

  const page2 = `
  <div class="page p2">
    ${topBar(`${esc(clientName)}<br/>${esc(title)} ${esc(label)} · bijlage`)}
    <h1>Cijfers in detail</h1>
    <p class="lead">${esc(nlDate(r.periodStart))} t/m ${esc(nlDate(r.periodEnd))}</p>
    <h2>Per platform</h2>
    ${platTable}
    ${missing.length ? `<p class="note">Geen cijfers van: ${esc(missing.join(", "))}. Een streepje betekent dat het platform dit cijfer niet levert; er wordt niets geschat.</p>` : `<p class="note">Een streepje betekent dat het platform dit cijfer niet levert; er wordt niets geschat.</p>`}
    <h2>Best presterende video's</h2>
    ${videoTable}
    ${highlights}
    <p class="note">Gemeten = rechtstreeks uit de gekoppelde kanalen. Afgeleid = een conclusie die Shortclips uit die cijfers trekt. Vergelijking: ${esc(nlDate(r.prevStart))} t/m ${esc(nlDate(r.prevEnd))}; een percentage staat er alleen als er over die periode genoeg gegevens zijn.</p>
  </div>`;

  return docShell(`${title} ${label} ${clientName}`, CSS, page1 + page2);
}
