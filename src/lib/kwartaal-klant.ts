import type { QuarterMetrics, QuarterVideo } from "@/server/quarterly/metrics";
import type { QuarterKlant } from "./kwartaal-inhoud";

/**
 * De klantweergave van een kwartaalrapportage. Alleen wat een klant mag zien:
 * geen interne verdieping, geen datakwaliteitsnotities, geen opvolging van
 * interne verbeterpunten, geen klantfeedbackregistratie. Het klantportaal en de
 * klant-PDF gebruiken uitsluitend dit type, zodat interne informatie er niet
 * per ongeluk in terecht kan komen.
 */
export type KlantMetrics = Pick<
  QuarterMetrics,
  "periode" | "voorlopig" | "segmenten" | "totaal" | "kijktijd" | "profielbezoeken" | "websiteKlikken" | "conversies" | "platforms" | "geleverd" | "doelen"
> & {
  pakket: Pick<QuarterMetrics["pakket"], "type" | "label" | "naam" | "videosPerMaand" | "verwachtInKwartaal" | "bijzonderheden">;
  vorig: (Pick<NonNullable<QuarterMetrics["vorig"]>, "key" | "label" | "vergelijkbaar" | "pct"> & { totaal: NonNullable<QuarterMetrics["vorig"]>["totaal"] }) | null;
  /** Alleen de video's die in de rapportage worden uitgelicht. */
  topVideos: QuarterVideo[];
  bronnen: Array<{ naam: string; periode: string }>;
};

export function toKlantMetrics(m: QuarterMetrics, klant: QuarterKlant): KlantMetrics {
  const keys = klant.topVideos.map((t) => t.key);
  const byKey = new Map((m.videos ?? []).map((v) => [v.key, v]));
  return {
    periode: m.periode, voorlopig: m.voorlopig, segmenten: m.segmenten, totaal: m.totaal, kijktijd: m.kijktijd,
    profielbezoeken: m.profielbezoeken, websiteKlikken: m.websiteKlikken, conversies: m.conversies, platforms: m.platforms,
    geleverd: m.geleverd, doelen: m.doelen,
    pakket: { type: m.pakket.type, label: m.pakket.label, naam: m.pakket.naam, videosPerMaand: m.pakket.videosPerMaand, verwachtInKwartaal: m.pakket.verwachtInKwartaal, bijzonderheden: m.pakket.bijzonderheden },
    vorig: m.vorig ? { key: m.vorig.key, label: m.vorig.label, vergelijkbaar: m.vorig.vergelijkbaar, pct: m.vorig.pct, totaal: m.vorig.vergelijkbaar ? m.vorig.totaal : null } : null,
    topVideos: keys.map((k) => byKey.get(k)).filter((v): v is QuarterVideo => Boolean(v)),
    bronnen: (m.bronnen ?? []).slice(0, 3).map((b) => ({ naam: b.naam, periode: b.periode })),
  };
}

export type KlantRapport = {
  id: string;
  title: string;
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  clientName: string;
  logoUrl: string | null;
  versie: number;
  publishedAt: string | null;
  klant: QuarterKlant;
  metrics: KlantMetrics;
  /** Miniaturen (data-URI) per publicatie-id van de uitgelichte video's. */
  thumbs: Record<string, string>;
};
