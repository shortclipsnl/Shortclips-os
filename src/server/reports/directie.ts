import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clientPackages, clients } from "@/db/schema";
import type { PortalResults } from "@/server/portal";
import type { PeriodReview, ReviewAdvice } from "@/server/period-review";
import { amsToday, capitalize, monthLabel } from "@/lib/portal-periods";
import { PORTAL_DIRECTIEVERSIE_LIVE } from "@/lib/feature-flags";
import { getGerealiseerd, type Gerealiseerd } from "./realized";
import { goalLabel, loadStrategyProfile } from "./strategy";
import { monthSeries, type MaandCijfers } from "./metrics";

/**
 * Directieversie van het maandoverzicht: hetzelfde overzicht als op de
 * resultatenpagina (PortalResults + PeriodReview), aangevuld met wat een
 * directeur zonder kennis van short video nodig heeft: wat Shortclips doet, wat
 * de klant afneemt en wat er in de maand is uitgevoerd.
 *
 * Alleen per maand. Voor een kwartaal is de kwartaalrapportage (src/server/quarterly)
 * het document voor de directie: die is strategisch, wordt apart gecontroleerd en
 * goedgekeurd en heeft een eigen directieoverzicht van één pagina. Zo is er per
 * periode precies één rapport voor de directie.
 *
 * Er is geen tweede rapportagesysteem en er wordt niets opgeslagen. Alle teksten
 * zijn vaste zinnen rond gemeten cijfers of door het team goedgekeurde punten;
 * nieuwe, nog niet beoordeelde ideeën (bron "voorstel") gaan niet mee. Prijzen,
 * marges en interne opmerkingen worden hier bewust niet opgehaald.
 */

/** directie = volledig rapport (5 pagina's); overzicht = directieoverzicht op één pagina. */
export type DirectieVariant = "directie" | "overzicht";
export const directieVariant = (v: string | null): DirectieVariant | null => (v === "directie" || v === "overzicht" ? v : null);

export type DirectieAfname = {
  /** organisch | advertentie | beide; null = nog niet vastgelegd bij de klant. */
  focus: "organisch" | "advertentie" | "beide" | null;
  videosPerMaand: number | null;
  opnamedagenPerMaand: number | null;
  /** Plaatst Shortclips de video's (true) of doet de klant dat zelf (false)? */
  plaatsing: boolean;
  kanalen: string[];
};

export type DirectieMaand = {
  key: string;
  label: string;
  opnamedagen: number;
  /** null = de interne videopijplijn wordt voor deze klant niet bijgehouden. */
  geproduceerd: number | null;
  opgeleverd: number | null;
  gepubliceerd: number;
};

export type DirectieUitgevoerd = {
  maanden: DirectieMaand[];
  totaal: { opnamedagen: number; geproduceerd: number | null; opgeleverd: number | null; gepubliceerd: number };
  /** Afgesproken aantal video's over de (verstreken) maanden van de periode; null = onbekend. */
  afgesproken: number | null;
  kanalen: string[];
  formats: { naam: string; aantal: number }[];
};

export type DirectieActie = { kind: ReviewAdvice["kind"]; title: string; text: string };

export type DirectieBeschikbaarheid = { ok: boolean; reden: string | null };

export type DirectieData = {
  clientName: string;
  /** Alleen een data-URL (zoals het portaal ze opslaat); anders null. */
  logoDataUrl: string | null;
  label: string;
  /** Hoofddoel uit het strategieprofiel (leesbaar label); null = niet vastgelegd. */
  doel: string | null;
  strategie: string | null;
  afname: DirectieAfname;
  uitgevoerd: DirectieUitgevoerd;
  /** Weergaven per maand (oudste eerst) voor de ontwikkelingsgrafiek. */
  historie: MaandCijfers[];
  acties: DirectieActie[];
  conclusie: Array<{ kop: string; tekst: string }>;
  boodschap: string;
  beschikbaar: DirectieBeschikbaarheid;
  r: PortalResults;
  review: PeriodReview;
};

const PLAT: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube Shorts", facebook: "Facebook", linkedin: "LinkedIn" };
export const platformNaam = (p: string) => PLAT[p] ?? capitalize(p);

