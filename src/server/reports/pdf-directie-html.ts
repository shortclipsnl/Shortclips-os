import "server-only";
import { docShell, esc, escNum, LOGO, nf, signed, topBar, viewsBars, NAVY, MUTED, LINE, SOFT } from "./pdf-shared";
import { platformNaam, werkzaamheden, type DirectieData, type DirectieVariant } from "./directie";

/**
 * PDF van de directieversie van een maand (5 pagina's) en het directieoverzicht
 * op één A4, in de Shortclips-huisstijl van de bestaande
 * rapport-PDF's. Bedoeld voor een directeur die short video niet dagelijks volgt:
 * eerst wat Shortclips doet en wat is afgesproken, dan wat is uitgevoerd, wat
 * het opleverde, wat we leerden en wat we aanpassen.
 *
 * Bereik, betrokkenheid en aantoonbaar bedrijfsresultaat staan bewust in aparte
 * blokken; wat niet gemeten is, staat er als "niet gemeten".
 */

const GREEN = "#17784c";
const GREEN_BG = "#e3f4ec";

const CSS = `
  .page { display: flex; flex-direction: column; }
  .cover .msg { margin-top: 34px; max-width: 120mm; border-top: 1px solid rgba(255,255,255,.25); padding-top: 16px; font-size: 12.5px; line-height: 1.6; }
  .cover .cl { margin-top: 26px; display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 600; }
  .cover .cl img { width: 30px; height: 30px; margin: 0; border-radius: 7px; background: #fff; object-fit: contain; }
  .cover .vl { position: absolute; top: 14mm; right: 16mm; font-size: 8.5px; letter-spacing: .14em; text-transform: uppercase; border: 1px solid rgba(255,255,255,.4); border-radius: 99px; padding: 2px 10px; }
  .lead { max-width: 150mm; }
  .box h2, .navybox h2 { margin-top: 0; }
  .navybox h2 { color: #fff; opacity: .75; }
  .navybox .big { font-size: 13.5px; font-weight: 600; line-height: 1.4; }
  .kpi.na .v { color: #8a8aa0; font-size: 12.5px; padding: 5px 0 4px; }
  .kpi .d.up { color: ${GREEN}; } .kpi .d.fl { color: ${MUTED}; }
  .tg { display: inline-block; border-radius: 99px; padding: 0 7px; font-size: 8px; font-weight: 600; margin-left: 4px; white-space: nowrap; }
  .tg.m { background: ${GREEN_BG}; color: ${GREEN}; } .tg.a { background: #e9eaf1; color: ${NAVY}; } .tg.n { background: #f1f1f4; color: #6b6b85; }
  .three { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .four { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .navybox .row { margin-bottom: 7px; } .navybox .row:last-child { margin-bottom: 0; }
  .navybox .num { background: #fff; color: ${NAVY}; }
  .pf { margin-top: auto; padding-top: 8px; border-top: 1px solid ${LINE}; font-size: 8px; color: #8a8aa0; display: flex; justify-content: space-between; }
  .concept { position: absolute; top: 6mm; left: 16mm; font-size: 8px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; background: #fdeedd; color: #b4470b; border-radius: 5px; padding: 1px 8px; }
  .soft { background: ${SOFT}; border-radius: 10px; padding: 10px 12px; }
  td.t, th.t { font-weight: 700; color: ${NAVY}; }
`;

const nlDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dash = (n: number | null) => (n === null ? "–" : nf(n));
const M = `<span class="tg m">Gemeten</span>`;
const A = `<span class="tg a">Afgeleid</span>`;
const lijst = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} en ${xs[xs.length - 1]}`);

export function directieTitle(variant: DirectieVariant): string {
  return variant === "overzicht" ? "Directieoverzicht" : "Maandrapportage directie";
}

function delta(pct: number | null, versus: string | null): string {
  if (pct === null || !versus) return "";
  if (pct === 0) return `<div class="d fl">Gelijk aan ${esc(versus)}</div>`;
  return `<div class="d ${pct > 0 ? "up" : "fl"}">${pct > 0 ? "+" : "−"}${Math.abs(pct)}% t.o.v. ${esc(versus)}</div>`;
}
const kpi = (v: string, l: string, d = "") => `<div class="kpi"><div class="v">${v}</div><div class="l">${esc(l)}</div>${d}</div>`;
const kpiNa = (l: string) => `<div class="kpi na"><div class="v">Niet gemeten</div><div class="l">${esc(l)}</div></div>`;

/** Wat is afgesproken, in één regel. Leeg als de afname niet is vastgelegd. */
function afnameRegel(d: DirectieData): string {
  const a = d.afname;
  if (!a.focus) return "";
  const soort = a.focus === "organisch" ? "Organische short video content" : a.focus === "advertentie" ? "Videoadvertenties" : "Organische short video content en videoadvertenties";
  const delen = [soort];
  if (a.videosPerMaand) delen.push(`${a.videosPerMaand} video's per maand`);
  if (a.opnamedagenPerMaand) delen.push(`${a.opnamedagenPerMaand} ${a.opnamedagenPerMaand === 1 ? "opnamedag" : "opnamedagen"} per maand`);
  return delen.join(", ");
}

