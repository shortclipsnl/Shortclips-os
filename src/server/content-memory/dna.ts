/**
 * Content DNA: de strategische samenvatting bovenaan het Contentgeheugen.
 *
 * Vier onderdelen (sterkste format, hook, videolengte en CTA), een
 * strategische conclusie voor de volgende opnames en drie aanbevelingen
 * (blijven toepassen, verder testen, verbeteren).
 *
 * Alles wordt met vaste regels berekend uit de resultaten van uitsluitend
 * deze klant (geen AI-tekst, geen gegevens van andere klanten), zodat er
 * niets verzonnen kan worden en het profiel vanzelf meebeweegt met elke
 * nieuwe meting. Uitzondering: de formatvoorstellen uit de strategie-analyse
 * kunnen als testvoorstel verschijnen, altijd gemarkeerd als "nog niet getest".
 *
 * Bescherming tegen toevalstreffers: alle oordelen rusten op de mediaan van
 * meerdere video's plus het aandeel video's dat boven normaal scoort, per
 * platform genormaliseerd. Eén uitschieter verandert het profiel dus niet.
 */

import { HOOK_PLAY, pickGroup, statusOf, type PlayStatus } from "./playbook";
import { lengthBucket, median, MIN_VIDEOS, type ContentMemory, type Evidence, type MemoryGroup, type MemoryVideo } from "./analyze";
import type { MemoryStrategy } from "./strategy";

export type DnaKey = "format" | "hook" | "lengte" | "cta";
export type DnaBasis = "conversies" | "linkklikken" | "engagement";

export type DnaTile = {
  key: DnaKey;
  title: string;
  /** De conclusie in een paar woorden; null = nog geen conclusie. */
  value: string | null;
  status: PlayStatus;
  n: number;
  hits: number;
  perf: number | null;
  evidence: Evidence | null;
  /** Eén regel onderbouwing met de echte cijfers. */
  detail: string;
  /** Waar het werkt, als er meerdere platforms gemeten zijn. */
  platformNote: string | null;
  /** Letterlijke voorbeeldzin (hook of CTA). */
  quote: string | null;
  /** Alleen bij de CTA: waarop de conclusie rust. */
  basis: DnaBasis | null;
  basisNote: string | null;
  example: MemoryVideo | null;
};

export type DnaReliability = {
  level: "hoog" | "gemiddeld" | "laag" | "onvoldoende";
  label: string;
  note: string;
};

export type DnaAdviceKind = "behouden" | "testen" | "verbeteren";
export type DnaAdvice = {
  kind: DnaAdviceKind;
  title: string;
  text: string;
  status: PlayStatus;
  /** "resultaten" = uit de cijfers van deze klant; "voorstel" = nieuw idee, nog niet getest. */
  source: "resultaten" | "voorstel";
  /** Tekst om direct in een script of briefing te plakken. */
  copy: string;
};

export type ContentDna = {
  videoCount: number;
  measuredFrom: string | null;
  measuredTo: string | null;
  tiles: DnaTile[];
  reliability: DnaReliability;
  conclusion: { status: "bewezen" | "voorlopig" | "onvoldoende"; text: string; advice: string | null };
  recommendations: Record<DnaAdviceKind, DnaAdvice | null>;
  /** Laatste moment waarop er nieuwe cijfers voor deze klant binnenkwamen. */
  dataUpdatedAt: string | null;
};

/* ------------------------------------------------------------------ *
 * Taal
 * ------------------------------------------------------------------ */