const nf = (n: number) => Math.round(n).toLocaleString("nl-NL");
const lijst = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} en ${xs[xs.length - 1]}`);
const zonderPunt = (t: string) => t.trim().replace(/\.$/, "");

/** Vaste werkzaamheden per soort afname. Alleen wat bij de afspraak hoort. */
export function werkzaamheden(afname: Pick<DirectieAfname, "focus" | "plaatsing">): Array<{ titel: string; items: string[] }> {
  const organisch = {
    titel: "Organische short video content",
    items: [
      "Onderzoek en conceptontwikkeling",
      "Scripts schrijven",
      "Opnamedagen op locatie",
      "Videomontage",
      ...(afname.plaatsing ? ["Publicatie op de afgesproken kanalen"] : []),
      "Resultaten analyseren en de aanpak bijsturen",
    ],
  };
  const ads = {
    titel: "Videoadvertenties",
    items: ["Advertentieconcepten", "Scripts schrijven", "Opnames", "Meerdere openingen (hooks) per video", "Montage", "Analyse van beschikbare advertentieresultaten"],
  };
  if (afname.focus === "organisch") return [organisch];
  if (afname.focus === "advertentie") return [ads];
  if (afname.focus === "beide") return [organisch, ads];
  return [];
}

/**
 * Actiepunten voor de directie: maximaal vijf, alleen uit gemeten resultaten of
 * door het team goedgekeurde verbeterpunten. Nieuwe ideeën die nog niemand heeft
 * beoordeeld (bron "voorstel") blijven buiten de directieversie.
 */
export function directieActies(advice: ReviewAdvice[]): DirectieActie[] {
  const order: Record<ReviewAdvice["kind"], number> = { behouden: 0, verbeteren: 1, testen: 2 };
  return advice
    .filter((a) => a.source !== "voorstel")
    .map((a) => ({ kind: a.kind, title: a.title, text: a.text }))
    .sort((a, b) => order[a.kind] - order[b.kind])
    .slice(0, 5);
}

/**
 * Mag de klant deze directieversie zien? Alleen een afgeronde maand waarvan de
 * maandrapportage door Shortclips is gecontroleerd, goedgekeurd en gepubliceerd,
 * en waarvan de afname vastligt.
 * Zo gaat er nooit een rapport naar een directie dat het team niet heeft gezien.
 */
export function directieBeschikbaar(review: PeriodReview, afname: Pick<DirectieAfname, "focus">, hasData: boolean, live = PORTAL_DIRECTIEVERSIE_LIVE): DirectieBeschikbaarheid {
  if (!live) return { ok: false, reden: "De directieversie is nog niet vrijgegeven voor klanten." };
  if (review.mode === "kwartaal") return { ok: false, reden: "Voor een kwartaal is de kwartaalrapportage met directieoverzicht het rapport voor de directie." };
  if (review.mode !== "maand") return { ok: false, reden: "De directieversie bestaat alleen voor een hele maand." };
  if (!review.complete) return { ok: false, reden: "De maand loopt nog. De directieversie verschijnt na afloop en controle." };
  if (!hasData || !review.summary) return { ok: false, reden: "Voor deze periode zijn er geen resultaten." };
  if (!afname.focus) return { ok: false, reden: "Bij de klant is nog niet vastgelegd of het om organische content, advertenties of beide gaat." };
  if (!review.monthlyReport) return { ok: false, reden: "De maandrapportage van deze maand is nog niet goedgekeurd en gepubliceerd." };
  return { ok: true, reden: null };
}

/** Lichte variant voor de pagina's: mag de klant de directieversie van deze periode downloaden? */
export async function getDirectieBeschikbaarheid(clientId: string, r: Pick<PortalResults, "hasData">, review: PeriodReview): Promise<DirectieBeschikbaarheid> {
  const [c] = await db.select({ contentFocus: clients.contentFocus }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.deletedAt))).limit(1);
  const focus = c?.contentFocus === "organisch" || c?.contentFocus === "advertentie" || c?.contentFocus === "beide" ? c.contentFocus : null;
  return directieBeschikbaar(review, { focus }, r.hasData);
}

/** De vijf kernpunten waarmee het rapport afsluit. Alleen vaste zinnen rond gemeten cijfers. */
export function directieConclusie(input: {
  r: Pick<PortalResults, "metrics" | "deltas">;
  review: Pick<PeriodReview, "works" | "worksNote" | "prevLabel">;
  uitgevoerd: DirectieUitgevoerd;
  acties: DirectieActie[];
}): Array<{ kop: string; tekst: string }> {
  const { r, review, uitgevoerd, acties } = input;
  const u = uitgevoerd.totaal;
  const volgende = "volgende maand";

  const geleverd: string[] = [];
  if (u.gepubliceerd > 0) geleverd.push(`${nf(u.gepubliceerd)} ${u.gepubliceerd === 1 ? "video gepubliceerd" : "video's gepubliceerd"}`);
  if (u.opnamedagen > 0) geleverd.push(`${u.opnamedagen} ${u.opnamedagen === 1 ? "opnamedag" : "opnamedagen"}`);
  let p1 = geleverd.length ? `${capitalize(lijst(geleverd))}${uitgevoerd.kanalen.length ? ` op ${lijst(uitgevoerd.kanalen.map(platformNaam))}` : ""}.` : "In deze periode zijn geen publicaties geregistreerd.";
  if (uitgevoerd.afgesproken && u.gepubliceerd > 0) p1 += ` Afgesproken: ${nf(uitgevoerd.afgesproken)} video's.`;

  const opgeleverd: string[] = [];
  if (r.metrics.views > 0) opgeleverd.push(`${nf(r.metrics.views)} weergaven`);
  if (r.metrics.reach > 0) opgeleverd.push(`een bereik van ${nf(r.metrics.reach)}`);
  if (r.metrics.followerGrowth > 0) opgeleverd.push(`${nf(r.metrics.followerGrowth)} nieuwe volgers`);
  let p2 = opgeleverd.length ? `${capitalize(lijst(opgeleverd))}.` : "Er zijn geen cijfers gemeten in deze periode.";
  if (r.deltas.views !== null && review.prevLabel && r.deltas.views !== 0) {
    p2 += ` Dat is ${Math.abs(r.deltas.views)}% ${r.deltas.views > 0 ? "meer" : "minder"} weergaven dan in ${review.prevLabel}.`;
  }
  p2 += " Aanvragen en omzet zijn niet gemeten.";

  const top = review.works.find((w) => w.status === "bewezen") ?? review.works[0];
  const p3 = top ? `${top.label}: ${zonderPunt(top.value)} werkt bij dit account het best (${top.detail}).` : review.worksNote ?? "Er is nog geen onderdeel dat duidelijk beter werkt dan de rest.";

  const aanpassen = acties.filter((a) => a.kind !== "behouden").map((a) => zonderPunt(a.title));
  const p4 = aanpassen.length ? `${capitalize(lijst(aanpassen.slice(0, 3)))}.` : "Voor deze periode zijn geen aanpassingen vastgelegd.";

  const eerst = acties.find((a) => a.kind === "verbeteren") ?? acties.find((a) => a.kind === "testen") ?? acties.find((a) => a.kind === "behouden");
  const p5 = eerst ? `${eerst.kind === "behouden" ? "Vasthouden aan" : eerst.kind === "testen" ? "Testen" : "Verbeteren"}: ${zonderPunt(eerst.title)}.` : `De prioriteit voor ${volgende} volgt zodra er genoeg video's met resultaten zijn.`;

  return [
    { kop: "Geleverd", tekst: p1 },
    { kop: "Opgeleverd", tekst: p2 },
    { kop: "Belangrijkste inzicht", tekst: p3 },
    { kop: "Aanpassing", tekst: p4 },
    { kop: `Prioriteit ${volgende}`, tekst: p5 },
  ];
}