function blokken(d: DirectieData) {
  const { r, review, afname, uitgevoerd: u } = d;
  const versus = review.prevLabel;
  const kanalen = afname.kanalen.map(platformNaam);
  const imp = (label: string) => review.impact.gemeten.find((g) => g.label === label) ?? null;

  const bereik = [
    kpi(nf(r.metrics.views), "Weergaven", delta(r.deltas.views, versus)),
    kpi(nf(r.metrics.reach), "Bereik", delta(r.deltas.reach, versus)),
    kpi(signed(r.metrics.followerGrowth), "Nieuwe volgers", delta(r.deltas.followerGrowth, versus)),
  ].join("");
  const betrokken = [
    kpi(nf(r.metrics.engagements), "Likes, reacties, shares en opgeslagen", delta(r.deltas.engagements, versus)),
    r.valuableInteractions > 0 ? kpi(nf(r.valuableInteractions), "Keer gedeeld of opgeslagen") : kpiNa("Gedeeld of opgeslagen"),
    imp("Profielbezoeken") ? kpi(esc(imp("Profielbezoeken")!.value), "Profielbezoeken") : kpiNa("Profielbezoeken"),
  ].join("");
  const zakelijk = [
    imp("Linkklikken") ? kpi(esc(imp("Linkklikken")!.value), "Klikken naar de website") : kpiNa("Klikken naar de website"),
    kpiNa("Aanvragen"),
    imp("Conversies") ? kpi(esc(imp("Conversies")!.value), "Conversies") : kpiNa("Conversies en omzet"),
  ].join("");

  const maandRijen = u.maanden
    .map((m) => `<tr><td>${esc(m.label)}</td><td class="n">${nf(m.opnamedagen)}</td><td class="n">${dash(m.geproduceerd)}</td><td class="n">${dash(m.opgeleverd)}</td><td class="n">${nf(m.gepubliceerd)}</td><td class="n">${afname.videosPerMaand ? nf(afname.videosPerMaand) : "–"}</td></tr>`)
    .join("");
  const totaalRij = u.maanden.length > 1
    ? `<tr><td class="t">Totaal</td><td class="n t">${nf(u.totaal.opnamedagen)}</td><td class="n t">${dash(u.totaal.geproduceerd)}</td><td class="n t">${dash(u.totaal.opgeleverd)}</td><td class="n t">${nf(u.totaal.gepubliceerd)}</td><td class="n t">${dash(u.afgesproken)}</td></tr>`
    : "";
  const uitgevoerd = `<table><tr><th>Maand</th><th class="n">Opnamedagen</th><th class="n">Video's gemaakt</th><th class="n">Opgeleverd</th><th class="n">Gepubliceerd</th><th class="n">Afgesproken</th></tr>${maandRijen}${totaalRij}</table>
    ${u.totaal.geproduceerd === null ? `<p class="note">Een streepje bij gemaakt en opgeleverd betekent dat deze stappen voor dit account niet in het portaal worden bijgehouden. Het aantal gepubliceerde video's is wel gemeten.</p>` : ""}`;

  const werkt = review.works.length
    ? `<ul>${review.works.slice(0, 4).map((w) => `<li><b>${esc(w.label)}: ${esc(w.value)}</b>${w.quote ? ` (“${esc(w.quote)}”)` : ""}. ${esc(w.detail)} <span class="tg ${w.status === "bewezen" ? "m" : "a"}">${w.status === "bewezen" ? "Bewezen" : "Veelbelovend"}</span></li>`).join("")}</ul>`
    : `<p>${escNum(review.worksNote ?? "Er zijn nog geen conclusies beschikbaar.")}</p>`;
  const metViews = r.videos.filter((v) => v.views > 0);
  const opvallend: string[] = review.highlights.map((t) => `${escNum(t)} ${M}`);
  if (metViews.length >= 4) {
    const laag = metViews[metViews.length - 1]!;
    opvallend.push(`De minst bekeken video haalde ${nf(laag.views)} weergaven, de best bekeken ${nf(metViews[0]!.views)}. ${M}`);
  }
  const periodeLes = opvallend.length ? `<ul>${opvallend.slice(0, 3).map((t) => `<li>${t}</li>`).join("")}</ul>` : `<p>Voor deze periode zijn er geen cijfers per video beschikbaar.</p>`;

  const KIND: Record<string, string> = { behouden: "Blijven doen", verbeteren: "Verbeteren", testen: "Testen" };
  const acties = d.acties.length
    ? d.acties.map((a, i) => `<div class="row"><span class="num">${i + 1}</span><div><b>${KIND[a.kind]}.</b> ${esc(a.title)}</div></div>`).join("")
    : `<div>De actiepunten volgen zodra er genoeg video's met resultaten zijn, of staan bij de meest recente periode.</div>`;

  const gemeten = review.impact.gemeten.length
    ? `<ul>${review.impact.gemeten.slice(0, 6).map((g) => `<li><b>${esc(g.label)}: ${esc(g.value)}.</b> ${esc(g.note)}</li>`).join("")}</ul>`
    : `<p>Er zijn geen gemeten resultaten in deze periode.</p>`;
  const mogelijk = review.impact.afgeleid.length ? `<ul>${review.impact.afgeleid.slice(0, 3).map((t) => `<li>${escNum(t)}</li>`).join("")}</ul>` : `<p>Geen afgeleide effecten voor deze periode.</p>`;
  const nietGemeten = review.impact.nietGemeten.map((n) => n.label.toLowerCase());

  const conclusie = d.conclusie.map((c, i) => `<div class="row"><span class="num">${i + 1}</span><div><b>${esc(c.kop)}.</b> ${escNum(c.tekst)}</div></div>`).join("");
  const grafiek = d.historie.filter((m) => m.meetdagen > 0).length >= 2 ? viewsBars(d.historie) : "";

  return { bereik, betrokken, zakelijk, uitgevoerd, werkt, periodeLes, acties, gemeten, mogelijk, nietGemeten, conclusie, grafiek, kanalen, u };
}

