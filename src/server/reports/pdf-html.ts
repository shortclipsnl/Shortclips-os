import "server-only";
import type { MonthlyAnalysis, ReportMetrics } from "./analysis";
import type { MaandCijfers } from "./metrics";
import { docShell, esc, LOGO, nf, pctText, shortMonth, signed, topBar } from "./pdf-shared";

export type ReportPdfInput = {
  clientName: string;
  logoUrl: string | null;
  periodLabel: string;
  totals: Partial<ReportMetrics>;
  analysis: MonthlyAnalysis | null;
  klanttekst: string;
  /** Alle video's van de maand (met miniatuur en inzicht), voor het video-overzicht. */
  videos?: Array<{ titel: string; datum: string | null; platform: string | null; views: number; likes: number; reacties: number; shares: number; saves: number; thumb: string | null; inzicht: string | null }>;
};

const GREEN = "#12a150";
const GREEN_SOFT = "#e6f6ec";

/** Extra opmaak voor de klantversie: scanbaar, donkerblauwe tegels, kleur voor groei en daling. */
const CSS = `
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .kt { background: #00003b; color: #fff; border-radius: 14px; padding: 14px 16px 13px; }
  .kt .v { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .kt .l { font-size: 10px; opacity: .75; margin-top: 2px; }
  .pill { display: inline-flex; align-items: center; gap: 3px; border-radius: 99px; padding: 2px 8px; font-size: 9px; font-weight: 600; margin-top: 8px; }
  .pill.up { background: ${GREEN_SOFT}; color: ${GREEN}; }
  .pill.down { background: rgba(255,255,255,.14); color: #fff; }
  .pill.flat { background: rgba(255,255,255,.14); color: #fff; }
  .pill.na { background: rgba(255,255,255,.10); color: rgba(255,255,255,.7); }
  .hl { display: grid; gap: 8px; }
  .hlc { display: flex; gap: 10px; align-items: flex-start; border-radius: 12px; padding: 11px 13px; background: #f4f5f9; border-left: 4px solid #00003b; }
  .hlc.pos { background: ${GREEN_SOFT}; border-left-color: ${GREEN}; }
  .hlc .ic { font-weight: 700; font-size: 13px; line-height: 1.2; }
  .soft { background: #f4f5f9; border-radius: 12px; padding: 13px 15px; font-size: 11px; }
  .soft p { margin: 0 0 6px; } .soft p:last-child { margin: 0; }
  .cmp { width: 100%; border-collapse: separate; border-spacing: 0 6px; font-size: 11px; }
  .cmp th { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: #5d5d78; font-weight: 600; text-align: right; padding: 0 12px 2px; border: 0; }
  .cmp th:first-child { text-align: left; }
  .cmp td { background: #f4f5f9; padding: 10px 12px; border: 0; text-align: right; font-variant-numeric: tabular-nums; }
  .cmp td:first-child { text-align: left; border-radius: 10px 0 0 10px; font-weight: 600; color: #00003b; }
  .cmp td:last-child { border-radius: 0 10px 10px 0; }
  .cmp td.cur { background: #00003b; color: #fff; font-weight: 700; }
  .dp { display: inline-block; min-width: 64px; text-align: center; border-radius: 99px; padding: 3px 9px; font-size: 10px; font-weight: 700; }
  .dp.up { background: ${GREEN_SOFT}; color: ${GREEN}; } .dp.down { background: #e9eaf1; color: #3d3d58; } .dp.flat, .dp.na { background: #e9eaf1; color: #5d5d78; }
  .avg { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; }
  .avgc { border: 1px solid #e3e4ee; border-radius: 12px; padding: 11px 13px; }
  .avgc .h { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: #5d5d78; font-weight: 600; margin-bottom: 6px; }
  .avgc .r { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 10.5px; }
  .eng { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .engc { border: 1.5px solid #00003b; border-radius: 12px; padding: 10px 12px; }
  .engc .v { font-size: 18px; font-weight: 700; color: #00003b; font-variant-numeric: tabular-nums; }
  .engc .l { font-size: 9.5px; color: #5d5d78; }
  .chart { display: flex; align-items: flex-end; gap: 12px; height: 150px; padding: 0 4px; border-bottom: 1.5px solid #00003b; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .col .b { width: 100%; border-radius: 7px 7px 0 0; background: #b9bbd6; }
  .col.cur .b { background: ${GREEN}; }
  .col.peak .b { background: #00003b; }
  .col .bv { font-size: 8.5px; color: #5d5d78; margin-bottom: 4px; font-weight: 600; }
  .col.cur .bv { color: ${GREEN}; }
  .labels { display: flex; gap: 12px; padding: 5px 4px 0; } .labels div { flex: 1; text-align: center; font-size: 9px; color: #5d5d78; text-transform: capitalize; }
  .legend { display: flex; gap: 14px; font-size: 8.5px; color: #5d5d78; margin-top: 8px; }
  .legend span::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; background: var(--c); }
  .dev { display: grid; gap: 8px; }
  .devc { display: flex; gap: 12px; align-items: flex-start; border: 1px solid #e3e4ee; border-radius: 12px; padding: 11px 13px; }
  .devc .n { flex: 0 0 auto; width: 24px; height: 24px; border-radius: 50%; background: #00003b; color: #fff; font-weight: 700; font-size: 11px; display: flex; align-items: center; justify-content: center; }
  .vid { display: flex; gap: 14px; border: 1px solid #e3e4ee; border-radius: 14px; padding: 13px 15px; margin-bottom: 10px; page-break-inside: avoid; }
  .vid .rk { flex: 0 0 auto; width: 46px; height: 46px; border-radius: 12px; background: #00003b; color: #fff; font-weight: 700; font-size: 22px; display: flex; align-items: center; justify-content: center; }
  .vid.first { border: 2px solid ${GREEN}; }
  .vid.first .rk { background: ${GREEN}; }
  .vid .t { font-weight: 700; color: #00003b; font-size: 12px; line-height: 1.35; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 7px 0 6px; }
  .chip2 { background: #00003b; color: #fff; border-radius: 99px; padding: 2px 9px; font-size: 9px; font-weight: 600; }
  .chip2.g { background: ${GREEN_SOFT}; color: ${GREEN}; }
  .vid .w { color: #5d5d78; font-size: 10px; }
  .checks { list-style: none; padding: 0; margin: 0; }
  .checks li { position: relative; padding-left: 22px; margin: 6px 0; }
  .checks li::before { content: "✓"; position: absolute; left: 0; top: -1px; width: 15px; height: 15px; border-radius: 50%; background: ${GREEN_SOFT}; color: ${GREEN}; font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .concl { background: #00003b; color: #fff; border-radius: 14px; padding: 15px 18px; }
  .concl .h { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; opacity: .7; font-weight: 600; margin-bottom: 6px; }
  .concl ul { padding-left: 16px; margin: 0; } .concl li { margin: 3px 0; }
  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .step { background: #00003b; color: #fff; border-radius: 14px; padding: 14px 14px 16px; }
  .step .sn { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: #8fe0b0; font-weight: 700; }
  .step .st { font-weight: 700; font-size: 12px; margin: 6px 0 6px; line-height: 1.35; }
  .step .sw { font-size: 9.5px; opacity: .8; }
  .kans { border-left: 4px solid ${GREEN}; background: ${GREEN_SOFT}; border-radius: 0 12px 12px 0; padding: 10px 13px; margin-bottom: 8px; }
  .kans .t { font-weight: 700; color: #00003b; }
  .kans .s { color: #3f4a45; font-size: 10px; margin-top: 2px; }
  .vl > .vr { margin-bottom: 7px; }
  .vr { display: grid; grid-template-columns: 40px 1fr 230px; gap: 12px; align-items: center; border: 1px solid #e3e4ee; border-radius: 12px; padding: 7px 10px 7px 7px; page-break-inside: avoid; }
  .vr.top { border-color: ${GREEN}; }
  .th { width: 40px; height: 71px; border-radius: 7px; background: #00003b center/cover no-repeat; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 12px; }
  .vr .vt { font-weight: 600; color: #00003b; font-size: 10px; line-height: 1.3; max-height: 2.6em; overflow: hidden; }
  .vr .vm { font-size: 8.5px; color: #5d5d78; margin-top: 2px; }
  .vr .vi { font-size: 9px; color: #12703c; margin-top: 4px; line-height: 1.35; }
  .vr .vi::before { content: "▲ "; font-size: 7px; }
  .vs { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr 1fr; gap: 4px; text-align: center; }
  .vs div { background: #f4f5f9; border-radius: 7px; padding: 5px 2px 4px; }
  .vs div:first-child { background: #00003b; color: #fff; }
  .vs b { display: block; font-size: 10.5px; font-variant-numeric: tabular-nums; }
  .vs span { font-size: 7.5px; opacity: .75; }
  .pf { border: 1px solid #e3e4ee; border-radius: 14px; padding: 4px 14px; }
  .pfr { display: grid; grid-template-columns: 82px 1fr 150px; gap: 12px; align-items: center; padding: 9px 0; border-bottom: 1px solid #eef0f5; }
  .pfr:last-child { border-bottom: 0; }
  .pfn { font-weight: 700; color: #00003b; font-size: 11px; }
  .pfn small { display: block; font-weight: 500; color: #5d5d78; font-size: 8.5px; }
  .pfb { height: 14px; background: #eef0f5; border-radius: 99px; overflow: hidden; }
  .pfb div { height: 100%; background: #00003b; border-radius: 99px; }
  .pfr.first .pfb div { background: ${GREEN}; }
  .pfs { font-size: 8.5px; color: #5d5d78; margin-top: 4px; }
  .pfv { text-align: right; }
  .pfv b { font-size: 15px; color: #00003b; font-variant-numeric: tabular-nums; display: block; }
  .pfv .dp { margin-top: 3px; min-width: 0; font-size: 8.5px; padding: 1px 7px; }
  .end { background: #00003b; color: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 0 24mm; }
  .end img { width: 130px; margin-bottom: 36px; }
  .end h1 { color: #fff; font-size: 30px; margin: 0 0 12px; }
  .end p { font-size: 12px; opacity: .85; max-width: 120mm; margin: 0 0 6px; }
  .end .cta { margin-top: 26px; display: inline-block; background: ${GREEN}; color: #fff; border-radius: 99px; padding: 9px 20px; font-weight: 600; font-size: 11px; }
  .end .foot { position: absolute; bottom: 16mm; left: 0; right: 0; font-size: 9px; opacity: .55; }
`;