/** Telt de maanden van de periode op tot één overzicht van het uitgevoerde werk. */
export function telUitgevoerd(maanden: Array<{ key: string; g: Gerealiseerd }>, videosPerMaand: number | null): DirectieUitgevoerd {
  const pipeline = maanden.some((m) => m.g.pipelineBijgehouden);
  const rows: DirectieMaand[] = maanden.map(({ key, g }) => ({
    key,
    label: capitalize(monthLabel(key)),
    opnamedagen: g.opnamedagen.aantal,
    geproduceerd: g.pipelineBijgehouden ? g.geproduceerd : null,
    opgeleverd: g.pipelineBijgehouden ? g.opgeleverd : null,
    gepubliceerd: g.gepubliceerd,
  }));
  const som = (f: (m: DirectieMaand) => number | null) => rows.reduce((a, m) => a + (f(m) ?? 0), 0);
  const formats = new Map<string, number>();
  for (const { g } of maanden) for (const f of g.formats) formats.set(f.naam, (formats.get(f.naam) ?? 0) + f.aantal);
  return {
    maanden: rows,
    totaal: {
      opnamedagen: som((m) => m.opnamedagen),
      geproduceerd: pipeline ? som((m) => m.geproduceerd) : null,
      opgeleverd: pipeline ? som((m) => m.opgeleverd) : null,
      gepubliceerd: som((m) => m.gepubliceerd),
    },
    afgesproken: videosPerMaand && videosPerMaand > 0 ? videosPerMaand * rows.length : null,
    kanalen: [...new Set(maanden.flatMap((m) => m.g.kanalen))],
    formats: [...formats.entries()].map(([naam, aantal]) => ({ naam, aantal })).sort((a, b) => b.aantal - a.aantal).slice(0, 6),
  };
}