const fx = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;
const pc = (x: number) => `${Math.round(x * 100)}%`;
const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube Shorts", linkedin: "LinkedIn" };
const plat = (p: string) => PLATFORM[p] ?? p;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} en ${xs[xs.length - 1]}`);
const lc = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const dnl = (d: string) => new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" });

export const CTA_PLAY: Record<string, string> = {
  "Poll of keuze": "Laten kiezen of stemmen",
  Raden: "Laten raden",
  "Reactie vragen": "Om een reactie vragen",
  "Afspraak of bezichtiging": "Afspraak of bezichtiging plannen",
  "Contact opnemen": "Contact laten opnemen",
  "Website of link": "Naar website of link",
  Volgen: "Vragen om te volgen",
  "Opslaan of delen": "Laten opslaan of delen",
};

/** "... waarbij de prijs direct wordt benoemd" */
const HOOK_CLAUSE: Record<string, string> = {
  Vraag: "de kijker direct een vraag krijgt",
  Prijs: "de prijs direct wordt benoemd",
  Getal: "direct een concreet getal valt",
  Nieuwsgierigheid: "direct nieuwsgierigheid wordt gewekt",
  "Spreekt kijker aan": "de kijker direct wordt aangesproken",
  Rondleiding: "direct een rondleiding wordt aangekondigd",
};
/** "open met ..." */
const HOOK_ADVICE: Record<string, string> = {
  Vraag: "een directe vraag aan de kijker",
  Prijs: "de prijs in de eerste zin",
  Getal: "een concreet getal in de eerste zin",
  Nieuwsgierigheid: "een zin die nieuwsgierig maakt naar het vervolg",
  "Spreekt kijker aan": "een zin die de kijker direct aanspreekt",
  Rondleiding: "de aankondiging van de rondleiding",
  Stelling: "een gewone stelling",
};
/** "sluit af met ..." */
const CTA_ADVICE: Record<string, string> = {
  "Poll of keuze": "een keuze of poll",
  Raden: "een raadvraag",
  "Reactie vragen": "een vraag om te reageren",
  "Afspraak of bezichtiging": "een uitnodiging voor een afspraak of bezichtiging",
  "Contact opnemen": "een oproep om contact op te nemen",
  "Website of link": "een verwijzing naar de website of link",
  Volgen: "een oproep om te volgen",
  "Opslaan of delen": "een oproep om op te slaan of te delen",
};
/** "een afsluiting waarin ..." */
const CTA_CLAUSE: Record<string, string> = {
  "Poll of keuze": "de kijker mag kiezen of stemmen",
  Raden: "de kijker mag raden",
  "Reactie vragen": "om een reactie wordt gevraagd",
  "Afspraak of bezichtiging": "de kijker wordt uitgenodigd voor een afspraak of bezichtiging",
  "Contact opnemen": "de kijker wordt gevraagd contact op te nemen",
  "Website of link": "de kijker naar de website of link wordt verwezen",
  Volgen: "de kijker wordt gevraagd te volgen",
  "Opslaan of delen": "de kijker wordt gevraagd de video op te slaan of te delen",
};
/** "houd de video's ..." */
const LENGTH_ADVICE: Record<string, string> = {
  "Korter dan 20 sec": "korter dan 20 seconden",
  "20 tot 35 sec": "tussen 20 en 35 seconden",
  "35 tot 50 sec": "tussen 35 en 50 seconden",
  "50 tot 75 sec": "tussen 50 en 75 seconden",
  "Langer dan 75 sec": "langer dan 75 seconden",
};

/* ------------------------------------------------------------------ *
 * De vier onderdelen
 * ------------------------------------------------------------------ */

/** Werkt het op alle platforms, of vooral op één? Alleen platforms met minstens twee video's. */
function platformNote(vs: MemoryVideo[]): string | null {
  const by = new Map<string, number[]>();
  for (const v of vs) by.set(v.platform, [...(by.get(v.platform) ?? []), v.perf]);
  const rows = [...by.entries()].filter(([, ps]) => ps.length >= 2).map(([p, ps]) => ({ p, perf: median(ps) ?? 1 }));
  if (!rows.length) return null;
  if (rows.length === 1) return `Alleen voldoende gemeten op ${plat(rows[0].p)}`;
  const strong = rows.filter((r) => r.perf >= 1.1).sort((a, b) => b.perf - a.perf).map((r) => plat(r.p));
  const weak = rows.filter((r) => r.perf < 0.9).map((r) => plat(r.p));
  if (strong.length === rows.length) return `Werkt op ${list(strong)}`;
  if (!strong.length) return null;
  return `Sterkst op ${list(strong)}${weak.length ? `, zwakker op ${list(weak)}` : ""}`;
}

function tile(
  key: DnaKey,
  title: string,
  g: MemoryGroup | null,
  all: MemoryVideo[],
  ofGroup: (v: MemoryVideo) => boolean,
  value: (g: MemoryGroup) => string,
  none: string,
): DnaTile {
  const base: DnaTile = { key, title, value: null, status: "onvoldoende", n: 0, hits: 0, perf: null, evidence: null, detail: none, platformNote: null, quote: null, basis: null, basisNote: null, example: null };
  if (!g) return base;
  const vs = all.filter(ofGroup);
  // Rond het normale niveau (1,0x) is geen inzicht, ook geen voorlopig.
  const raw = statusOf(g);
  const status: PlayStatus = raw === "indicatie" && g.medianPerf < 1.1 ? "onvoldoende" : raw;
  const hits = Math.round(g.hitRate * g.n);
  return {
    ...base,
    value: status === "onvoldoende" ? null : value(g),
    status,
    n: g.n,
    hits,
    perf: g.medianPerf,
    evidence: g.evidence,
    detail: status === "onvoldoende"
      ? `${none} Beste kandidaat: ${lc(value(g))} (${g.n} video's, ${fx(g.medianPerf)} normaal).`
      : `${hits} van ${g.n} video's boven normaal · gemiddeld ${fx(g.medianPerf)} normaal`,
    platformNote: status === "onvoldoende" ? null : platformNote(vs),
    example: g.examples[0] ?? null,
  };
}

