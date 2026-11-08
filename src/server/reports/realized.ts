import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Deterministische "Dit hebben we gerealiseerd"-cijfers voor één klant en maand
 * (sectie 1 van de maandrapportage). Puur uit de database — geen AI, geen
 * schattingen. Wordt bij het genereren meeberekend en in het rapport opgeslagen,
 * zodat het regen-bestendig is (bij opnieuw genereren gewoon opnieuw berekend).
 */

export type GerealiseerdePublicatie = {
  datum: string | null;
  tijd: string | null;
  titel: string;
  platforms: string[];
};

export type Gerealiseerd = {
  /** Opnamedagen die in deze maand plaatsvonden (niet geannuleerd). */
  opnamedagen: { aantal: number; datums: string[] };
  /** Video's gemaakt uit de opnames van deze maand (deliverables met opnamedatum in de maand). */
  geproduceerd: number;
  /** Daarvan opgeleverd: video's die minstens de klant-review-fase bereikten. */
  opgeleverd: number;
  /** Unieke video's die deze maand live gingen (ontdubbeld over kanalen). */
  gepubliceerd: number;
  /** Kanalen waarop deze maand is gepubliceerd. */
  kanalen: string[];
  /** De gepubliceerde video's met datum, tijd en kanaal/kanalen. */
  publicaties: GerealiseerdePublicatie[];
  /** Ingezette formats deze maand, met aantal video's per format. */
  formats: { naam: string; aantal: number }[];
  /** False als de interne video-pipeline (deliverables) niet wordt bijgehouden voor
   *  deze klant — dan zijn geproduceerd/opgeleverd 0 en tonen we dat eerlijk. */
  pipelineBijgehouden: boolean;
};

/** Statussen die gelden als "opgeleverd" (klant-review of verder in de pijplijn). */
const OPGELEVERD = new Set([
  "client_review",
  "approved",
  "ready_to_publish",
  "scheduled",
  "published",
  "analysis_available",
]);

/** Begin- en einddatum (YYYY-MM-DD) van een kalendermaand "YYYY-MM". */
function monthBounds(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const from = `${period}-01`;
  const to = new Date(y!, m!, 0).toLocaleDateString("en-CA"); // laatste dag van de maand
  return { from, to };
}

const rowsOf = (res: unknown): Array<Record<string, unknown>> =>
  ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<Record<string, unknown>>;

export async function getGerealiseerd(clientId: string, period: string): Promise<Gerealiseerd> {
  const { from, to } = monthBounds(period);

  // 1. Opnamedagen in de maand (niet geannuleerd).
  const dagenRes = await db.execute(sql`
    select to_char(scheduled_on, 'YYYY-MM-DD') as datum
    from production_days
    where client_id = ${clientId} and deleted_at is null
      and scheduled_on >= ${from} and scheduled_on <= ${to}
      and status <> 'cancelled'
    order by scheduled_on
  `);
  const datums = rowsOf(dagenRes).map((r) => String(r.datum)).filter(Boolean);

  // 2. Deliverables uit de opnames van deze maand (shoot_on, of de gekoppelde
  //    opnamedag). Geproduceerd = alles; opgeleverd = minstens klant-review.
  const delivRes = await db.execute(sql`
    select d.status as status
    from deliverables d
    left join production_days pd on pd.id = d.production_day_id
    where d.client_id = ${clientId} and d.deleted_at is null
      and coalesce(d.shoot_on, pd.scheduled_on) >= ${from}
      and coalesce(d.shoot_on, pd.scheduled_on) <= ${to}
  `);
  const delivRows = rowsOf(delivRes);
  const geproduceerd = delivRows.length;
  const opgeleverd = delivRows.filter((r) => OPGELEVERD.has(String(r.status))).length;

  // 3. Gepubliceerde video's in de maand, met kanaal, datum/tijd en format.
  //    Ontdubbeld over kanalen via de deliverable (of de publicatie zelf).
  const pubRes = await db.execute(sql`
    select p.id as pub_id, p.deliverable_id as deliverable_id, p.platform as platform,
           to_char(coalesce(p.published_at, d.published_at), 'YYYY-MM-DD') as datum,
           to_char(coalesce(p.published_at, d.published_at), 'HH24:MI') as tijd,
           left(coalesce(d.title, p.caption), 120) as titel,
           sc.format as format
    from publications p
    left join deliverables d on d.id = p.deliverable_id and d.deleted_at is null
    left join scripts sc on sc.id = d.script_id and sc.deleted_at is null
    where p.client_id = ${clientId} and p.deleted_at is null and p.status = 'published'
      and coalesce(p.published_at, d.published_at)::date >= ${from}
      and coalesce(p.published_at, d.published_at)::date <= ${to}
    order by coalesce(p.published_at, d.published_at)
  `);
  const pubRows = rowsOf(pubRes);

  // Groepeer per unieke video (deliverable, of de publicatie zelf als er geen
  // deliverable aan hangt) zodat dezelfde video op meerdere kanalen één keer telt.
  type Agg = { datum: string | null; tijd: string | null; titel: string; platforms: Set<string>; format: string | null };
  const byVideo = new Map<string, Agg>();
  const kanalen = new Set<string>();
  for (const r of pubRows) {
    const key = r.deliverable_id ? `d:${String(r.deliverable_id)}` : `p:${String(r.pub_id)}`;
    const platform = r.platform ? String(r.platform) : null;
    if (platform) kanalen.add(platform);
    let agg = byVideo.get(key);
    if (!agg) {
      agg = { datum: r.datum ? String(r.datum) : null, tijd: r.tijd ? String(r.tijd) : null, titel: String(r.titel ?? "Video"), platforms: new Set(), format: r.format ? String(r.format) : null };
      byVideo.set(key, agg);
    }
    if (platform) agg.platforms.add(platform);
  }

  const publicaties: GerealiseerdePublicatie[] = [...byVideo.values()].map((v) => ({
    datum: v.datum,
    tijd: v.tijd,
    titel: v.titel,
    platforms: [...v.platforms],
  }));

  // Formats: aantal unieke video's per (niet-lege) format.
  const formatCount = new Map<string, number>();
  for (const v of byVideo.values()) {
    if (v.format) formatCount.set(v.format, (formatCount.get(v.format) ?? 0) + 1);
  }
  const formats = [...formatCount.entries()]
    .map(([naam, aantal]) => ({ naam, aantal }))
    .sort((a, b) => b.aantal - a.aantal);

  return {
    opnamedagen: { aantal: datums.length, datums },
    geproduceerd,
    opgeleverd,
    gepubliceerd: byVideo.size,
    kanalen: [...kanalen],
    publicaties,
    formats,
    pipelineBijgehouden: geproduceerd > 0,
  };
}

