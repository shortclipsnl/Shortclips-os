import "server-only";
import { LOGO_ONDARK } from "@/server/reports/brand-assets";
import { FONT_LINK } from "@/server/reports/pdf-shared";
import { PLATFORM_ICON_PATHS } from "@/components/platform-icon";
import { STATE_LABEL, type ChecklistState } from "@/lib/content-planning-status";
import { CP_CLOSING_BG, CP_COVER_BG } from "./assets";
import type { ContentPlanningOverview, PlanningPost } from "./overview";

/**
 * Contentplanning-PDF in de Shortclips-huisstijl, nagebouwd op het
 * voorbeeldbestand "Contentplanning 2026 Shortclips": voorpagina, één
 * "Short video kalender" per week, "Jouw contentplanning. Alles staat klaar."
 * en de afsluiter "Tijd om impact te maken.". A4 liggend.
 *
 * Alles komt uit ContentPlanningOverview (één bron voor klant én team).
 * Ontbrekende gegevens blijven leeg; er wordt niets ingevuld.
 */

const NAVY = "#00003b";
const ACCENT = "#3d84ff";
const PILL = "#cbdeff";
const LINE = "#ceceda";
const MUTED = "#a9a9bd";
const CARD = "#0f0f47";
const CARD_LINE = "#3b3b6b";

const DAYS = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const MONTHS = ["JANUARI", "FEBRUARI", "MAART", "APRIL", "MEI", "JUNI", "JULI", "AUGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DECEMBER"];
/** Vanaf dit aantal posts op één dag loopt de week door op een vervolgpagina. */
const MAX_ROWS = 6;
const MIN_ROWS = 4;

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoWeek(iso: string): { week: number; year: number } {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // donderdag
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { week, year };
}
const dayNum = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDate();
const monthIdx = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCMonth();
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function icon(platform: string, size: number, color = NAVY): string {
  const p = PLATFORM_ICON_PATHS[platform];
  if (!p) return "";
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" aria-label="${esc(platform)}"><path d="${p.path}"/></svg>`;
}

const PLAY = `<svg viewBox="0 0 24 24" width="9" height="9" fill="#fff"><path d="M7 4.5v15l12-7.5z"/></svg>`;