/**
 * Alles voor de directieversie van één klant en één periode. De aanroeper heeft
 * de klanttoegang al afgedwongen (portaal: eigen klant; intern: assertClientAccess
 * in getPortalResultsForClient / getPeriodReviewForClient).
 * Geeft null terug voor alles behalve een kalendermaand.
 */
export async function loadDirectieData(clientId: string, r: PortalResults, review: PeriodReview): Promise<DirectieData | null> {
  if (review.mode !== "maand") return null;
  const today = amsToday();
  const months = [r.periodKey].filter((k) => /^\d{4}-\d{2}$/.test(k) && `${k}-01` <= today);
  if (months.length === 0) return null;
  const last = months[0]!;

  const [[client], packs, strategy, realized, historie] = await Promise.all([
    db
      .select({ name: clients.name, logoUrl: clients.logoUrl, contentFocus: clients.contentFocus, quota: clients.monthlyVideoQuota, weHandlePosting: clients.weHandlePosting })
      .from(clients)
      .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
      .limit(1),
    // Bewust alleen aantallen: de prijs van het pakket hoort niet in een klantrapport.
    db
      .select({ videos: clientPackages.videosPerMonth, shootDays: clientPackages.shootDaysPerMonth })
      .from(clientPackages)
      .where(and(eq(clientPackages.clientId, clientId), eq(clientPackages.isActive, true))),
    loadStrategyProfile(clientId),
    Promise.all(months.map(async (key) => ({ key, g: await getGerealiseerd(clientId, key) }))),
    monthSeries(clientId, last, 5).catch(() => [] as MaandCijfers[]),
  ]);
  if (!client) return null;

  const packVideos = packs.reduce((a, p) => a + (p.videos ?? 0), 0);
  const packShoots = packs.reduce((a, p) => a + (p.shootDays ?? 0), 0);
  const videosPerMaand = packVideos > 0 ? packVideos : client.quota > 0 ? client.quota : null;
  const focus = client.contentFocus === "organisch" || client.contentFocus === "advertentie" || client.contentFocus === "beide" ? client.contentFocus : null;
  const uitgevoerd = telUitgevoerd(realized, videosPerMaand);
  const kanalen = r.plannedPlatforms.length ? r.plannedPlatforms : uitgevoerd.kanalen;
  const afname: DirectieAfname = { focus, videosPerMaand, opnamedagenPerMaand: packShoots > 0 ? packShoots : null, plaatsing: client.weHandlePosting, kanalen };
  const acties = directieActies(review.advice);

  return {
    clientName: client.name,
    logoDataUrl: client.logoUrl && client.logoUrl.startsWith("data:image/") ? client.logoUrl : null,
    label: capitalize(review.label),
    doel: strategy.primaryGoal ? goalLabel(strategy.primaryGoal) : null,
    strategie: strategy.strategyNote.trim() || null,
    afname,
    uitgevoerd,
    historie,
    acties,
    conclusie: directieConclusie({ r, review, uitgevoerd, acties }),
    boodschap: review.summary?.bereikt ?? "Voor deze periode zijn er nog geen resultaten beschikbaar.",
    beschikbaar: directieBeschikbaar(review, afname, r.hasData),
    r,
    review,
  };
}
