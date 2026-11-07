import "server-only";
import type { MonthlyAnalysis, ReportMetrics, VideoAnalyse } from "./analysis";
import type { MaandCijfers } from "./metrics";
import type { Beoordeling } from "./quality";
import { docShell, esc, LOGO, nf, pctText, shortMonth, signed, topBar } from "./pdf-shared";
import { barChart, CLIENT_CSS, deltaPill, PLATFORM, platformBlock } from "./pdf-html";

export type InternVideo = {
  key: string; titel: string; datum: string | null; platform: string | null;
  views: number; likes: number; reacties: number; shares: number; saves: number;
  gemKijktijdSec: number | null; uitkijkPct?: number | null; duurSec?: number | null;
  scriptHook?: string | null; scriptCta?: string | null;
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
const HOOKS_PER_PAGE = 10;

/** Vaste kleur per type hook, zodat je het patroon in één blik ziet. */
const HOOK_KLEUR: Record<string, string> = {
  "vraag": "#00003b",
  "getal of bedrag": GREEN,
  "probleem": "#c2410c",
  "belofte": "#7a3fb8",
  "nieuws": "#0f766e",
  "statement": "#4a4a66",
  "anders": "#8a8aa3",
};
const hookKleur = (t: string | undefined) => HOOK_KLEUR[(t ?? "").toLowerCase()] ?? HOOK_KLEUR.anders!;

const CSS = `
  .lbl { font-size: 8px; text-transform: uppercase; letter-spacing: .1em; color: #5d5d78; font-weight: 600; }
  .kern { background: #00003b; color: #fff; border-radius: 14px; padding: 13px 17px; font-size: 12px; font-weight: 500; }
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
  .ht-chip { display: inline-block; border-radius: 6px; padding: 2px 7px; font-size: 8px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
  .cta-chip { display: inline-block; border-radius: 6px; padding: 1px 6px; font-size: 8px; font-weight: 600; color: #00003b; border: 1.5px solid #00003b; white-space: nowrap; }
  .cta-chip.geen { color: #8a8aa3; border-color: #d5d7e4; }
  .legend-h { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
  .ht { width: 100%; border-collapse: separate; border-spacing: 0 5px; }
  .ht th { font-size: 7.5px; letter-spacing: .1em; text-transform: uppercase; color: #5d5d78; font-weight: 600; text-align: left; padding: 0 6px; border: 0; }
  .ht th.n, .ht td.n { text-align: right; }
  .ht td { background: #f4f5f9; padding: 6px; border: 0; vertical-align: middle; font-size: 9.5px; }
  .ht td:first-child { border-radius: 10px 0 0 10px; padding: 5px; width: 34px; }
  .ht td:last-child { border-radius: 0 10px 10px 0; }
  .ht .tn { width: 30px; height: 53px; border-radius: 6px; background: #00003b center/cover no-repeat; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 10px; }
  .ht .hk { font-weight: 600; color: #00003b; font-size: 9.5px; line-height: 1.3; }
  .ht .hm { margin-top: 3px; display: flex; gap: 4px; align-items: center; flex-wrap: wrap; font-size: 7.5px; color: #5d5d78; }
  .ht td.big { font-weight: 700; color: #00003b; font-size: 11px; font-variant-numeric: tabular-nums; }
  .vc { display: grid; grid-template-columns: 124px 1fr; gap: 16px; border: 1px solid #e3e4ee; border-radius: 16px; padding: 14px; margin-bottom: 14px; page-break-inside: avoid; }
  .vc.herhalen { border: 2px solid ${GREEN}; }
  .vc .big { position: relative; width: 124px; height: 220px; border-radius: 12px; background: #00003b center/cover no-repeat; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22px; overflow: hidden; }
  .vc .big .ov { position: absolute; left: 6px; right: 6px; top: 6px; }
  .vc .big .ov .ht-chip { box-shadow: 0 1px 4px rgba(0,0,0,.35); }
  .vc .big .du { position: absolute; right: 6px; bottom: 6px; background: rgba(0,0,59,.85); color: #fff; font-size: 9px; font-weight: 700; border-radius: 6px; padding: 2px 6px; }
  .vc .top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .vc .tt { font-weight: 700; color: #00003b; font-size: 11.5px; line-height: 1.35; }
  .vc .mt { font-size: 8.5px; color: #5d5d78; margin-top: 2px; }
  .sts { display: grid; grid-template-columns: 1fr 1.6fr 1fr 1fr 1fr 1fr 1fr; gap: 4px; margin: 9px 0; text-align: center; }
  .sts > div { background: #f4f5f9; border-radius: 8px; padding: 5px 4px 4px; }
  .sts > div.hl { background: #00003b; color: #fff; }
  .sts b { display: block; font-size: 11px; font-variant-numeric: tabular-nums; }
  .sts span { font-size: 7px; opacity: .75; }
  .kb { height: 5px; border-radius: 3px; background: rgba(255,255,255,.25); margin: 3px 2px 2px; overflow: hidden; }
  .kb div { height: 100%; background: #8fe0b0; border-radius: 3px; }
  .hc { display: grid; grid-template-columns: 1.35fr 1fr; gap: 6px; margin-bottom: 8px; }
  .hookbox { background: #fff7e0; border-left: 4px solid #e2a400; border-radius: 0 10px 10px 0; padding: 7px 10px; }
  .ctabox { background: #e6f6ec; border-left: 4px solid ${GREEN}; border-radius: 0 10px 10px 0; padding: 7px 10px; }
  .ctabox.geen { background: #f4f5f9; border-left-color: #b9bbd6; }
  .hookbox .t, .ctabox .t { font-weight: 600; color: #00003b; font-size: 10px; margin-top: 3px; line-height: 1.35; }
  .bx-h { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
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
  .mk { display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 6px; }
  .mkc { border: 1px solid #e3e4ee; border-radius: 12px; padding: 9px 9px 8px; }
  .mkc.cur { background: #00003b; color: #fff; border-color: #00003b; }
  .mkc .m { font-size: 9px; font-weight: 700; text-transform: capitalize; color: #5d5d78; }
  .mkc.cur .m { color: #8fe0b0; }
  .mkc .v { font-size: 16px; font-weight: 700; color: #00003b; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .mkc.cur .v { color: #fff; }
  .mkc .s { font-size: 7.5px; opacity: .7; margin-bottom: 5px; }
  .mkc .r { display: flex; justify-content: space-between; font-size: 8.5px; padding: 2px 0; border-top: 1px solid rgba(127,127,160,.2); }
  .mkc .r b { font-variant-numeric: tabular-nums; }
  .mkc .dp { margin-top: 5px; }
  .vg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .vgc { background: #00003b; color: #fff; border-radius: 12px; padding: 10px 12px; }
  .vgc .h { font-size: 8px; text-transform: uppercase; letter-spacing: .1em; opacity: .7; font-weight: 600; margin-bottom: 6px; }
  .vgc .r { display: flex; justify-content: space-between; font-size: 10px; padding: 3px 0; border-top: 1px solid rgba(255,255,255,.12); }
  .vgc .r:first-of-type { border-top: 0; }
  .vgc .up { color: #8fe0b0; font-weight: 700; } .vgc .down { color: #c9cbe0; font-weight: 700; } .vgc .na { opacity: .5; }
  .end .tips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 26px; max-width: 150mm; text-align: left; }
  .end .tips div { background: rgba(255,255,255,.08); border-radius: 12px; padding: 10px 12px; font-size: 10px; }
  .end .tips b { display: block; color: #8fe0b0; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px; }
`;

const ROL_KLEUR: Record<string, { bg: string; soft: string; fg: string }> = {
  script: { bg: "#00003b", soft: "#e9e9f3", fg: "#fff" },
  opname: { bg: GREEN, soft: "#e6f6ec", fg: "#fff" },
  montage: { bg: "#e2a400", soft: "#fff4d6", fg: "#00003b" },
  pm: { bg: "#4a4a66", soft: "#eef0f5", fg: "#fff" },
};

const CSS2 = `
  .vp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 12px; }
  .vp-head .rk { font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #5d5d78; }
  .vp-head .tt { font-size: 16px; font-weight: 700; color: #00003b; line-height: 1.3; margin-top: 2px; }
  .vp-head .mt { font-size: 9.5px; color: #5d5d78; margin-top: 3px; }
  .vp-head .verdict { font-size: 11px; padding: 5px 14px; }
  .vp-grid { display: grid; grid-template-columns: 170px 1fr; gap: 16px; }
  .vp-img { position: relative; width: 170px; height: 302px; border-radius: 14px; background: #00003b center/cover no-repeat; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 26px; overflow: hidden; }
  .vp-img .ov { position: absolute; left: 8px; top: 8px; } .vp-img .ov .ht-chip { font-size: 9px; padding: 3px 8px; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
  .vp-img .du { position: absolute; right: 8px; bottom: 8px; background: rgba(0,0,59,.88); color: #fff; font-size: 11px; font-weight: 700; border-radius: 7px; padding: 3px 8px; }
  .big4 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .big4 > div { background: #00003b; color: #fff; border-radius: 12px; padding: 10px 12px; }
  .big4 b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .big4 span { font-size: 9px; opacity: .75; }
  .big4 em { display: inline-block; margin-top: 4px; font-style: normal; font-size: 9px; font-weight: 700; border-radius: 99px; padding: 1px 8px; background: rgba(255,255,255,.14); }
  .big4 em.up { background: ${GREEN}; color: #fff; }
  .big4 .kb { height: 7px; margin: 5px 0 3px; }
  .small4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 8px; text-align: center; }
  .small4 > div { background: #f4f5f9; border-radius: 10px; padding: 7px 4px; }
  .small4 b { display: block; font-size: 15px; color: #00003b; font-variant-numeric: tabular-nums; }
  .small4 span { font-size: 8px; color: #5d5d78; }
  .hc2 { display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; margin-top: 12px; }
  .hc2 .hookbox, .hc2 .ctabox { padding: 9px 12px; } .hc2 .t { font-size: 11.5px; }
  .ins { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
  .ins > div { border-radius: 12px; padding: 9px 12px; }
  .ins .ok { background: #e6f6ec; } .ins .nok { background: #fdeee6; }
  .ins .h { font-size: 8.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 4px; }
  .ins .ok .h { color: ${GREEN}; } .ins .nok .h { color: #c2410c; }
  .ins ul { margin: 0; padding-left: 14px; } .ins li { font-size: 10px; margin: 3px 0; }
  .kg { margin-top: 8px; font-size: 10px; color: #3d3d58; background: #f4f5f9; border-radius: 10px; padding: 7px 12px; }
  .lesb { margin-top: 8px; background: #00003b; color: #fff; border-radius: 12px; padding: 10px 14px; font-size: 12px; font-weight: 600; }
  .lesb .h { font-size: 8.5px; letter-spacing: .12em; text-transform: uppercase; color: #8fe0b0; margin-bottom: 3px; font-weight: 700; }
  .bh { margin-top: 8px; border: 2px dashed #e2a400; border-radius: 12px; padding: 8px 12px; }
  .bh .t { font-weight: 700; color: #00003b; font-size: 11.5px; margin-top: 2px; }
  .rl3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
  .rl3 > div { border-radius: 12px; overflow: hidden; background: var(--soft); }
  .rl3 .h { background: var(--bg); color: var(--fg); font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 5px 10px; }
  .rl3 .b { padding: 8px 10px; font-size: 10px; line-height: 1.4; color: #14143c; }
  .rol2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rb { border-radius: 14px; overflow: hidden; background: var(--soft); page-break-inside: avoid; }
  .rb .h { background: var(--bg); color: var(--fg); padding: 9px 14px; display: flex; justify-content: space-between; align-items: baseline; }
  .rb .h b { font-size: 13px; } .rb .h span { font-size: 9px; opacity: .85; }
  .rb ol { list-style: none; margin: 0; padding: 8px 12px 4px; counter-reset: a; }
  .rb ol li { counter-increment: a; position: relative; padding: 6px 0 6px 30px; font-size: 10.5px; font-weight: 600; color: #00003b; border-bottom: 1px solid rgba(0,0,59,.08); }
  .rb ol li:last-child { border-bottom: 0; }
  .rb ol li::before { content: counter(a); position: absolute; left: 0; top: 5px; width: 20px; height: 20px; border-radius: 6px; background: var(--bg); color: var(--fg); font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
  .rb ol li small { display: block; font-weight: 400; color: #5d5d78; font-size: 9px; margin-top: 1px; }
  .rb .vt { display: inline-block; background: #fff; border: 1px solid rgba(0,0,59,.2); border-radius: 5px; font-size: 8px; font-weight: 700; padding: 0 5px; margin-left: 5px; vertical-align: 1px; color: #00003b; }
  .rb .uv { padding: 2px 12px 10px; }
  .rb .uv .lbl { display: block; margin: 4px 0 3px; }
  .rb .uv div.r { font-size: 9.5px; padding: 2px 0; color: #3d3d58; }
  .rb .leeg { padding: 10px 14px; font-size: 10px; color: #5d5d78; }
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
const platDate = (v: InternVideo) => [v.platform ? PLATFORM[v.platform] ?? v.platform : "", shortDate(v.datum)].filter(Boolean).join(" · ");

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
function ctaOf(v: InternVideo): { text: string; type: string; bron: string } {
  const a = v.analyse;
  if (a?.cta) return { text: a.cta, type: a.ctaType || "anders", bron: a.ctaBron === "script" ? "uit script" : "uit caption" };
  if (v.scriptCta) return { text: v.scriptCta, type: a?.ctaType || "anders", bron: "uit script" };
  return { text: "", type: a?.ctaType || "geen", bron: "" };
}
const hookChip = (type: string | undefined) => (type ? `<span class="ht-chip" style="background:${hookKleur(type)}">${esc(type)}</span>` : "");
const ctaChip = (type: string) => `<span class="cta-chip${type === "geen" ? " geen" : ""}">${type === "geen" ? "geen CTA" : esc(type)}</span>`;

function thumbDiv(cls: string, v: InternVideo, overlay = ""): string {
  return v.thumb ? `<div class="${cls}" style="background-image:url('${v.thumb}')">${overlay}</div>` : `<div class="${cls}">▶${overlay}</div>`;
}

/** Hook-overzicht: alle video's in één scanbare tabel. */
function hookPages(videos: InternVideo[], meta: string, maand: string): string {
  if (videos.length === 0) return "";
  const gebruikteTypes = [...new Set(videos.map((v) => v.analyse?.hookType).filter((t): t is string => Boolean(t)))];
  const legenda = gebruikteTypes.length
    ? `<div class="legend-h">${gebruikteTypes.map((t) => {
        const lijst = videos.filter((v) => v.analyse?.hookType === t);
        const gem = lijst.length ? Math.round(lijst.reduce((s, v) => s + v.views, 0) / lijst.length) : 0;
        return `<span style="font-size:8.5px;color:#3d3d58">${hookChip(t)} ${lijst.length}× · gem. ${nf(gem)} weergaven</span>`;
      }).join("")}</div>`
    : "";
  const pages: string[] = [];
  for (let start = 0; start < videos.length; start += HOOKS_PER_PAGE) {
    const rows = videos.slice(start, start + HOOKS_PER_PAGE).map((v, k) => {
      const i = start + k;
      const h = hookOf(v);
      const c = ctaOf(v);
      const inter = v.likes + v.reacties + v.shares + v.saves;
      const verdict = v.analyse?.oordeel;
      return `<tr><td>${thumbDiv("tn", v)}</td><td><div class="hk">#${i + 1} ${esc(h.text)}</div><div class="hm">${hookChip(v.analyse?.hookType)}${ctaChip(c.type)}<span>${esc(platDate(v))}</span></div></td><td class="n">${sec(v.duurSec)}</td><td class="n big">${nf(v.views)}</td><td class="n">${sec(v.gemKijktijdSec)}</td><td class="n">${pctv(v.uitkijkPct)}</td><td class="n">${nf(inter)}</td><td>${verdict ? `<span class="verdict ${verdict}">${esc(verdict)}</span>` : ""}</td></tr>`;
    }).join("");
    pages.push(`<section class="page">${topBar(meta)}<h1>${start === 0 ? `Hooks van ${esc(maand)}` : "Hooks (vervolg)"}</h1>${start === 0 ? `<p class="lead">Alle video's op een rij, van meeste naar minste weergaven. Kleur = type hook, omrand label = type call to action. "–" = niet gemeten door het platform.</p>${legenda}` : ""}<table class="ht"><tr><th></th><th>Hook · type · CTA</th><th class="n">Duur</th><th class="n">Weergaven</th><th class="n">Gem. kijktijd</th><th class="n">Bekeken</th><th class="n">Interacties</th><th>Oordeel</th></tr>${rows}</table></section>`);
  }
  return pages.join("");
}