export function renderDirectieHtml(d: DirectieData, variant: DirectieVariant, opts: { concept?: boolean } = {}): string {
  const title = directieTitle(variant);
  const meta = `${esc(d.clientName)}<br/>${esc(title)} · ${esc(d.label)}`;
  const b = blokken(d);
  const periode = `${nlDate(d.r.periodStart)} t/m ${nlDate(d.r.periodEnd)}`;
  const volgende = "de volgende maand";
  const concept = opts.concept ? `<div class="concept">Interne voorvertoning</div>` : "";
  const doc = (body: string) => docShell(`${title} ${d.label} ${d.clientName}`, CSS, body);

  if (!d.r.hasData || !d.review.summary) {
    return doc(`<section class="page">${topBar(meta)}<h1>${esc(title)}</h1><p class="lead">${esc(periode)}</p><div class="box">Voor deze periode zijn er nog geen resultaten beschikbaar. Zodra de kanalen cijfers leveren, verschijnen ze automatisch in dit rapport.</div></section>`);
  }

  const afname = afnameRegel(d);
  const werk = werkzaamheden(d.afname);
  const klantDoet = d.afname.focus === "advertentie"
    ? ["Scripts controleren", "Aanwezig zijn bij de opnames", "Video's goedkeuren"]
    : ["Scripts controleren", "Aanwezig zijn op de opnamedag", d.afname.plaatsing ? "Video's goedkeuren voor publicatie" : "Video's goedkeuren en zelf plaatsen"];

  /* ---------- Directieoverzicht op één A4 ---------- */
  if (variant === "overzicht") {
    const u = b.u.totaal;
    const gedaan = [
      u.opnamedagen > 0 ? `${u.opnamedagen} ${u.opnamedagen === 1 ? "opnamedag" : "opnamedagen"}` : "",
      u.geproduceerd !== null && u.geproduceerd > 0 ? `${nf(u.geproduceerd)} video's gemaakt` : "",
      `${nf(u.gepubliceerd)} ${u.gepubliceerd === 1 ? "video" : "video's"} gepubliceerd${b.kanalen.length ? ` op ${lijst(b.kanalen)}` : ""}`,
    ].filter(Boolean);
    const top = d.review.works[0];
    return doc(`
    <section class="page">${concept}
      ${topBar(meta)}
      <h1>${esc(title)} ${esc(d.label.toLowerCase())}</h1>
      <p class="lead">Shortclips is de externe afdeling voor short video content van ${esc(d.clientName)}.${afname ? ` Afname: ${esc(afname.charAt(0).toLowerCase() + afname.slice(1))}.` : ""}</p>
      <div class="four">
        ${kpi(`${nf(u.gepubliceerd)}${b.u.afgesproken ? ` van ${nf(b.u.afgesproken)}` : ""}`, b.u.afgesproken ? "Video's gepubliceerd van afgesproken" : "Video's gepubliceerd")}
        ${kpi(nf(d.r.metrics.views), "Weergaven", delta(d.r.deltas.views, d.review.prevLabel))}
        ${kpi(nf(d.r.metrics.reach), "Bereik", delta(d.r.deltas.reach, d.review.prevLabel))}
        ${kpi(signed(d.r.metrics.followerGrowth), "Nieuwe volgers")}
      </div>
      <div class="two" style="margin-top:10px">
        <div class="box"><h2>Wat hebben we gedaan</h2>${esc(lijst(gedaan))}.</div>
        <div class="box"><h2>Wat hebben we bereikt</h2>${escNum(d.review.summary.bereikt)}</div>
        <div class="box"><h2>Wat hebben we geleerd</h2>${top ? `${esc(top.label)}: ${esc(top.value)} werkt bij dit account het best (${esc(top.detail)}).` : esc(d.review.worksNote ?? "Er zijn nog geen conclusies beschikbaar.")}</div>
        <div class="box"><h2>Wat gaan we veranderen</h2>${escNum(d.review.summary.verbeteren)}</div>
      </div>
      ${b.grafiek ? `<h2>Weergaven per maand</h2>${b.grafiek}` : ""}
      <h2>Belangrijkste conclusie</h2>
      <div class="navybox"><p class="big">${escNum(d.conclusie[1]!.tekst)}</p><p>${esc(d.conclusie[4]!.kop)}: ${escNum(d.conclusie[4]!.tekst)}</p></div>
      <p class="note">Bereik en weergaven zijn gemeten in de gekoppelde kanalen. ${esc(capitalize(lijst(b.nietGemeten)))} ${b.nietGemeten.length === 1 ? "is" : "zijn"} niet gemeten; daarover doet dit rapport geen uitspraak.</p>
      <div class="pf"><span>Shortclips · ${esc(title)} · ${esc(d.clientName)}</span><span>${esc(periode)}</span></div>
    </section>`);
  }

  /* ---------- Volledige directieversie ---------- */
  const pages: string[] = [];
  const foot = (n: number, tot: number) => `<div class="pf"><span>Shortclips · ${esc(title)} ${esc(d.label)} · ${esc(d.clientName)}</span><span>Pagina ${n} van ${tot}</span></div>`;
  const TOT = 5;

  pages.push(`
  <section class="page cover">${concept}
    <div class="vl">Directieversie</div>
    <img src="${LOGO.dark}" alt="Shortclips" />
    <div class="kicker">${esc(title)}</div>
    <h1>${esc(d.clientName)}</h1>
    <div class="sub">${esc(d.label)}</div>
    <div class="msg">${esc(d.boodschap)}</div>
    ${d.logoDataUrl ? `<div class="cl"><img src="${d.logoDataUrl}" alt="" /> ${esc(d.clientName)}</div>` : ""}
    <div class="foot">Opgesteld door Shortclips, de externe afdeling voor short video content · ${esc(periode)}</div>
  </section>`);

  pages.push(`
  <section class="page">
    ${topBar(meta)}
    <h1>Wat doet Shortclips voor ${esc(d.clientName)}?</h1>
    <p class="lead">Shortclips is de externe afdeling voor short video content van ${esc(d.clientName)}. Wij bedenken en maken korte video's van minder dan een minuut${d.afname.plaatsing ? " en plaatsen ze" : ""}${b.kanalen.length ? ` voor ${esc(lijst(b.kanalen))}` : ""}.</p>
    <div class="two">
      <div class="box"><h2>Waarom deze samenwerking</h2>Short video vraagt eigen kennis en een vaste productie: onderwerpen kiezen, scripts schrijven, opnemen, monteren en bijsturen op resultaten. Shortclips neemt dat werk over, zodat ${esc(d.clientName)} er geen eigen medewerker voor nodig heeft.</div>
      <div class="box"><h2>Het doel</h2>${d.doel ? `Hoofddoel van de samenwerking: ${esc(d.doel.charAt(0).toLowerCase() + d.doel.slice(1))}.${d.strategie ? ` ${esc(d.strategie)}` : ""}` : `Zichtbaar zijn bij de doelgroep met content die past bij ${esc(d.clientName)}.`}</div>
    </div>
    <h2>Wat nemen jullie af</h2>
    <div class="navybox">${afname ? `<p class="big">${esc(afname)}</p>` : `<p class="big">De afname is nog niet vastgelegd in het portaal.</p>`}${b.kanalen.length ? `<p>Kanalen: ${esc(lijst(b.kanalen))}.</p>` : ""}</div>
    <div class="two" style="margin-top:12px">
      <div><h2>Dit doet Shortclips</h2>${werk.length ? werk.map((w) => `${werk.length > 1 ? `<div class="t" style="font-weight:600;color:${NAVY};margin:4px 0 2px">${esc(w.titel)}</div>` : ""}<ul>${w.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join("") : `<p>Nog niet vastgelegd.</p>`}</div>
      <div><h2>Dit doet ${esc(d.clientName)}</h2><ul>${klantDoet.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>
    </div>
    ${foot(2, TOT)}
  </section>`);

  const paginaD = `<h2>Uitgevoerd</h2>${b.uitgevoerd}
    ${b.u.formats.length ? `<h2>Ingezette formats</h2><div>${b.u.formats.map((f) => `<span class="chip">${esc(f.naam)} · ${f.aantal}</span>`).join(" ")}</div>` : ""}`;
  const paginaE = `
    <h2>Bereik: hoeveel mensen zagen de video's</h2><div class="three">${b.bereik}</div>
    <h2>Betrokkenheid: wie deed er iets mee</h2><div class="three">${b.betrokken}</div>
    <h2>Aantoonbaar bedrijfsresultaat</h2><div class="three">${b.zakelijk}</div>
    <p class="note">Bereik is geen omzet. Wat hier als niet gemeten staat, komt niet uit de social kanalen; daarvoor is een koppeling met de websitestatistieken of een aanvraagregistratie nodig. Er wordt niets geschat.</p>`;

  pages.push(`<section class="page">${topBar(meta)}<h1>Wat hebben we gedaan en bereikt?</h1><p class="lead">${esc(periode)}</p>${paginaD}${paginaE}${foot(3, TOT)}</section>`);

  pages.push(`
  <section class="page">
    ${topBar(meta)}
    <h1>Wat hebben we geleerd en wat passen we aan?</h1>
    ${b.grafiek ? `<h2>Weergaven per maand</h2>${b.grafiek}` : ""}
    <h2>Wat werkt voor dit account ${A}</h2>
    <div class="box">${b.werkt}<p class="note" style="margin-top:6px">Afgeleid uit alle video's tot nu toe. Bewezen = meerdere video's bevestigen het. Veelbelovend = eerste aanwijzing, nog te weinig video's voor zekerheid.</p></div>
    <h2>Opvallend in deze periode</h2>
    <div class="box">${b.periodeLes}</div>
    <h2>Wat gaan we doen in ${esc(volgende)}</h2>
    <div class="navybox">${b.acties}</div>
    ${foot(TOT - 1, TOT)}
  </section>`);

  pages.push(`
  <section class="page">
    ${topBar(meta)}
    <h1>Wat betekent dit voor ${esc(d.clientName)}?</h1>
    <div class="two">
      <div class="box"><h2>Gemeten</h2>${b.gemeten}</div>
      <div class="box"><h2>Mogelijk effect op langere termijn</h2>${b.mogelijk}<p class="note">Aannemelijk, maar niet rechtstreeks te meten.${b.nietGemeten.length ? ` Niet gemeten: ${esc(lijst(b.nietGemeten))}.` : ""}</p></div>
    </div>
    <h2>Conclusie voor de directie</h2>
    <div>${b.conclusie}</div>
    <div class="navybox" style="margin-top:8px"><h2>Stand van de samenwerking</h2><p class="big">${escNum(d.review.summary.bereikt)}</p><p>${escNum(d.review.summary.verbeteren)}</p></div>
    ${foot(TOT, TOT)}
  </section>`);

  return doc(pages.join(""));
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