/** Waarop rust het oordeel over de CTA: echte conversies, linkklikken of alleen engagement. */
function ctaBasis(vs: MemoryVideo[]): { basis: DnaBasis; note: string } {
  const conv = vs.filter((v) => v.conversions != null && v.conversions > 0);
  if (conv.length) {
    const total = conv.reduce((a, v) => a + (v.conversions ?? 0), 0);
    return { basis: "conversies", note: `Onderbouwd met ${total} gemeten conversies bij ${conv.length} video's.` };
  }
  const clicks = vs.filter((v) => v.linkClicks != null && v.linkClicks > 0);
  if (clicks.length) {
    const total = clicks.reduce((a, v) => a + (v.linkClicks ?? 0), 0);
    return { basis: "linkklikken", note: `Onderbouwd met ${total} linkklikken bij ${clicks.length} video's; conversies zelf zijn niet gemeten.` };
  }
  return { basis: "engagement", note: "Gebaseerd op bereik en interactie. Er is geen conversiedata gekoppeld, dus of deze CTA tot aanvragen leidt is niet gemeten." };
}

export function dnaTiles(m: ContentMemory): DnaTile[] {
  const all = m.all;
  const short = m.sufficient ? "" : `Nog maar ${m.videoCount} van de minimaal ${MIN_VIDEOS} video's met resultaten.`;

  // Zelfde selectie als "Wat werkt voor deze klant", zodat de pagina nooit twee antwoorden geeft.
  const fg = pickGroup(m.formats.filter((g) => g.n >= 2));
  const format = tile("format", "Sterkste format", fg, all, (v) => v.format === fg?.label, (g) => g.label,
    short || (m.formatsLabeled ? "Nog geen format dat consequent boven normaal scoort." : "Formats zijn nog niet herkend."));

  const hg = pickGroup(m.hooks.filter((g) => g.label !== "Stelling" && g.n >= 2));
  const hook = tile("hook", "Sterkste hook", hg, all, (v) => !!hg && v.hookTypes.includes(hg.label), (g) => HOOK_PLAY[g.label] ?? g.label,
    short || "Nog geen openingsstijl die consequent boven normaal scoort.");
  if (hg && hook.value) {
    const best = all.find((v) => v.hookTypes.includes(hg.label) && v.hook.length >= 12);
    hook.quote = best?.hook ?? null;
    hook.example = best ?? hook.example;
  }

  const lg = pickGroup(m.lengths.filter((g) => g.n >= 3));
  const lengte = tile("lengte", "Kansrijke videolengte", lg, all, (v) => !!lg && lengthBucket(v.durationSeconds) === lg.label, (g) => g.label,
    short || "Nog geen lengte die duidelijk beter presteert dan de rest.");
  if (lg && lengte.value) {
    const vs = all.filter((v) => lengthBucket(v.durationSeconds) === lg.label);
    const ret = vs.map((v) => v.retention).filter((x): x is number => x != null);
    if (ret.length >= 2) lengte.detail += ` · ${pc(median(ret)!)} uitgekeken`;
  }

  const cg = pickGroup(m.ctas.filter((g) => g.label !== "Geen duidelijke CTA" && g.n >= 2));
  const cta = tile("cta", "Sterkste CTA", cg, all, (v) => v.cta === cg?.label, (g) => CTA_PLAY[g.label] ?? g.label,
    short || "Nog geen afsluiting die consequent boven normaal scoort.");
  if (cg) {
    const vs = all.filter((v) => v.cta === cg.label);
    const b = ctaBasis(vs);
    cta.basis = b.basis;
    cta.basisNote = b.note;
    if (cta.value) cta.quote = cg.examples.find((e) => e.ctaText)?.ctaText ?? null;
  }

  return [format, hook, lengte, cta];
}