type Dir = "up" | "down" | "flat" | "na";
function dir(n: number | null | undefined): Dir {
  if (typeof n !== "number" || !Number.isFinite(n)) return "na";
  if (Math.abs(n) < 0.5) return "flat";
  return n > 0 ? "up" : "down";
}
function deltaPill(n: number | null | undefined, cls: "pill" | "dp", suffix = ""): string {
  const d = dir(n);
  if (d === "na") return `<span class="${cls} na">geen vergelijking</span>`;
  const arrow = d === "up" ? "▲" : d === "down" ? "▼" : "■";
  return `<span class="${cls} ${d}">${arrow} ${pctText(n)}${suffix}</span>`;
}
function diffAbs(cur: number, prev: number): string {
  const d = cur - prev;
  const cls = d > 0 ? "up" : d < 0 ? "down" : "flat";
  return `<span class="dp ${cls}">${d > 0 ? "▲" : d < 0 ? "▼" : "■"} ${signed(d)}</span>`;
}
function fullMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long" });
}
function nextMonthName(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y!, m ?? 1, 1).toLocaleDateString("nl-NL", { month: "long" });
}

/** Staafdiagram in kleur: deze maand groen, beste eerdere maand donkerblauw, overige lichter. */
function barChart(list: MaandCijfers[], key: "views" | "engagements" | "followerGrowth", fmt: (n: number) => string): string {
  const data = list.filter((m) => m.meetdagen > 0);
  if (data.length < 2) return "";
  const vals = data.map((m) => Math.max(0, m[key]));
  const max = Math.max(...vals, 1);
  const cur = data[data.length - 1]!.maand;
  const prior = data.slice(0, -1);
  const peak = prior.length ? prior.reduce((a, b) => (b[key] > a[key] ? b : a)).maand : "";
  const cols = data.map((m, i) => `<div class="col${m.maand === cur ? " cur" : m.maand === peak ? " peak" : ""}"><div class="bv">${fmt(m[key])}</div><div class="b" style="height:${Math.max(3, Math.round((vals[i]! / max) * 100))}%"></div></div>`).join("");
  const labels = data.map((m) => `<div>${esc(shortMonth(m.maand))}</div>`).join("");
  return `<div class="chart">${cols}</div><div class="labels">${labels}</div><div class="legend"><span style="--c:${GREEN}">Deze maand</span><span style="--c:#00003b">Beste eerdere maand</span><span style="--c:#b9bbd6">Overige maanden</span></div>`;
}

