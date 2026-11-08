/* ------------------------------------------------------------------ *
 * De editor-briefing als één HTML-document. Dezelfde opmaak voor de weergave
 * in het portaal (desktop) en voor de PDF, zodat beide altijd gelijk zijn.
 * Huisstijl: navy #00003b en wit, Poppins voor titels, Arial voor scripttekst.
 * ------------------------------------------------------------------ */
import type { BriefingDoc } from "./assemble";
import type { ScriptLine, ScriptSection } from "./script-pdf";

const NAVY = "#00003b";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const DAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
export function fmtDate(iso: string | null, withDay = false): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${withDay ? DAYS[dt.getUTCDay()] + " " : ""}${d} ${MONTHS[m - 1]} ${y}`;
}
function fmtStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(d);
  return parts;
}

function lineHtml(l: ScriptLine): string {
  const inner = l.spans
    .map((s) => {
      let t = esc(s.t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
      if (s.i) t = `<em>${t}</em>`;
      if (s.b) t = `<strong>${t}</strong>`;
      return t;
    })
    .join("");
  const allItalic = l.spans.every((s) => s.i || !s.t.trim());
  const plain = l.spans.map((s) => s.t).join("").trim();
  if (!l.bullet && /^[\p{Lu}0-9 ()'.\-]{2,40}:$/u.test(plain)) return `<p class="spk">${inner}</p>`;
  if (l.bullet) return `<li>${inner.replace(/^\s*[•·▪●◦\-–]\s*/, "")}</li>`;
  return `<p${allItalic ? ' class="dir"' : ""}>${inner}</p>`;
}

function linesHtml(lines: ScriptLine[]): string {
  let out = "";
  let inList = false;
  for (const l of lines) {
    if (l.bullet && !inList) { out += "<ul>"; inList = true; }
    if (!l.bullet && inList) { out += "</ul>"; inList = false; }
    out += lineHtml(l);
  }
  if (inList) out += "</ul>";
  return out;
}

const KIND_CLASS: Record<ScriptSection["kind"], string> = { hook: "hook", cta: "cta", scene: "scene", uitleg: "uitleg", intro: "scene" };

/** Visuele aanwijzingen: letterlijk overgenomen regels (cursief = regie, of
 *  regels over beeld/tekst in beeld/geluid). Alleen kopieën uit het script. */
const VISUAL_RE = /^(tekst in beeld|b-?roll|beeld|shot\b|pov\b|overlay|in beeld|geluid|muziek|zoom|inzoom|cut\b|overgang|camera)/i;
function visualCues(sections: ScriptSection[]): string[] {
  const out: string[] = [];
  for (const sec of sections) {
    if (sec.kind === "uitleg") continue;
    for (const l of sec.lines) {
      const text = l.spans.map((s) => s.t).join("").trim();
      const italic = l.spans.every((s) => s.i || !s.t.trim());
      const hit = italic || VISUAL_RE.test(text) || /tekst in beeld/i.test(text);
      if (hit && text.length <= 240 && !out.includes(text)) out.push(text);
    }
  }
  return out.slice(0, 10);
}

/** Zet elke CSS-regel onder één container, zodat de briefing-opmaak in het
 *  portaal niets anders raakt (en andersom). */
export function scopeCss(css: string, scope: string): string {
  return css.replace(/(^|[{}])\s*([^{}@]+)\{/g, (_m, close: string, sel: string) => {
    const scoped = sel
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => `${scope} ${x}`)
      .join(", ");
    return `${close}\n${scoped} {`;
  });
}

function linkText(l: { key: string; href: string | null; note?: string }): string {
  if (!l.href) return "";
  if (l.key === "script" && l.note) return l.note;
  if (l.href.startsWith("/")) return "Openen in het portaal";
  try {
    const host = new URL(l.href).hostname.replace(/^www\./, "");
    if (/frame\.io$/.test(host)) return "Openen in Frame.io";
    if (/drive\.google\.com$/.test(host)) return "Openen in Google Drive";
    if (/we\.tl$|wetransfer\.com$/.test(host)) return "Downloaden via WeTransfer";
    if (/youtube\.com$|youtu\.be$/.test(host)) return l.href.replace(/^https?:\/\//, "").slice(0, 60);
    return host;
  } catch {
    return l.href.slice(0, 60);
  }
}

export function renderBriefingHtml(doc: BriefingDoc, opts: { coverDataUri?: string | null; logoDataUri?: string | null; mode: "screen" | "pdf"; appUrl?: string }): string {
  const abs = (href: string) => (href.startsWith("/") && opts.appUrl ? opts.appUrl.replace(/\/$/, "") + href : href);
  const metaItems: Array<[string, string, boolean]> = [
    ["Opnamedatum", fmtDate(doc.session.date, true), false],
    ["Te monteren", doc.shortsCount ? `${doc.shortsCount} short${doc.shortsCount === 1 ? "" : "s"}` : "Onbekend", !doc.shortsCount],
    ["Editor", doc.editor.name ?? "Nog niet toegewezen", !doc.editor.name],
    ["Deadline editor", doc.editorDueOn ? fmtDate(doc.editorDueOn, true) : doc.editorDueNote ?? "Nog niet bekend", !doc.editorDueOn && !doc.editorDueNote],
  ];

  const cover = `
<header class="cover${opts.coverDataUri ? " has-img" : ""}">
  ${opts.coverDataUri ? `<div class="cover-img" style="background-image:url('${opts.coverDataUri}')"></div>` : ""}
  <div class="cover-body">
    <div class="cover-top">
      ${opts.logoDataUri ? `<img class="sc-logo" src="${opts.logoDataUri}" alt="Shortclips" />` : `<span class="sc-word">shortclips</span>`}
      <span class="kicker">Editor briefing</span>
    </div>
    <div class="cover-title">
      ${doc.client.logoUrl ? `<img class="client-logo" src="${esc(doc.client.logoUrl)}" alt="" />` : ""}
      <h1>${esc(doc.client.name)}</h1>
      <p class="session">${esc(doc.session.projectName ?? doc.session.title)}</p>
    </div>
    <dl class="meta">
      ${metaItems.map(([k, v, warn]) => `<div><dt>${k}</dt><dd${warn ? ' class="warn"' : ""}>${esc(v)}</dd></div>`).join("")}
    </dl>
  </div>
</header>`;

  const alerts = [...doc.missing, ...doc.checks, ...doc.scriptWarnings];
  const alertBlock = alerts.length
    ? `<section class="alert"><h3>Let op: ontbreekt of klopt niet</h3><ul>${alerts.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></section>`
    : "";

  const note = doc.teamNote
    ? `<section class="note"><h3>Notitie van Team Shortclips</h3>${doc.teamNote.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}</section>`
    : "";

  const overview = doc.scripts.length
    ? `<section class="block">
  <h2><span>1</span> Wat moet ik monteren?</h2>
  <table class="overview">
    <thead><tr><th>#</th><th>Video</th><th>Doel van de video (uit het script)</th><th>Script</th></tr></thead>
    <tbody>${doc.scripts
      .map((s, i) => {
        const doel = s.sections.find((x) => x.kind === "uitleg");
        const doelText = doel ? doel.lines.map((l) => l.spans.map((x) => x.t).join("")).join(" ") : "";
        return `<tr><td class="num">${i + 1}</td><td class="vt">${esc(s.title)}</td><td class="doel">${doelText ? `<span class="clamp">${esc(doelText)}</span>` : '<span class="muted">Geen uitleg in het script</span>'}</td><td class="ref"><a href="#video-${i + 1}">Video ${i + 1}</a></td></tr>`;
      })
      .join("")}</tbody>
  </table>
</section>`
    : "";

  const hl = doc.highlights;
  const highlights = `<section class="block">
  <h2><span>2</span> Hoe monteer je ${esc(doc.client.name)}?</h2>
  ${
    hl.length
      ? `<ul class="hl">${hl
          .map(
            (h) => `<li class="${h.kritiek ? "crit" : ""}"><span class="cat">${esc(h.categorie)}</span><span class="txt">${h.niet ? '<b class="no">Niet:</b> ' : ""}${esc(h.tekst)}</span>${h.kritiek ? '<span class="must">Klantafspraak</span>' : ""}</li>`,
          )
          .join("")}</ul>`
      : `<p class="muted">${doc.guideAvailable ? "De highlights uit de Editing Guide zijn nog niet beschikbaar. Lees de volledige guide." : "Er is nog geen Editing Guide voor deze klant."}</p>`
  }
  <p class="small">${doc.highlightsCorrected ? "Gecontroleerd en aangevuld door Team Shortclips. " : "Letterlijk uit de Editing Guide. "}${
    doc.guideAvailable ? `Twijfel je? <a href="${esc(abs(doc.links.find((l) => l.key === "guide")?.href ?? "#"))}">Open de volledige Editing Guide</a>.` : ""
  }</p>
</section>`;

  const linkRows = doc.links
    .map(
      (l) =>
        `<li><span class="lk">${esc(l.label)}</span>${
          l.href
            ? `<a href="${esc(abs(l.href))}">${esc(linkText(l))}</a>`
            : `<span class="missing">Ontbreekt${l.note ? ` (${esc(l.note)})` : ""}</span>`
        }</li>`,
    )
    .join("");
  const material = `<section class="block">
  <h2><span>3</span> Waar vind ik het materiaal?</h2>
  <ul class="links">${linkRows}</ul>
  ${doc.imagePages.length ? `<p class="small">De script-PDF bevat ook ${doc.imagePages.length} beeldpagina's (moodboard of referenties). Die staan alleen in het origineel.</p>` : ""}
</section>`;

  const scripts = doc.scripts
    .map((s, i) => {
      let sceneNo = 0;
      const secs = s.sections
        .map((sec) => {
          const cls = KIND_CLASS[sec.kind];
          const scenePrefix = sec.kind === "scene" ? `Scène ${++sceneNo}` : "";
          const label = sec.label ?? "";
          const head = label || scenePrefix
            ? `<div class="sec-head"><span class="tag ${cls}">${esc(sec.kind === "hook" ? "Hook" : sec.kind === "cta" ? "Afsluiting / CTA" : sec.kind === "uitleg" ? "Uitleg" : scenePrefix)}</span>${label && !/^HOOK$/i.test(label) ? `<span class="orig">${esc(label)}</span>` : ""}</div>`
            : "";
          return `<div class="sec ${cls}">${head}<div class="txt">${sec.lines.length ? linesHtml(sec.lines) : '<p class="muted">(geen tekst onder deze kop)</p>'}</div></div>`;
        })
        .join("");
      const cues = visualCues(s.sections);
      return `<article class="script" id="video-${i + 1}">
  <div class="script-head"><span class="vno">Video ${i + 1} van ${doc.scripts.length}</span><h2 class="vtitle">${esc(s.title)}</h2></div>
  ${secs}
  ${cues.length ? `<div class="cues"><h4>B-roll en visuele aanwijzingen <span>(letterlijk uit het script)</span></h4><ul>${cues.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
</article>`;
    })
    .join("");

  const footer = `<footer class="foot">Automatisch samengesteld uit ${doc.sourceFileName ? `de script-PDF "${esc(doc.sourceFileName)}"` : "de script-PDF"}, de Editing Guide en de projectgegevens in het portaal.${doc.updatedAt ? ` Laatst bijgewerkt ${esc(fmtStamp(doc.updatedAt))}.` : ""} Scripts zijn letterlijk overgenomen.</footer>`;

  const css = `
  ${opts.mode === "pdf" ? "@page { size: A4; margin: 14mm 14mm 16mm; }" : ""}
  * { box-sizing: border-box; }
  .sc-brief { font-family: Poppins, "Helvetica Neue", Arial, sans-serif; color: ${NAVY}; font-size: 12px; line-height: 1.5; ${opts.mode === "screen" ? "max-width: 880px; margin: 0 auto;" : ""} }
  .sc-brief a { color: ${NAVY}; text-decoration: underline; text-underline-offset: 2px; word-break: break-all; }
  .cover { position: relative; background: ${NAVY}; color: #fff; border-radius: ${opts.mode === "pdf" ? "6px" : "14px"}; overflow: hidden; display: flex; min-height: 210px; }
  .cover-img { width: 36%; background-size: cover; background-position: center; flex-shrink: 0; order: 2; }
  .cover-body { flex: 1; padding: 22px 26px; display: flex; flex-direction: column; gap: 14px; }
  .cover-top { display: flex; align-items: center; justify-content: space-between; }
  .sc-logo { height: 18px; }
  .sc-word { font-weight: 700; letter-spacing: .02em; }
  .kicker { font-size: 10px; letter-spacing: .16em; text-transform: uppercase; opacity: .75; }
  .cover-title h1 { font-size: 26px; line-height: 1.15; margin: 0; font-weight: 700; }
  .cover-title .session { margin: 4px 0 0; opacity: .8; font-size: 12.5px; }
  .client-logo { height: 28px; max-width: 120px; object-fit: contain; background: #fff; border-radius: 4px; padding: 3px; margin-bottom: 8px; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; margin: 0; border-top: 1px solid rgba(255,255,255,.2); padding-top: 12px; }
  .meta div { padding-right: 10px; }
  .meta dt { font-size: 9.5px; text-transform: uppercase; letter-spacing: .1em; opacity: .65; }
  .meta dd { margin: 2px 0 0; font-weight: 600; font-size: 13px; }
  .meta dd.warn { color: #ffc98a; }
  .alert { margin: 14px 0 0; border: 1px solid #f0c48a; background: #fff8ef; border-radius: 10px; padding: 10px 14px; }
  .alert h3, .note h3 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .alert h3 { color: #8a4b00; }
  .alert ul { margin: 0; padding-left: 18px; color: #6b3a00; }
  .note { margin: 14px 0 0; border-left: 3px solid ${NAVY}; background: #f4f4f8; border-radius: 0 10px 10px 0; padding: 10px 14px; }
  .note p { margin: 2px 0; }
  .block { margin-top: 22px; }
  .block h2 { break-after: avoid; }
  .overview tr, ul.hl li, ul.links li { break-inside: avoid; }
  .block h2 { font-size: 15px; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
  .block h2 span { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: ${NAVY}; color: #fff; font-size: 11px; }
  table.overview { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .overview th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: #6f6f82; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid #dcdce6; }
  .overview td { padding: 7px 8px; border-bottom: 1px solid #ececf2; vertical-align: top; }
  .overview .num { font-weight: 700; width: 24px; }
  .overview .vt { font-weight: 600; width: 30%; }
  .overview .doel { color: #3c3c55; font-family: Arial, sans-serif; font-size: 11px; }
  .overview .doel .clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .overview .ref { white-space: nowrap; width: 60px; }
  ul.hl { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  ul.hl li { display: flex; align-items: baseline; gap: 10px; padding: 6px 10px; border: 1px solid #e3e3ec; border-radius: 8px; }
  ul.hl li.crit { border-color: ${NAVY}; border-width: 1.5px; }
  .hl .cat { flex: 0 0 96px; font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: #6f6f82; font-weight: 600; }
  .hl .txt { flex: 1; font-weight: 500; }
  .hl .no { color: #a11d1d; }
  .hl .must { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; background: ${NAVY}; color: #fff; border-radius: 99px; padding: 2px 7px; white-space: nowrap; }
  .small { font-size: 10.5px; color: #5b5b74; margin: 6px 0 0; }
  .muted { color: #8a8aa0; }
  ul.links { list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 24px; }
  ul.links li { break-inside: avoid; padding: 4px 0; border-bottom: 1px solid #ececf2; display: flex; flex-direction: column; }
  .links .lk { font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: #6f6f82; font-weight: 600; }
  .links .missing { color: #a15c00; font-weight: 600; }
  .script { ${opts.mode === "pdf" ? "break-before: page;" : "margin-top: 34px; padding-top: 22px; border-top: 2px solid " + NAVY + ";"} }
  .script-head { margin-bottom: 10px; }
  .vno { font-size: 10px; text-transform: uppercase; letter-spacing: .14em; color: #6f6f82; font-weight: 600; }
  .vtitle { font-size: 21px; margin: 2px 0 0; line-height: 1.2; }
  .sec { margin: 0 0 10px; padding: 8px 12px 6px; border-radius: 8px; break-inside: avoid; }
  .sec.hook { background: #eef0f7; border-left: 4px solid ${NAVY}; }
  .sec.cta { background: #fff; border: 1.5px solid ${NAVY}; }
  .sec.scene { border-left: 4px solid #c9c9d8; }
  .sec.uitleg { background: #f7f7fa; color: #3c3c55; }
  .sec-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .tag { font-size: 9.5px; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; border-radius: 99px; padding: 2px 8px; }
  .tag.hook { background: ${NAVY}; color: #fff; }
  .tag.cta { border: 1.5px solid ${NAVY}; }
  .tag.scene { background: #e4e4ee; }
  .tag.uitleg { background: #e9e9f0; color: #5b5b74; }
  .orig { font-size: 9.5px; letter-spacing: .08em; color: #8a8aa0; }
  .txt { font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.55; }
  .txt p { margin: 0 0 4px; }
  .txt p.dir, .txt em { color: #4a4a68; }
  .txt p.spk { font-weight: 700; margin-top: 6px; }
  .txt ul { margin: 0 0 4px; padding-left: 18px; }
  .cues { margin-top: 6px; padding: 8px 12px; background: #f7f7fa; border-radius: 8px; break-inside: avoid; }
  .cues h4 { margin: 0 0 3px; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
  .cues h4 span { font-weight: 400; text-transform: none; letter-spacing: 0; color: #8a8aa0; }
  .cues ul { margin: 0; padding-left: 18px; font-family: Arial, sans-serif; font-size: 11px; }
  .cues li { margin: 1px 0; }
  .foot { margin-top: 26px; padding-top: 8px; border-top: 1px solid #ececf2; font-size: 9.5px; color: #8a8aa0; }
  @media (max-width: 720px) { .cover { flex-direction: column; } .cover-img { width: 100%; height: 160px; order: 0; } .meta { grid-template-columns: 1fr 1fr; row-gap: 10px; } ul.links { columns: 1; } .hl .cat { flex-basis: 80px; } }
  @media print { .sc-brief a { text-decoration: none; } }
  `;

  const body = `<div class="sc-brief">${cover}${alertBlock}${note}${overview}${highlights}${material}${scripts}${footer}</div>`;
  if (opts.mode === "screen") return `<style>${scopeCss(css, ".sc-brief-root")}</style><div class="sc-brief-root">${body}</div>`;
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8" /><title>Editor briefing ${esc(doc.client.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}${css}</style></head><body>${body}</body></html>`;
}