/* ------------------------------------------------------------------ *
 * Betrouwbaarheid
 * ------------------------------------------------------------------ */

function reliability(m: ContentMemory, tiles: DnaTile[]): DnaReliability {
  const period = m.measuredFrom && m.measuredTo ? ` (${dnl(m.measuredFrom)} tot ${dnl(m.measuredTo)})` : "";
  if (!m.sufficient) {
    return {
      level: "onvoldoende",
      label: "Te weinig data",
      note: `Gebaseerd op ${m.videoCount} geanalyseerde video's${period}. Vanaf ${MIN_VIDEOS} video's met resultaten volgen betrouwbare patronen.`,
    };
  }
  const proven = tiles.filter((t) => t.status === "bewezen").length;
  const level: DnaReliability["level"] = proven >= 3 && m.videoCount >= 20 ? "hoog" : proven >= 1 ? "gemiddeld" : "laag";
  const label = { hoog: "Hoge betrouwbaarheid", gemiddeld: "Gemiddelde betrouwbaarheid", laag: "Lage betrouwbaarheid", onvoldoende: "" }[level];
  return { level, label, note: `${proven} van 4 onderdelen bewezen · ${m.videoCount} video's geanalyseerd${period}.` };
}

/* ------------------------------------------------------------------ *
 * Aanbevelingen
 * ------------------------------------------------------------------ */

type ByKey = Record<DnaKey, DnaTile>;

const KEEP_LINE: Record<DnaKey, string> = {
  format: "Plan dit format standaard in.",
  hook: "Gebruik deze opening als vaste basis.",
  lengte: "Schrijf de scripts op deze lengte.",
  cta: "Sluit standaard zo af.",
};

function keepAdvice(m: ContentMemory, t: ByKey): DnaAdvice | null {
  const proven = Object.values(t).filter((x) => x.status === "bewezen").sort((a, b) => (b.perf ?? 0) - (a.perf ?? 0));
  if (!proven.length) return null;
  const best = proven[0];
  // Een terugkerende combinatie die het sterkste onderdeel bevat, is het concreetst.
  const f = m.formulas.find((x) => x.hits >= 3 && ((best.key === "format" && x.format === best.value) || (best.key === "hook" && HOOK_PLAY[x.hookType] === best.value) || (best.key === "cta" && CTA_PLAY[x.cta] === best.value)));
  if (f) {
    const title = [f.format, `hook: ${lc(HOOK_PLAY[f.hookType] ?? f.hookType)}`, `CTA: ${lc(CTA_PLAY[f.cta] ?? f.cta)}`].filter(Boolean).join(" + ");
    return {
      kind: "behouden",
      title,
      text: `${f.hits} van ${f.n} video's met deze combinatie scoorden sterk (gemiddeld ${fx(f.medianPerf)} normaal). Houd deze combinatie vast als basis van de scripts.`,
      status: "bewezen",
      source: "resultaten",
      copy: `Blijven toepassen: ${title}.`,
    };
  }
  return {
    kind: "behouden",
    title: best.value!,
    text: `${best.detail}. ${KEEP_LINE[best.key]}${best.quote ? ` Voorbeeld: "${best.quote}"` : ""}`,
    status: "bewezen",
    source: "resultaten",
    copy: `Blijven toepassen: ${best.value}.${best.quote ? ` Voorbeeld: "${best.quote}"` : ""}`,
  };
}

const DIM_TITLE = (g: MemoryGroup) =>
  g.dimension === "format" ? `Format "${g.label}"`
    : g.dimension === "hook" ? (HOOK_PLAY[g.label] ?? (g.label === "Stelling" ? "Openen met een gewone stelling" : g.label))
      : g.dimension === "cta" ? (CTA_PLAY[g.label] ?? g.label)
        : `Video's van ${lc(g.label)}`;