const CSS = `
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Poppins, Arial, sans-serif; color: ${NAVY}; }
  .page { width: 297mm; height: 210mm; position: relative; overflow: hidden; page-break-after: always; }
  .page:last-child { page-break-after: auto; }

  /* Voorpagina en afsluiter: het originele beeld uit het voorbeeldbestand. */
  .bgimg { background-size: cover; background-position: center; background-color: ${NAVY}; }
  .cover-meta { position: absolute; left: 0; right: 0; bottom: 14mm; text-align: center; color: rgba(255,255,255,.62); font-size: 9.5pt; letter-spacing: .02em; }
  .cover-meta b { color: #fff; font-weight: 600; }

  /* Kalenderpagina: donkerblauwe band met wit kaartvlak. */
  .cal { background: linear-gradient(${NAVY} 0, ${NAVY} 56mm, #f1f1f5 56mm, #f7f7f9 100%); }
  .card { position: absolute; left: 10.5mm; right: 10.5mm; top: 12mm; bottom: 12mm; background: #fff; border-radius: 9mm;
          box-shadow: 0 3mm 7mm rgba(0,0,40,.10), 0 .4mm 1.2mm rgba(0,0,40,.08); padding: 10mm 11mm 9mm; display: flex; flex-direction: column; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .year { color: ${ACCENT}; font-weight: 700; font-size: 15pt; line-height: 1; }
  .title-row { display: flex; align-items: center; gap: 5mm; margin-top: 1.6mm; }
  .title { font-weight: 700; font-size: 24pt; letter-spacing: -.01em; line-height: 1.05; }
  .month { background: ${PILL}; color: ${ACCENT}; font-weight: 700; font-size: 10.5pt; border-radius: 99px; padding: 1.6mm 9mm; letter-spacing: .02em; white-space: nowrap; }
  .chan { display: inline-flex; align-items: center; gap: 2mm; margin-top: 3mm; border: .55mm solid ${NAVY}; border-radius: 99px; padding: .6mm 3mm .6mm .6mm; font-size: 7pt; font-weight: 600; }
  .chan .play { width: 5.4mm; height: 5.4mm; border-radius: 50%; background: ${NAVY}; display: grid; place-items: center; }
  .chan .ics { display: inline-flex; gap: 1.1mm; align-items: center; margin-left: .6mm; }
  .week { text-align: right; font-size: 15pt; line-height: 1.15; }
  .week b { display: block; font-size: 21pt; font-weight: 700; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); gap: 4.6mm; margin-top: 6mm; min-height: 0; }
  .day { border: .6mm solid ${LINE}; border-radius: 5mm; display: flex; flex-direction: column; overflow: hidden; }
  .dh { text-align: center; font-weight: 700; font-size: 8.5pt; padding: 1.8mm 1mm 1.6mm; border-bottom: .6mm solid ${LINE}; line-height: 1.15; }
  .dh small { display: block; font-weight: 500; font-size: 6.5pt; color: #8a8aa6; margin-top: .3mm; }
  .day.today .dh { background: ${PILL}; }
  .slots { flex: 1; display: grid; }
  .slot { border-bottom: .6mm solid ${LINE}; padding: 1.5mm 1.8mm; display: flex; flex-direction: column; gap: .8mm; min-height: 0; overflow: hidden; }
  .slot:last-child { border-bottom: 0; }
  .slot .t { font-size: 7.4pt; font-weight: 700; color: ${ACCENT}; line-height: 1; }
  .slot .n { font-size: 8.6pt; font-weight: 600; line-height: 1.22; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .slot .p { display: flex; gap: 1mm; align-items: center; margin-top: auto; }
  .slot .on { font-size: 6pt; font-weight: 600; color: #17784c; margin-left: auto; }
  .dense .slot .n { -webkit-line-clamp: 2; font-size: 7.8pt; }
  .foot { display: flex; justify-content: space-between; margin-top: 3mm; font-size: 6.8pt; color: #8a8aa6; }
  .empty-note { position: absolute; left: 0; right: 0; top: 50%; text-align: center; color: #8a8aa6; font-size: 10pt; }

  /* Jouw contentplanning */
  .stat { background: ${NAVY}; color: #fff; padding: 22mm 20mm 16mm; }
  .stat .logo { position: absolute; top: 20mm; right: 20mm; height: 12mm; }
  .kicker { color: #2e7bff; font-weight: 700; font-size: 14.5pt; letter-spacing: .01em; }
  .stat h1 { font-size: 31pt; font-weight: 700; margin: .5mm 0 3mm; letter-spacing: -.01em; line-height: 1.1; }
  .intro { color: ${MUTED}; font-size: 10.5pt; line-height: 1.5; max-width: 200mm; margin: 0; }
  .sect { font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: ${MUTED}; font-weight: 600; margin: 10mm 0 3.5mm; }
  .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4mm; }
  .sc { background: ${CARD}; border: .45mm solid ${CARD_LINE}; border-radius: 3mm; padding: 4.6mm 4.6mm 5mm; min-height: 56mm; display: flex; flex-direction: column; }
  .sc .ct { font-weight: 700; font-size: 11.5pt; line-height: 1.25; margin-top: auto; }
  .sc .cd { color: ${MUTED}; font-size: 8.8pt; line-height: 1.4; margin-top: 1.4mm; }
  .badge { align-self: flex-start; font-size: 7.4pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; border-radius: 99px; padding: 1mm 2.6mm; }
  .b-done { background: #172a75; color: #2e7bff; }
  .b-preparing { background: rgba(255,255,255,.08); color: #c9c9dc; }
  .b-action { background: rgba(255,154,60,.18); color: #ffb067; }
  .b-na { background: transparent; color: #8a8aa6; border: .35mm dashed #4a4a78; }
  .sc.na { opacity: .72; }
  .sc.action { border-color: #8a5a2e; }
  .client { display: grid; grid-template-columns: 1fr; }
  .client .sc { min-height: 0; flex-direction: row; align-items: center; gap: 6mm; padding: 5.5mm 6mm; }
  .client .sc .cd { margin-top: 0; }
  .client .sc .ct { margin-top: 0; }
  .note { margin-top: 11mm; font-size: 9.5pt; }
  .note b { display: block; font-weight: 700; }
  .note span { color: ${MUTED}; }
  .gen { position: absolute; bottom: 9mm; right: 18mm; font-size: 6.5pt; color: #6d6d92; }
`;