/* --- Sectie 5: "Dit staat er volgende maand gepland" --- */

export type GeplandePublicatie = { datum: string | null; tijd: string | null; titel: string; platforms: string[] };
export type Klantactie = { titel: string; detail: string };
export type Vooruitblik = {
  /** De eerstvolgende opnamedag (vanaf vandaag), met de scriptstatus. */
  volgendeOpnamedag: { datum: string; titel: string; scriptStatus: string; scriptStatusLabel: string } | null;
  /** Aantal met de klant gedeelde, geplande publicaties vanaf nu. */
  geplandeVideos: number;
  /** De geplande, met de klant gedeelde publicaties (datum, tijd, kanalen). */
  publicaties: GeplandePublicatie[];
  /** Openstaande acties die bij de klant liggen (video's die op akkoord wachten). */
  klantacties: Klantactie[];
};

/** Klantvriendelijke labels voor de scriptingstatus van een opnamedag. */
const SCRIPT_STATUS_LABEL: Record<string, string> = {
  afstemmen: "Afstemmen met jullie",
  concepting: "Script wordt geschreven",
  klaar_shortclips: "Script klaar bij Shortclips",
  scriptmeeting: "Scriptbespreking gepland",
  final: "Script definitief",
};

export async function getVooruitblik(clientId: string): Promise<Vooruitblik> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });

  // Eerstvolgende opnamedag (niet geannuleerd) + scriptstatus.
  const dagRes = await db.execute(sql`
    select to_char(scheduled_on, 'YYYY-MM-DD') as datum, title, scripting_status as scripting_status
    from production_days
    where client_id = ${clientId} and deleted_at is null
      and scheduled_on >= ${today} and status <> 'cancelled'
    order by scheduled_on
    limit 1
  `);
  const dag = rowsOf(dagRes)[0];
  const volgendeOpnamedag = dag
    ? {
        datum: String(dag.datum),
        titel: String(dag.title ?? "Opnamedag"),
        scriptStatus: String(dag.scripting_status ?? ""),
        scriptStatusLabel: SCRIPT_STATUS_LABEL[String(dag.scripting_status ?? "")] ?? "Scripting loopt",
      }
    : null;

  // Geplande, met de klant gedeelde publicaties (alleen clientApproved zijn zichtbaar).
  const pubRes = await db.execute(sql`
    select to_char(scheduled_on, 'YYYY-MM-DD') as datum, to_char(scheduled_at, 'HH24:MI') as tijd,
           left(title, 120) as titel, platforms
    from content_calendar
    where client_id = ${clientId} and deleted_at is null
      and client_approved = true and scheduled_on >= ${today}
    order by scheduled_on, scheduled_at nulls last
    limit 30
  `);
  const publicaties: GeplandePublicatie[] = rowsOf(pubRes).map((r) => ({
    datum: r.datum ? String(r.datum) : null,
    tijd: r.tijd ? String(r.tijd) : null,
    titel: String(r.titel ?? "Video"),
    platforms: Array.isArray(r.platforms) ? (r.platforms as string[]) : [],
  }));

  // Video's die op akkoord van de klant wachten = openstaande klantacties.
  const actieRes = await db.execute(sql`
    select left(title, 120) as titel, status
    from deliverables
    where client_id = ${clientId} and deleted_at is null
      and status in ('client_review', 'client_revision')
    order by status_changed_at
    limit 20
  `);
  const klantacties: Klantactie[] = rowsOf(actieRes).map((r) => ({
    titel: String(r.titel ?? "Video"),
    detail: String(r.status) === "client_revision" ? "wacht op jullie aangepaste feedback" : "wacht op jullie akkoord",
  }));

  return { volgendeOpnamedag, geplandeVideos: publicaties.length, publicaties, klantacties };
}