const rolVars = (rol: string) => { const k = ROL_KLEUR[rol] ?? ROL_KLEUR.pm!; return `--bg:${k.bg};--soft:${k.soft};--fg:${k.fg}`; };
const fmtX = (n: number) => `${String(Math.round(n * 10) / 10).replace(".", ",")}×`;

/** Per video een eigen pagina: grote cijferblokken, hook en CTA, inzichten, les en wat elke rol meeneemt. */
function videoCards(videos: InternVideo[], meta: string): string {
  if (videos.length === 0) return "";
  const gemViews = videos.reduce((s, v) => s + v.views, 0) / videos.length;
  const interPct = (v: InternVideo) => (v.views > 0 ? ((v.likes + v.reacties + v.shares + v.saves) / v.views) * 100 : null);
  const metPct = videos.map(interPct).filter((x): x is number => x != null);
  const gemInter = metPct.length ? metPct.reduce((s, x) => s + x, 0) / metPct.length : null;
  return videos.map((v, i) => {
    const a = v.analyse;
    const h = hookOf(v);
    const c = ctaOf(v);
    const idx = gemViews > 0 ? v.views / gemViews : null;
    const ip = interPct(v);
    const overlay = `${a?.hookType ? `<div class="ov">${hookChip(a.hookType)}</div>` : ""}${typeof v.duurSec === "number" ? `<div class="du">${Math.round(v.duurSec)} s</div>` : ""}`;
    const k = v.gemKijktijdSec;
    const kijk = typeof k === "number"
      ? typeof v.duurSec === "number" && v.duurSec > 0
        ? `<div><b>${Math.round(k)} van ${Math.round(v.duurSec)} s</b><div class="kb"><div style="width:${Math.max(2, Math.min(100, Math.round((k / v.duurSec) * 100)))}%"></div></div><span>gemiddelde kijktijd</span></div>`
        : `<div><b>${Math.round(k)} s</b><span>gemiddelde kijktijd</span></div>`
      : `<div><b>–</b><span>kijktijd niet gemeten</span></div>`;
    const big4 = `<div class="big4">
      <div><b>${nf(v.views)}</b><span>weergaven</span><br/>${idx != null ? `<em class="${idx >= 1 ? "up" : ""}">${fmtX(idx)} maandgemiddelde</em>` : ""}</div>
      ${kijk}
      <div><b>${pctv(v.uitkijkPct)}</b><span>van de video bekeken</span></div>
      <div><b>${ip != null ? pctv(ip) : "–"}</b><span>interactiepercentage</span><br/>${ip != null && gemInter != null ? `<em class="${ip >= gemInter ? "up" : ""}">maandgem. ${pctv(gemInter)}</em>` : ""}</div>
    </div>
    <div class="small4"><div><b>${nf(v.likes)}</b><span>likes</span></div><div><b>${nf(v.reacties)}</b><span>reacties</span></div><div><b>${nf(v.shares)}</b><span>shares</span></div><div><b>${nf(v.saves)}</b><span>saves</span></div></div>`;
    const ins = a && ((a.watWerkte ?? []).length || (a.watBeter ?? []).length)
      ? `<div class="ins"><div class="ok"><div class="h">Wat werkte</div>${(a.watWerkte ?? []).length ? `<ul>${(a.watWerkte ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div style="font-size:10px">–</div>`}</div><div class="nok"><div class="h">Wat kan beter</div>${(a.watBeter ?? []).length ? `<ul>${(a.watBeter ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div style="font-size:10px">–</div>`}</div></div>`
      : a?.waarom ? `<div class="kg"><b>Waarom:</b> ${esc(a.waarom)}</div>` : "";
    const rl = (rol: string, label: string, txt: string | undefined) => `<div style="${rolVars(rol)}"><div class="h">${label}</div><div class="b">${esc(txt || "Geen aanpassing nodig.")}</div></div>`;
    const rl3 = a && (a.script || a.opname || a.montage)
      ? `<div class="rl3">${rl("script", "Script", a.script)}${rl("opname", "Opname", a.opname)}${rl("montage", "Montage", a.montage)}</div>`
      : v.les ? `<div class="kg">${esc(v.les)}</div>` : "";
    return `<section class="page">${topBar(meta)}${i === 0 ? `<h1>Per video: wat leren we</h1>` : ""}
      <div class="vp-head"><div><div class="rk">Video ${i + 1} van ${videos.length} · ${esc(platDate(v))}</div><div class="tt">${esc(firstLine(v.titel) || "Video")}</div></div>${a ? `<span class="verdict ${a.oordeel}">${esc(a.oordeel)}</span>` : ""}</div>
      <div class="vp-grid">${thumbDiv("vp-img", v, overlay)}<div style="min-width:0">${big4}
        <div class="hc2">
          <div class="hookbox"><div class="bx-h"><span class="lbl">Hook · ${esc(h.bron)}</span>${hookChip(a?.hookType)}</div><div class="t">${esc(h.text)}</div></div>
          <div class="ctabox${c.type === "geen" ? " geen" : ""}"><div class="bx-h"><span class="lbl">Call to action${c.bron ? ` · ${esc(c.bron)}` : ""}</span>${ctaChip(c.type)}</div><div class="t">${c.text ? esc(c.text) : "Geen oproep in deze video"}</div></div>
        </div>
      </div></div>
      ${ins}
      ${a?.kijkgedrag ? `<div class="kg"><b>Kijkgedrag:</b> ${esc(a.kijkgedrag)}</div>` : ""}
      ${a?.les ? `<div class="lesb"><div class="h">Les voor het team</div>${esc(a.les)}</div>` : ""}
      ${a?.betereHook ? `<div class="bh"><span class="lbl">Sterkere hook voor een volgende video</span><div class="t">${esc(a.betereHook)}</div></div>` : ""}
      ${rl3}
    </section>`;
  }).join("");
}

/** Maandkaarten: per maand de kerncijfers naast elkaar, huidige maand donker. */
function maandKaarten(historie: MaandCijfers[]): string {
  const data = historie.filter((m) => m.meetdagen > 0).slice(-6);
  if (data.length === 0) return "";
  const cards = data.map((m, i) => {
    const prev = i > 0 ? data[i - 1] : undefined;
    const d = prev && prev.views > 0 ? ((m.views - prev.views) / prev.views) * 100 : null;
    const perVideo = m.videos > 0 ? Math.round(m.views / m.videos) : null;
    const cur = i === data.length - 1;
    return `<div class="mkc${cur ? " cur" : ""}"><div class="m">${esc(shortMonth(m.maand))}</div><div class="v">${nf(m.views)}</div><div class="s">weergaven</div>
      <div class="r"><span>Interacties</span><b>${nf(m.engagements)}</b></div>
      <div class="r"><span>Video's</span><b>${nf(m.videos)}</b></div>
      <div class="r"><span>Per video</span><b>${perVideo != null ? nf(perVideo) : "–"}</b></div>
      <div class="r"><span>Volgers</span><b>${signed(m.followerGrowth)}</b></div>
      ${d != null ? deltaPill(d, "dp") : ""}</div>`;
  }).join("");
  return `<div class="mk" style="--n:${data.length}">${cards}</div>`;
}

function vergelijkTegels(t: Partial<ReportMetrics>, vorige: string): string {
  const v = t.vergelijking;
  if (!v) return "";
  const cel = (n: number | null | undefined) => (typeof n === "number" ? `<span class="${n >= 0 ? "up" : "down"}">${n >= 0 ? "▲" : "▼"} ${esc(pctText(n))}</span>` : `<span class="na">–</span>`);
  const tegel = (titel: string, r: Partial<Record<"views" | "engagements" | "videos", number | null>>) =>
    `<div class="vgc"><div class="h">${esc(titel)}</div><div class="r"><span>Weergaven</span>${cel(r.views)}</div><div class="r"><span>Interacties</span>${cel(r.engagements)}</div><div class="r"><span>Video's</span>${cel(r.videos)}</div></div>`;
  return `<div class="vg">${tegel(`t.o.v. ${vorige}`, v.vsVorigeMaand)}${tegel("t.o.v. gem. 3 maanden", v.vsGem3)}${tegel("t.o.v. gem. 6 maanden", v.vsGem6)}</div>`;
}

/**
 * Interne teamrapportage (PDF 2): alleen voor het Shortclips-team. Gebouwd rond
 * de video's: eerst de kern en doorgaan/stoppen/testen, dan het hook-overzicht,
 * per video een kaart met hook, CTA, kijktijd en lessen, de acties per rol, de
 * ontwikkeling over de maanden en een eindpagina. Gemeten cijfers staan los van
 * interpretatie.
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
  const metDuur = videos.filter((x) => typeof x.duurSec === "number");
  const gemDuur = metDuur.length ? metDuur.reduce((s, x) => s + (x.duurSec as number), 0) / metDuur.length : null;
  const telling = { herhalen: 0, aanpassen: 0, stoppen: 0 } as Record<string, number>;
  for (const x of videos) if (x.analyse) telling[x.analyse.oordeel] = (telling[x.analyse.oordeel] ?? 0) + 1;

  const kt = (label: string, value: string, extra = "") => `<div class="kt"><div class="v">${value}</div><div class="l">${esc(label)}</div>${extra}</div>`;

  const lst = (items: string[] | undefined) => (items ?? []).length ? `<ul>${(items ?? []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div style="font-size:9.5px;opacity:.7">Geen punten deze maand.</div>`;
  const dst = i && ((i.doorgaan ?? []).length || (i.stoppen ?? []).length || (i.testen ?? []).length)
    ? `<div class="dst"><div class="dsc go"><div class="h">Doorgaan</div>${lst(i.doorgaan)}</div><div class="dsc stop"><div class="h">Stoppen of minder</div>${lst(i.stoppen)}</div><div class="dsc test"><div class="h">Testen</div>${lst(i.testen)}</div></div>`
    : "";

  const videoNr = new Map(videos.map((x, n) => [x.key, n + 1]));
  const vidRef = (ref: string | undefined) => {
    const m = /(\d+)/.exec(ref ?? "");
    const nr = ref && videoNr.has(ref) ? videoNr.get(ref) : m ? Number(m[1]) : null;
    return nr && nr <= videos.length ? `<span class="vt">video #${nr}</span>` : "";
  };
  const perRol = (rol: string, extra: string[] | undefined, wie: string) => {
    const acties = (i?.acties ?? []).filter((x) => x.rol === rol).map((x) => `<li>${esc(x.actie)}${vidRef(x.video)}${x.waarom ? `<small>${esc(x.waarom)}</small>` : ""}</li>`);
    const items = [...acties, ...(extra ?? []).map((x) => `<li>${esc(x)}</li>`)];
    const uitVideos = rol === "pm" ? [] : videos
      .map((x, n) => ({ n: n + 1, t: x.analyse ? (x.analyse as Record<string, unknown>)[rol] as string : "", o: x.analyse?.oordeel }))
      .filter((x) => x.t && x.o !== "stoppen")
      .slice(0, 6);
    return `<div class="rb" style="${rolVars(rol)}"><div class="h"><b>${esc(ROL_LABEL[rol] ?? rol)}</b><span>${esc(wie)}</span></div>${items.length ? `<ol>${items.join("")}</ol>` : `<div class="leeg">Geen specifieke acties.</div>`}${uitVideos.length ? `<div class="uv"><span class="lbl">Uit de video's</span>${uitVideos.map((x) => `<div class="r"><b>#${x.n}</b> ${esc(x.t)}</div>`).join("")}</div>` : ""}</div>`;
  };
  const rollenA = i ? `<div class="rol2">${perRol("script", i.scripts, "scriptschrijvers")}${perRol("opname", i.opnames, "videografen")}</div>` : "";
  const rollenB = i ? `<div class="rol2">${perRol("montage", i.montage, "editors")}${perRol("pm", [], pmName ? `verantwoordelijk: ${pmName}` : "projectmanager")}</div>` : "";

  const beperkingen = [...new Set([...(i?.dataBeperkingen ?? []), ...ontbrekend])].map((x) => `<li>${esc(x)}</li>`).join("");
  const beoordeling = [
    ["Wat viel positief op?", b.positief], ["Wat willen we verbeteren?", b.verbeteren], ["Wat doen we volgende maand concreet?", b.volgendeMaand],
  ].filter(([, x]) => (x ?? "").trim()).map(([q, x]) => `<div class="box"><div class="lbl">${esc(q)}</div><div style="white-space:pre-line">${esc(x)}</div></div>`).join("");

  const oordeelRegel = videos.some((x) => x.analyse)
    ? `<div style="margin-top:8px;font-size:9.5px"><span class="verdict herhalen">${telling.herhalen ?? 0} herhalen</span> <span class="verdict aanpassen">${telling.aanpassen ?? 0} aanpassen</span> <span class="verdict stoppen">${telling.stoppen ?? 0} stoppen</span></div>`
    : "";

  const viewsChart = barChart(historie, "views", nf);
  const kaarten = maandKaarten(historie);
  const tegels = vergelijkTegels(t, vorige);

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
      ${kt("Gem. kijktijd per video", sec(gemKijktijd), `<div class="pill na">${gemDuur != null ? `video's gem. ${Math.round(gemDuur)} s lang` : "gewogen naar weergaven"}</div>`)}
      ${kt("Gem. bekeken", pctv(gemUitkijk), `<div class="pill na">gewogen naar weergaven</div>`)}
      ${kt("Nieuwe volgers", signed(t.followerGrowth), deltaPill(vm?.followerGrowth, "pill", ` vs ${vorige}`))}
    </div>
    ${oordeelRegel}
    ${i?.kern ? `<h2>De kern</h2><div class="kern">${esc(i.kern)}</div>` : ""}
    ${dst ? `<h2>Doorgaan, stoppen, testen</h2>${dst}` : ""}
    ${!i ? `<p class="lead">De interne analyse ontbreekt nog. Gebruik 'AI opnieuw' op de controlepagina.</p>` : ""}
  </section>

  ${hookPages(videos, meta, maand)}

  ${videoCards(videos, meta)}

  ${rollenA ? `<section class="page">
    ${topBar(meta)}
    <h1>Acties per rol voor ${esc(volgende)}</h1>
    <p class="lead">Per rol genummerd, met de video waar de actie uit komt. Daaronder de lessen uit de afzonderlijke video's.</p>
    ${rollenA}
  </section>
  <section class="page">
    ${topBar(meta)}
    <h1>Acties per rol (vervolg)</h1>
    ${rollenB}
  </section>` : ""}

  <section class="page">
    ${topBar(meta)}
    <h1>De afgelopen maanden</h1>
    <p class="lead">Hoe ${esc(clientName)} zich over de afgelopen maanden ontwikkelt, met ${esc(maand)} als laatste maand.</p>
    ${viewsChart ? `<h2>Weergaven per maand</h2>${viewsChart}` : ""}
    ${kaarten ? `<h2>Per maand</h2>${kaarten}` : ""}
    ${tegels ? `<h2>${esc(maand.charAt(0).toUpperCase() + maand.slice(1))} vergeleken</h2>${tegels}` : ""}
  </section>

  <section class="page">
    ${topBar(meta)}
    <h1>Platformen en meetbeperkingen</h1>
    ${platformBlock(t.platforms ?? [], vorige)}
    ${beoordeling ? `<h2>Beoordeling van het team</h2>${beoordeling}` : ""}
    ${beperkingen ? `<h2>Wat we niet konden meten</h2><ul>${beperkingen}</ul>` : ""}
  </section>

  <section class="page end">
    <img src="${LOGO.dark}" alt="Shortclips" />
    <h1>Op naar een sterkere ${esc(volgende)}</h1>
    <p>Neem de hooks die werkten mee in de volgende scripts, en pas de video's met het oordeel "aanpassen" toe in de volgende opnames en montages.</p>
    <div class="tips">
      <div><b>Script</b>Hooktype en CTA bewust kiezen per video.</div>
      <div><b>Opname</b>Het hookbeeld moet in de eerste seconde staan.</div>
      <div><b>Montage</b>Kijktijd bewaken: kern vóór het afhaakmoment.</div>
    </div>
    <div class="cta">Vink je acties af in het portaal</div>
    <div class="foot">Interne teamrapportage ${esc(periodLabel)} · ${esc(clientName)} · Shortclips</div>
  </section>`;

  return docShell(`Intern teamrapport ${clientName} ${periodLabel}`, CLIENT_CSS + CSS + CSS2, body);
}