const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn" };
const VIDEOS_PER_PAGE = 8;

function videoPages(videos: NonNullable<ReportPdfInput["videos"]>, maand: string, meta: string): string {
  if (videos.length === 0) return "";
  const row = (v: (typeof videos)[number], i: number) => {
    const date = v.datum ? new Date(`${v.datum}T12:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }).replace(".", "") : "";
    const thumb = v.thumb ? `<div class="th" style="background-image:url('${v.thumb}')"></div>` : `<div class="th">▶</div>`;
    return `<div class="vr${i < 3 ? " top" : ""}">${thumb}<div style="min-width:0"><div class="vt">${i < 3 ? `<span style="color:${GREEN}">#${i + 1}</span> ` : ""}${esc(v.titel || "Video")}</div><div class="vm">${esc([v.platform ? PLATFORM[v.platform] ?? v.platform : "", date].filter(Boolean).join(" · "))}</div>${v.inzicht ? `<div class="vi">${esc(v.inzicht)}</div>` : ""}</div><div class="vs"><div><b>${nf(v.views)}</b><span>weergaven</span></div><div><b>${nf(v.likes)}</b><span>likes</span></div><div><b>${nf(v.reacties)}</b><span>reacties</span></div><div><b>${nf(v.shares)}</b><span>shares</span></div><div><b>${nf(v.saves)}</b><span>saves</span></div></div></div>`;
  };
  const pages: string[] = [];
  for (let start = 0; start < videos.length; start += VIDEOS_PER_PAGE) {
    const chunk = videos.slice(start, start + VIDEOS_PER_PAGE);
    const first = start === 0;
    pages.push(`<section class="page">${topBar(meta)}<h1>${first ? `Al jullie video's van ${esc(maand)}` : `Video's van ${esc(maand)} (vervolg)`}</h1>${first ? `<p class="lead">${videos.length} ${videos.length === 1 ? "video" : "video's"} met de resultaten per video, van meeste naar minste weergaven.</p>` : ""}<div class="vl">${chunk.map((v, k) => row(v, start + k)).join("")}</div></section>`);
  }
  return pages.join("");
}

function platformBlock(list: NonNullable<ReportMetrics["platforms"]>, vorige: string): string {
  const shown = list.filter((p) => p.views > 0 || p.engagements > 0 || p.videos > 0);
  if (shown.length === 0) return "";
  const total = shown.reduce((s, p) => s + p.views, 0);
  const rows = shown.map((p, i) => {
    const share = total > 0 ? Math.round((p.views / total) * 100) : 0;
    const gemeten = p.views > 0;
    const delta = gemeten && p.viewsVorigeMaand && p.viewsVorigeMaand > 0 ? Math.round(((p.views - p.viewsVorigeMaand) / p.viewsVorigeMaand) * 1000) / 10 : null;
    const stats = [
      p.reach > 0 ? `${nf(p.reach)} bereik` : "",
      p.engagements > 0 ? `${nf(p.engagements)} interacties` : "",
      p.followerGrowth !== 0 ? `${signed(p.followerGrowth)} volgers` : "",
      p.videos > 0 ? `${p.videos} ${p.videos === 1 ? "video" : "video's"}` : "",
    ].filter(Boolean).join(" · ");
    return `<div class="pfr${i === 0 && gemeten ? " first" : ""}"><div class="pfn">${esc(PLATFORM[p.platform] ?? p.platform)}${gemeten ? `<small>${share}% van alle weergaven</small>` : ""}</div><div><div class="pfb"><div style="width:${gemeten ? Math.max(2, share) : 0}%"></div></div>${stats ? `<div class="pfs">${esc(stats)}</div>` : ""}</div><div class="pfv">${gemeten ? `<b>${nf(p.views)}</b><span style="font-size:8.5px;color:#5d5d78">weergaven</span><br/>${delta === null ? "" : deltaPill(delta, "dp", ` vs ${vorige}`)}` : `<span style="font-size:9px;color:#5d5d78">Weergaven worden voor dit platform niet via de koppeling gemeten</span>`}</div></div>`;
  }).join("");
  return `<h2>Weergaven per platform</h2><div class="pf">${rows}</div>`;
}

/**
 * Klantversie van de maandrapportage (PDF 1): professioneel, scanbaar en
 * deelbaar. Bevat nooit interne analyse, kwaliteitscontrole of feedback.
 */
export function renderMonthlyReportHtml(input: ReportPdfInput): string {
  const { clientName, periodLabel, totals: t, analysis: a, klanttekst } = input;
  const v = t.vergelijking ?? null;
  const vm = v?.vsVorigeMaand;
  const historie = t.historie ?? [];
  const cur = historie[historie.length - 1];
  const prev = historie.length > 1 ? historie[historie.length - 2] : undefined;
  const prevOk = prev && prev.meetdagen > 0 ? prev : undefined;
  const maand = cur ? fullMonth(cur.maand) : periodLabel.split(" ")[0]!;
  const vorige = prev ? fullMonth(prev.maand) : "vorige maand";
  const volgende = cur ? nextMonthName(cur.maand) : "volgende maand";
  const meta = `${esc(clientName)}<br/>Maandrapportage ${esc(periodLabel)}`;
  // Vangnet: doelstellingen afspreken met de klant hoort niet in de klantversie.
  const geenDoel = (t: string) => !/doelstelling|doelen afspreken|kpi/i.test(t);

  const kpi = (label: string, value: string, delta: number | null | undefined, showDelta = true) =>
    `<div class="kt"><div class="v">${value}</div><div class="l">${esc(label)}</div>${showDelta ? deltaPill(delta, "pill", ` vs ${vorige}`) : ""}</div>`;

  const persoonlijk = klanttekst.trim()
    ? klanttekst.trim().split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("")
    : `<p>${esc("We hebben de resultaten van deze maand bekeken en onze aanpak voor volgende maand bepaald.")}</p>`;

  // Hoogtepunten: alleen de positieve signalen. Dalingen staan feitelijk in de
  // cijfers en de vergelijking, maar worden niet extra uitgelicht.
  const highlights = [
    ...(a?.aandachtspunten ?? []).filter((p) => p.type === "positief").map((p) => p.tekst),
    ...(a?.analysis?.watWerkt ?? []).map((f) => f.punt),
  ].filter(Boolean)
    // Geen dubbele punten: twee teksten met grotendeels dezelfde getallen gelden als één.
    .filter((tekst, i, all) => {
      const nums = (x: string) => new Set(x.match(/\d+/g) ?? []);
      const mine = nums(tekst);
      return !all.slice(0, i).some((prev) => { const p = nums(prev); return [...mine].filter((n) => p.has(n)).length >= 2; });
    })
    .slice(0, 3)
    .map((tekst) => `<div class="hlc pos"><div class="ic" style="color:${GREEN}">▲</div><div>${esc(tekst)}</div></div>`).join("");

  // Vergelijking met de vorige maand, rij voor rij.
  const cmpRows = cur && prevOk ? ([
    ["Weergaven", prevOk.views, cur.views, vm?.views, nf],
    ["Bereik", prevOk.reach, cur.reach, vm?.reach, nf],
    ["Interacties", prevOk.engagements, cur.engagements, vm?.engagements, nf],
    ["Gepubliceerde video's", prevOk.videos, cur.videos, null, nf],
    ["Weergaven per video", prevOk.videos ? prevOk.views / prevOk.videos : null, cur.videos ? cur.views / cur.videos : null, vm?.viewsPerVideo, nf],
    ["Volgersgroei", prevOk.followerGrowth, cur.followerGrowth, null, signed],
  ] as Array<[string, number | null, number | null, number | null | undefined, (n: unknown) => string]>).map(([l, p, c, d, f]) => {
    const diff = l === "Gepubliceerde video's" || l === "Volgersgroei"
      ? (p !== null && c !== null ? diffAbs(c, p) : `<span class="dp na">–</span>`)
      : deltaPill(d, "dp");
    return `<tr><td>${esc(l)}</td><td>${p === null ? "–" : f(p)}</td><td class="cur">${c === null ? "–" : f(c)}</td><td>${diff}</td></tr>`;
  }).join("") : "";

  const avgCard = (title: string, g: { views: number | null; engagements: number | null; videos: number | null } | undefined) => {
    if (!g || (g.views === null && g.engagements === null)) return `<div class="avgc"><div class="h">${esc(title)}</div><div class="r" style="color:#5d5d78">Nog te weinig maanden met cijfers om te vergelijken.</div></div>`;
    return `<div class="avgc"><div class="h">${esc(title)}</div><div class="r"><span>Weergaven</span>${deltaPill(g.views, "dp")}</div><div class="r"><span>Interacties</span>${deltaPill(g.engagements, "dp")}</div><div class="r"><span>Video's</span>${deltaPill(g.videos, "dp")}</div></div>`;
  };

  const engagement = ([["Likes", t.likes], ["Reacties", t.comments], ["Shares", t.shares], ["Saves", t.saves]] as Array<[string, number | undefined]>)
    .filter(([, n]) => typeof n === "number");
  const engHtml = engagement.length && engagement.some(([, n]) => (n ?? 0) > 0)
    ? `<div class="eng">${engagement.map(([l, n]) => `<div class="engc"><div class="v">${nf(n)}</div><div class="l">${esc(l)}</div></div>`).join("")}</div>`
    : "";

  const ontwikkelingen = [...(a?.analysis?.ontwikkelingen ?? []), ...(a?.maandvergelijking ?? [])].filter(Boolean).filter(geenDoel).slice(0, 3)
    .map((x, i) => `<div class="devc"><div class="n">${i + 1}</div><div>${esc(x)}</div></div>`).join("");

  const topVideos = (a?.topVideos ?? []).slice(0, 3).map((x, i) => {
    const chips = (x.cijfers ?? "").split(/,\s*/).map((c) => c.trim()).filter(Boolean).slice(0, 6)
      .map((c, j) => `<span class="chip2${j === 0 ? "" : " g"}">${esc(c)}</span>`).join("");
    return `<div class="vid${i === 0 ? " first" : ""}"><div class="rk">${i + 1}</div><div style="min-width:0"><div class="t">${esc(x.titel)}</div>${chips ? `<div class="chips">${chips}</div>` : ""}<div class="w">${esc(x.waarom)}</div></div></div>`;
  }).join("");
  const watWerkt = (a?.analysis?.watWerkt ?? []).slice(0, 4).map((f) => `<li>${esc(f.punt)}</li>`).join("");

  const conclusies = (a?.conclusies ?? []).filter(geenDoel).slice(0, 4).map((c) => `<li>${esc(c)}</li>`).join("");
  const steps = (a?.strategischeActies ?? []).filter((x) => geenDoel(`${x.titel} ${x.waarom ?? ""}`)).slice(0, 3).map((x, i) =>
    `<div class="step"><div class="sn">Stap ${i + 1}</div><div class="st">${esc(x.titel)}</div>${x.waarom ? `<div class="sw">${esc(x.waarom)}</div>` : ""}</div>`).join("");
  const kansen = (a?.kansen ?? []).filter((k) => geenDoel(`${k.titel} ${k.toelichting}`)).slice(0, 3).map((k) => `<div class="kans"><div class="t">${esc(k.titel)}</div><div class="s">${esc(k.toelichting)}</div></div>`).join("");

  const viewsChart = barChart(historie, "views", (n) => nf(n));
  const engChart = barChart(historie, "engagements", (n) => nf(n));

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
    <h1>Jullie ${esc(maand)} in één oogopslag</h1>
    <p class="lead">De belangrijkste cijfers, vergeleken met ${esc(vorige)}.</p>
    <div class="kpis">
      ${kpi("Weergaven", nf(t.views), vm?.views)}
      ${kpi("Bereik", nf(t.reach), vm?.reach)}
      ${kpi("Interacties", nf(t.engagements), vm?.engagements)}
      ${kpi("Nieuwe volgers", signed(t.followerGrowth), vm?.followerGrowth)}
      ${kpi("Gepubliceerde video's", nf(t.posts), vm?.videos)}
      ${kpi("Weergaven per video", t.avgPerPost != null ? nf(t.avgPerPost) : "–", vm?.viewsPerVideo)}
    </div>
    ${platformBlock(t.platforms ?? [], vorige)}
    ${highlights ? `<h2>In het kort</h2><div class="hl">${highlights}</div>` : ""}
    <h2>Samenvatting</h2>
    <div class="soft">${persoonlijk}</div>
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>${esc(maand.charAt(0).toUpperCase() + maand.slice(1))} vergeleken met ${esc(vorige)}</h1>
    <p class="lead">Wat is er veranderd ten opzichte van de vorige maand?</p>
    ${cmpRows ? `<table class="cmp"><tr><th></th><th>${esc(vorige)}</th><th>${esc(maand)}</th><th>Verschil</th></tr>${cmpRows}</table>` : `<p class="lead">Voor ${esc(vorige)} zijn nog geen cijfers beschikbaar, dus een vergelijking is deze maand niet mogelijk.</p>`}
    <h2>Vergeleken met een langere periode</h2>
    <div class="avg">
      ${avgCard("t.o.v. gemiddelde vorige 3 maanden", v?.vsGem3)}
      ${avgCard("t.o.v. gemiddelde vorige 6 maanden", v?.vsGem6)}
    </div>
    ${engHtml ? `<h2>Betrokkenheid deze maand</h2>${engHtml}` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>De ontwikkeling</h1>
    <p class="lead">Hoe de resultaten zich over de afgelopen maanden ontwikkelen.</p>
    ${viewsChart ? `<h2>Weergaven per maand</h2>${viewsChart}` : ""}
    ${engChart ? `<h2>Interacties per maand</h2>${engChart}` : ""}
    ${ontwikkelingen ? `<h2>Belangrijkste ontwikkelingen</h2><div class="dev">${ontwikkelingen}</div>` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>De best presterende video's</h1>
    <p class="lead">Deze video's deden het deze maand het sterkst.</p>
    ${topVideos || `<p class="lead">De cijfers per video zijn voor deze maand nog niet beschikbaar.</p>`}
    ${watWerkt ? `<h2>Wat werkte goed</h2><ul class="checks">${watWerkt}</ul>` : ""}
  </section>

  ${videoPages(input.videos ?? [], maand, meta)}

  <section class="page">
    ${topBar(meta)}
    <h1>Onze aanpak voor ${esc(volgende)}</h1>
    <p class="lead">Wat we meenemen naar de nieuwe content.</p>
    ${conclusies ? `<div class="concl"><div class="h">Wat we concluderen</div><ul>${conclusies}</ul></div>` : ""}
    ${steps ? `<h2>Dit gaan we doen</h2><div class="steps">${steps}</div>` : ""}
    ${kansen ? `<h2>Kansen die we zien</h2>${kansen}` : ""}
  </section>

  <section class="page end">
    <img src="${LOGO.dark}" alt="Shortclips" />
    <h1>Op naar een sterke ${esc(volgende)}</h1>
    <p>Bedankt voor het vertrouwen. We gaan direct aan de slag met de inzichten uit deze rapportage.</p>
    <p>Vragen of ideeën? Laat het ons weten via je vaste contactpersoon bij Shortclips.</p>
    <div class="cta">shortclips.nl</div>
    <div class="foot">Maandrapportage ${esc(periodLabel)} · ${esc(clientName)}</div>
  </section>`;

  return docShell(`Maandrapportage ${clientName} ${periodLabel}`, CSS, body);
}