function testAdvice(m: ContentMemory, t: ByKey, s: MemoryStrategy | null): DnaAdvice | null {
  const used = new Set(Object.values(t).map((x) => x.value).filter(Boolean));
  const fromIdea = (): DnaAdvice | null => {
    const base = t.format.value ?? m.formats.find((g) => g.n >= 2 && g.medianPerf >= 1)?.label;
    const idea = base ? s?.formatIdeas[base]?.ideas[0] : null;
    if (!idea || !base) return null;
    return {
      kind: "testen",
      title: idea.name,
      text: `${idea.description} Variatie op het succes van "${base}"; nieuw voorstel, nog niet getest.`,
      status: "onvoldoende",
      source: "voorstel",
      copy: `Testen: ${idea.name}. ${idea.description}${idea.hook ? ` Hook om te testen: "${idea.hook}"` : ""}`,
    };
  };

  // 1. Een variatie op een bewezen format heeft de meeste waarde.
  if (t.format.status === "bewezen") { const a = fromIdea(); if (a) return a; }

  // 2. Een onderdeel dat de goede kant op wijst maar nog niet bewezen is.
  const promising = Object.values(t).filter((x) => x.status === "indicatie").sort((a, b) => (b.perf ?? 0) - (a.perf ?? 0))[0];
  if (promising) {
    return {
      kind: "testen",
      title: promising.value!,
      text: `Wijst de goede kant op (${promising.detail}), maar is nog niet bewezen. Zet het bewust in bij twee van de volgende opnames.`,
      status: "indicatie",
      source: "resultaten",
      copy: `Testen: ${promising.value}.${promising.quote ? ` Voorbeeld: "${promising.quote}"` : ""}`,
    };
  }

  // 3. Iets dat bij een paar video's opvallend goed scoorde.
  const early = [...m.formats, ...m.hooks, ...m.ctas, ...m.lengths]
    .filter((g) => g.verdict === "beter" && g.n >= 2 && g.n <= 3 && g.label !== "Stelling" && g.label !== "Geen duidelijke CTA" && !used.has(DIM_TITLE(g)) && !used.has(g.label))
    .sort((a, b) => b.medianPerf - a.medianPerf)[0];
  if (early) {
    return {
      kind: "testen",
      title: DIM_TITLE(early),
      text: `Scoorde bij ${early.n} video's gemiddeld ${fx(early.medianPerf)} normaal. Te weinig om te spreken van een patroon: test het bij de volgende opnames.`,
      status: "indicatie",
      source: "resultaten",
      copy: `Testen: ${DIM_TITLE(early)}.`,
    };
  }

  return fromIdea();
}