/** Weken met minstens één post; een week met >MAX_ROWS op één dag krijgt vervolgpagina's. */
function weekPages(o: ContentPlanningOverview): Array<{ monday: string; byDay: PlanningPost[][]; part: number; parts: number }> {
  const byWeek = new Map<string, PlanningPost[]>();
  for (const p of o.posts) {
    const d = new Date(`${p.scheduledOn}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const k = d.toISOString().slice(0, 10);
    (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(p);
  }
  const mondays = [...byWeek.keys()].sort();
  if (mondays.length === 0) mondays.push(o.fromMonday);
  const pages: Array<{ monday: string; byDay: PlanningPost[][]; part: number; parts: number }> = [];
  for (const m of mondays) {
    const days: PlanningPost[][] = Array.from({ length: 7 }, (_, i) => (byWeek.get(m) ?? []).filter((p) => p.scheduledOn === addDays(m, i)));
    const maxDay = Math.max(0, ...days.map((d) => d.length));
    const parts = Math.max(1, Math.ceil(maxDay / MAX_ROWS));
    for (let part = 0; part < parts; part++) {
      pages.push({ monday: m, byDay: days.map((d) => d.slice(part * MAX_ROWS, (part + 1) * MAX_ROWS)), part, parts });
    }
  }
  return pages;
}

function slotHtml(p: PlanningPost | undefined): string {
  if (!p) return `<div class="slot"></div>`;
  const ics = p.platforms.map((pl) => icon(pl, 10)).join("");
  return `<div class="slot">
    ${p.scheduledAt ? `<div class="t">${esc(p.scheduledAt)} uur</div>` : ""}
    <div class="n">${esc(p.title)}</div>
    <div class="p">${ics}${p.status === "published" ? `<span class="on">online</span>` : ""}</div>
  </div>`;
}

function calendarPage(o: ContentPlanningOverview, pg: ReturnType<typeof weekPages>[number], channels: string[]): string {
  const { week, year } = isoWeek(pg.monday);
  const sunday = addDays(pg.monday, 6);
  const m1 = monthIdx(pg.monday);
  const m2 = monthIdx(sunday);
  const month = m1 === m2 ? MONTHS[m1]! : `${MONTHS[m1]!.slice(0, 3)} / ${MONTHS[m2]!.slice(0, 3)}`;
  const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, ...pg.byDay.map((d) => d.length)));
  const dense = rows >= 6;
  const total = pg.byDay.reduce((n, d) => n + d.length, 0);
  const days = pg.byDay.map((list, i) => {
    const iso = addDays(pg.monday, i);
    const slots = Array.from({ length: rows }, (_, r) => slotHtml(list[r])).join("");
    return `<div class="day${iso === o.today ? " today" : ""}">
      <div class="dh">${DAYS[i]}<small>${dayNum(iso)} ${MONTHS[monthIdx(iso)]!.toLowerCase().slice(0, 3)}</small></div>
      <div class="slots" style="grid-template-rows: repeat(${rows}, 1fr)">${slots}</div>
    </div>`;
  }).join("");
  const chan = channels.length
    ? `<div class="chan"><span class="play">${PLAY}</span>Posten op de volgende kanalen<span class="ics">${channels.map((c) => icon(c, 9)).join("")}</span></div>`
    : "";
  const cont = pg.parts > 1 ? ` (${pg.part + 1}/${pg.parts})` : "";
  return `<section class="page cal">
    <div class="card${dense ? " dense" : ""}">
      <div class="head">
        <div>
          <div class="year">${year}</div>
          <div class="title-row"><div class="title">Short video kalender</div><div class="month">${esc(month)}</div></div>
          ${chan}
        </div>
        <div class="week">Week<b>${String(week).padStart(2, "0")}</b></div>
      </div>
      <div class="grid">${days}</div>
      <div class="foot"><span>${esc(o.clientName)}${cont}</span><span>${total === 0 ? "Deze week staat er nog niets gedeeld." : `${total} ${total === 1 ? "publicatie" : "publicaties"} deze week`}</span></div>
    </div>
    ${o.posts.length === 0 ? `<div class="empty-note">De planning voor de komende periode wordt voorbereid.</div>` : ""}
  </section>`;
}

function card(state: ChecklistState, title: string, detail: string): string {
  return `<div class="sc ${state}"><span class="badge b-${state}">${esc(STATE_LABEL[state])}</span><div class="ct">${esc(title)}</div><div class="cd">${esc(detail)}</div></div>`;
}

function statusPage(o: ContentPlanningOverview): string {
  const c = o.checklist;
  const ours = c.items.filter((i) => i.owner === "shortclips");
  const theirs = c.items.filter((i) => i.owner === "klant");
  const intro = o.weHandlePosting
    ? "Hieronder zie je per onderdeel wat Shortclips voor je heeft geregeld. Als jouw externe contentafdeling regelen wij de publicatie: jij hoeft daar niets voor te doen."
    : "Hieronder zie je per onderdeel wat Shortclips voor je heeft voorbereid. Jij plaatst de video's zelf op de geplande momenten.";
  const note = o.weHandlePosting
    ? "<b>Deze planning is ter informatie: zo weet je precies wat er online komt.</b><span>Klopt er iets feitelijk niet, of speelt er iets binnen je bedrijf? Eén bericht en we passen het aan.</span>"
    : "<b>Deze planning laat zien wanneer welke video online moet.</b><span>Klopt er iets feitelijk niet, of speelt er iets binnen je bedrijf? Eén bericht en we passen het aan.</span>";
  return `<section class="page stat">
    <img class="logo" src="${LOGO_ONDARK}" alt="Shortclips" />
    <div class="kicker">Jouw contentplanning</div>
    <h1>${esc(c.headline)}</h1>
    <p class="intro">${esc(intro)}</p>
    <div class="sect">Geregeld door Shortclips</div>
    <div class="cards">${ours.map((i) => card(i.state, i.title, i.detail)).join("")}</div>
    <div class="sect">Jouw acties</div>
    <div class="client">${theirs.map((i) => card(i.state, i.title, i.detail)).join("")}</div>
    <div class="note">${note}</div>
    <div class="gen">Stand van ${esc(longDate(o.today))}</div>
  </section>`;
}

export function contentPlanningPeriod(o: ContentPlanningOverview): string {
  if (o.posts.length === 0) return longDate(o.today);
  const first = o.posts[0]!.scheduledOn;
  const last = o.posts[o.posts.length - 1]!.scheduledOn;
  const f = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "UTC" });
  return first === last ? longDate(first) : `${f(first)} t/m ${longDate(last)}`;
}

export function renderContentPlanningHtml(o: ContentPlanningOverview): string {
  const channels = ["instagram", "tiktok", "youtube", "linkedin", "facebook"].filter((p) => o.posts.some((x) => x.platforms.includes(p)));
  const cover = `<section class="page bgimg" style="background-image:url('${CP_COVER_BG}')">
    <div class="cover-meta">Contentplanning <b>${esc(o.clientName)}</b> &nbsp;·&nbsp; ${esc(contentPlanningPeriod(o))}</div>
  </section>`;
  const weeks = weekPages(o).map((pg) => calendarPage(o, pg, channels)).join("");
  const closing = `<section class="page bgimg" style="background-image:url('${CP_CLOSING_BG}')"></section>`;
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8" /><title>Contentplanning ${esc(o.clientName)}</title>${FONT_LINK}<style>${CSS}</style></head>
  <body>${cover}${weeks}${statusPage(o)}${closing}</body></html>`;
}

export function contentPlanningFilename(o: ContentPlanningOverview): string {
  const safe = (o.clientName || "klant").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "klant";
  return `Shortclips_Contentplanning_${safe}_${o.today}.pdf`;
}