function improveAdvice(m: ContentMemory, t: ByKey): DnaAdvice | null {
  // Grootste impact: veel video's die duidelijk onder normaal scoren.
  const weak = [...m.formats, ...m.hooks, ...m.ctas, ...m.lengths]
    .filter((g) => g.verdict === "slechter" && g.n >= 3 && g.evidence !== "gemengd")
    .sort((a, b) => b.n * (1 - b.medianPerf) - a.n * (1 - a.medianPerf))[0];
  if (weak) {
    const above = Math.round(weak.hitRate * weak.n);
    const alt = weak.dimension === "format" ? t.format : weak.dimension === "hook" ? t.hook : weak.dimension === "cta" ? t.cta : t.lengte;
    const lbl = alt.value ? Object.entries({ ...HOOK_PLAY, ...CTA_PLAY }).find(([, v]) => v === alt.value)?.[0] ?? alt.value : null;
    const fix = !alt.value || alt.value === DIM_TITLE(weak) || alt.value === weak.label
      ? { format: "Herzie de invalshoek of plan het minder vaak in.", hook: "Test een andere openingszin.", cta: "Test een andere afsluiting.", lengte: "Test een andere lengte." }[weak.dimension]
      : weak.dimension === "format" ? `Plan liever "${alt.value}" in (${fx(alt.perf ?? 1)} normaal).`
        : weak.dimension === "hook" ? `Open liever met ${HOOK_ADVICE[lbl!] ?? lc(alt.value)}.`
          : weak.dimension === "cta" ? `Sluit liever af met ${CTA_ADVICE[lbl!] ?? lc(alt.value)}.`
            : `Houd de video's liever ${LENGTH_ADVICE[alt.value] ?? lc(alt.value)}.`;
    return {
      kind: "verbeteren",
      title: weak.dimension === "cta" && weak.label === "Geen duidelijke CTA" ? "Video's zonder duidelijke afsluiting" : DIM_TITLE(weak),
      text: `${weak.n} video's scoorden gemiddeld ${fx(weak.medianPerf)} normaal; ${above} daarvan boven normaal. ${fix}`,
      status: weak.evidence === "aannemelijk" || weak.evidence === "sterk" ? "bewezen" : "indicatie",
      source: "resultaten",
      copy: `Verbeteren: ${DIM_TITLE(weak)}. ${fix}`,
    };
  }
  // Geen zwak onderdeel: kijk of kijkers vroeg afhaken.
  const ret = m.all.map((v) => v.retention).filter((x): x is number => x != null);
  const r = median(ret);
  if (ret.length >= 4 && r != null && r < 0.35) {
    return {
      kind: "verbeteren",
      title: "Kijkers haken vroeg af",
      text: `Gemiddeld wordt ${pc(r)} van de video bekeken (${ret.length} video's met kijkdata). Maak de eerste seconden strakker en kom sneller tot de kern.`,
      status: "indicatie",
      source: "resultaten",
      copy: "Verbeteren: kijkers haken vroeg af. Strakkere eerste seconden, sneller tot de kern.",
    };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Strategische conclusie
 * ------------------------------------------------------------------ */

function conclusion(clientName: string, m: ContentMemory, t: ByKey, test: DnaAdvice | null): ContentDna["conclusion"] {
  if (!m.videoCount) {
    return { status: "onvoldoende", text: "Nog geen gepubliceerde video's met resultaten voor deze klant. Zodra Metricool cijfers levert, verschijnt hier automatisch de conclusie.", advice: null };
  }
  const known = (["format", "hook", "lengte", "cta"] as DnaKey[]).map((k) => t[k]).filter((x) => x.value);
  if (!known.length) {
    return {
      status: "onvoldoende",
      text: m.sufficient
        ? `Nog onvoldoende gegevens om een betrouwbaar patroon te bepalen: bij ${m.videoCount} video's scoort nog geen format, hook, lengte of CTA consequent boven normaal.`
        : `Nog onvoldoende gegevens om een betrouwbaar patroon te bepalen. Gebaseerd op ${m.videoCount} geanalyseerde video's; vanaf ${MIN_VIDEOS} video's volgen de eerste conclusies.`,
      advice: m.sufficient ? "Advies: varieer bewust in format en openingszin bij de volgende opnames, zodat zichtbaar wordt wat bij deze klant werkt." : null,
    };
  }

  const F = t.format.value, H = t.hook.value, L = t.lengte.value, C = t.cta.value;
  const hookLabel = H ? Object.entries(HOOK_PLAY).find(([, v]) => v === H)?.[0] ?? null : null;
  const ctaLabel = C ? Object.entries(CTA_PLAY).find(([, v]) => v === C)?.[0] ?? null : null;

  const subject = F ? `Video's in het format "${F}"` : "Video's";
  const extras = [
    H && hookLabel && HOOK_CLAUSE[hookLabel] ? `een opening waarbij ${HOOK_CLAUSE[hookLabel]}` : null,
    L ? `een lengte van ${lc(L)}` : null,
  ].filter(Boolean) as string[];
  const allProven = known.every((x) => x.status === "bewezen");
  const verb = allProven ? "laten bij" : "laten momenteel bij";
  const lead = `${subject}${extras.length ? `, met ${list(extras)},` : ""} ${verb} ${clientName} de sterkste resultaten zien.`;

  const proof = known.find((x) => x.status === "bewezen") ?? known[0];
  const PROOF_SUBJECT: Record<DnaKey, string> = { format: "Dit format", hook: "Deze opening", lengte: "Deze lengte", cta: "Deze afsluiting" };
  const proofLine = `${PROOF_SUBJECT[proof.key]} scoorde bij ${proof.hits} van ${proof.n} video's boven normaal (gemiddeld ${fx(proof.perf ?? 1)}).`;

  const ctaLine = C && ctaLabel
    ? ` Als afsluiting werkt een CTA waarin ${CTA_CLAUSE[ctaLabel] ?? lc(C)} het best${t.cta.basis === "engagement" ? " (op basis van engagement; conversies zijn niet gemeten)" : t.cta.basis === "linkklikken" ? " (op basis van linkklikken)" : " (onderbouwd met conversiedata)"}.`
    : "";
  const provisional = known.filter((x) => x.status !== "bewezen").map((x) => lc(x.title.replace(/^Sterkste |^Kansrijke /, "")));
  const provLine = provisional.length && provisional.length < known.length ? ` Nog voorlopig: ${list(provisional)}.` : "";
  const sample = m.sufficient ? "" : `Voorlopig inzicht: gebaseerd op ${m.videoCount} geanalyseerde video's. `;

  const actions = [
    F ? `plan "${F}" in` : null,
    H && hookLabel ? `open met ${HOOK_ADVICE[hookLabel] ?? lc(H)}` : null,
    L ? `houd de video's ${LENGTH_ADVICE[L] ?? lc(L)}` : null,
    C && ctaLabel ? `sluit af met ${CTA_ADVICE[ctaLabel] ?? lc(C)}` : null,
  ].filter(Boolean) as string[];
  const usedValues = new Set(known.map((x) => x.value));
  const testLine = test && !usedValues.has(test.title) ? ` Test daarnaast bij één van die video's: ${lc(test.title)}${test.source === "voorstel" ? " (nieuw voorstel)" : ""}.` : "";
  const advice = !actions.length
    ? null
    : allProven && m.sufficient
      ? `Advies voor de volgende drie opnames: ${list(actions)}.${testLine}`
      : `Advies voor de volgende drie opnames: ${list(actions)}, en kijk of het patroon standhoudt.${testLine}`;

  return {
    status: allProven && m.sufficient ? "bewezen" : "voorlopig",
    text: `${sample}${lead} ${proofLine}${ctaLine}${provLine}`.replace(/\s+/g, " ").trim(),
    advice,
  };
}

/* ------------------------------------------------------------------ */

export function buildContentDna(clientName: string, m: ContentMemory, s: MemoryStrategy | null, dataUpdatedAt: string | null): ContentDna {
  const tiles = dnaTiles(m);
  const t = Object.fromEntries(tiles.map((x) => [x.key, x])) as ByKey;
  const enough = m.videoCount >= 3;
  const behouden = enough ? keepAdvice(m, t) : null;
  const testen = enough ? testAdvice(m, t, s) : null;
  const verbeteren = enough ? improveAdvice(m, t) : null;
  // Zonder voldoende data is niets "bewezen", ook geen aanbeveling.
  const soften = (a: DnaAdvice | null) => (a && !m.sufficient && a.status === "bewezen" ? { ...a, status: "indicatie" as const } : a);
  return {
    videoCount: m.videoCount,
    measuredFrom: m.measuredFrom,
    measuredTo: m.measuredTo,
    tiles,
    reliability: reliability(m, tiles),
    conclusion: conclusion(clientName, m, t, testen),
    recommendations: { behouden: soften(behouden), testen: soften(testen), verbeteren: soften(verbeteren) },
    dataUpdatedAt,
  };
}

/** Voor de Script Engine: conclusie en aanbevelingen als korte briefing. */
export function dnaPromptText(d: ContentDna): string {
  if (!d.videoCount) return "";
  const r = d.recommendations;
  const lines = [
    `CONTENT DNA (${d.reliability.label.toLowerCase()}; ${d.reliability.note})`,
    `Strategische conclusie: ${d.conclusion.text}`,
    d.conclusion.advice ?? "",
    r.behouden ? `- Blijven toepassen: ${r.behouden.title}. ${r.behouden.text}` : "",
    r.testen ? `- Verder testen${r.testen.source === "voorstel" ? " (nieuw voorstel, nog niet getest)" : ""}: ${r.testen.title}. ${r.testen.text}` : "",
    r.verbeteren ? `- Verbeteren: ${r.verbeteren.title}. ${r.verbeteren.text}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
