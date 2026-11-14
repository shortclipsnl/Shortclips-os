import "server-only";
import { and, asc, desc, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { calendarEvents, quotes, salesLeads } from "@/db/schema";
import { getContractsDashboard } from "@/server/contracts";
import { addDaysIso, amsStartOfDay } from "./time";

/**
 * Feiten voor de coach, uitsluitend uit het portaal zelf. Alles wat hier niet
 * staat, kent de coach niet en mag hij ook niet invullen.
 */

const eur = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const daysSince = (d: Date | null, now = new Date()) => (d ? Math.floor((now.getTime() - d.getTime()) / 86400000) : null);

export async function openOffertes() {
  const rows = await db
    .select({
      nummer: quotes.number,
      titel: quotes.title,
      bedrijf: quotes.recipientCompany,
      status: quotes.status,
      bedrag: quotes.amount,
      verzonden: quotes.sentAt,
      laatstBekeken: quotes.lastOpenedAt,
      keerBekeken: quotes.openCount,
      verloopt: quotes.expiresOn,
      verzender: quotes.senderName,
    })
    .from(quotes)
    .where(and(isNull(quotes.deletedAt), inArray(quotes.status, ["verzonden", "bekeken"])))
    .orderBy(desc(quotes.amount))
    .limit(25);
  return rows.map((r) => ({
    nummer: r.nummer,
    bedrijf: r.bedrijf ?? r.titel,
    status: r.status,
    bedragExBtw: eur(r.bedrag),
    dagenSindsVerzonden: daysSince(r.verzonden),
    laatstBekekenDagenGeleden: daysSince(r.laatstBekeken),
    keerBekeken: r.keerBekeken,
    verlooptOp: r.verloopt ? r.verloopt.toISOString().slice(0, 10) : null,
    verzender: r.verzender,
  }));
}

export async function offerteBewegingen(vanIso: string, totIso: string) {
  const van = amsStartOfDay(vanIso);
  const tot = amsStartOfDay(addDaysIso(totIso, 1));
  const rows = await db
    .select({
      bedrijf: quotes.recipientCompany,
      titel: quotes.title,
      status: quotes.status,
      bedrag: quotes.amount,
      verzonden: quotes.sentAt,
      geaccepteerd: quotes.acceptedAt,
      afgewezen: quotes.declinedAt,
    })
    .from(quotes)
    .where(
      and(
        isNull(quotes.deletedAt),
        or(
          and(gte(quotes.sentAt, van), lt(quotes.sentAt, tot)),
          and(gte(quotes.acceptedAt, van), lt(quotes.acceptedAt, tot)),
          and(gte(quotes.declinedAt, van), lt(quotes.declinedAt, tot)),
        ),
      ),
    );
  const inPeriode = (d: Date | null) => !!d && d >= van && d < tot;
  const verzonden = rows.filter((r) => inPeriode(r.verzonden));
  const getekend = rows.filter((r) => inPeriode(r.geaccepteerd));
  const afgewezen = rows.filter((r) => inPeriode(r.afgewezen));
  const som = (l: typeof rows) => l.reduce((s, r) => s + eur(r.bedrag), 0);
  const namen = (l: typeof rows) => l.map((r) => `${r.bedrijf ?? r.titel} (€${eur(r.bedrag)})`);
  return {
    verzonden: { aantal: verzonden.length, bedrag: som(verzonden), lijst: namen(verzonden) },
    getekend: { aantal: getekend.length, bedrag: som(getekend), lijst: namen(getekend) },
    afgewezen: { aantal: afgewezen.length, bedrag: som(afgewezen), lijst: namen(afgewezen) },
  };
}

export async function leadsOverzicht(vanIso: string, totIso: string) {
  const van = amsStartOfDay(vanIso);
  const tot = amsStartOfDay(addDaysIso(totIso, 1));
  const open = await db
    .select({
      bedrijf: salesLeads.company,
      status: salesLeads.status,
      verwachtPerMaand: salesLeads.expectedMonthly,
      opvolgen: salesLeads.followUpOn,
      klasse: salesLeads.leadClass,
      score: salesLeads.leadScore,
      bron: salesLeads.source,
      aangemaakt: salesLeads.createdAt,
      bijgewerkt: salesLeads.updatedAt,
    })
    .from(salesLeads)
    .where(and(isNull(salesLeads.deletedAt), ne(salesLeads.status, "gewonnen"), ne(salesLeads.status, "verloren")))
    .orderBy(asc(salesLeads.followUpOn), desc(salesLeads.updatedAt))
    .limit(30);
  const [periode] = await db
    .select({
      nieuw: sql<number>`count(*) filter (where ${salesLeads.createdAt} >= ${van} and ${salesLeads.createdAt} < ${tot})::int`,
      gewonnen: sql<number>`count(*) filter (where ${salesLeads.status} = 'gewonnen' and ${salesLeads.updatedAt} >= ${van} and ${salesLeads.updatedAt} < ${tot})::int`,
      verloren: sql<number>`count(*) filter (where ${salesLeads.status} = 'verloren' and ${salesLeads.updatedAt} >= ${van} and ${salesLeads.updatedAt} < ${tot})::int`,
    })
    .from(salesLeads)
    .where(isNull(salesLeads.deletedAt));
  return {
    open: open.map((l) => ({
      bedrijf: l.bedrijf,
      status: l.status,
      verwachtPerMaand: eur(l.verwachtPerMaand),
      opvolgenOp: l.opvolgen ?? null,
      klasse: l.klasse,
      score: l.score,
      bron: l.bron,
      dagenOud: daysSince(l.aangemaakt),
      dagenSindsBijgewerkt: daysSince(l.bijgewerkt),
    })),
    periode: { nieuweLeads: periode?.nieuw ?? 0, gewonnen: periode?.gewonnen ?? 0, verloren: periode?.verloren ?? 0 },
  };
}

export async function agenda(vanIso: string, totIso: string) {
  const van = amsStartOfDay(vanIso);
  const tot = amsStartOfDay(addDaysIso(totIso, 1));
  const rows = await db
    .select({
      titel: calendarEvents.title,
      soort: calendarEvents.kind,
      agenda: calendarEvents.calendarName,
      start: calendarEvents.startsAt,
      eind: calendarEvents.endsAt,
      heleDag: calendarEvents.allDay,
      status: calendarEvents.status,
    })
    .from(calendarEvents)
    .where(and(gte(calendarEvents.startsAt, van), lt(calendarEvents.startsAt, tot), isNull(calendarEvents.dismissedAt)))
    .orderBy(asc(calendarEvents.startsAt))
    .limit(80);
  const tijd = (d: Date | null) => (d ? d.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "");
  return rows
    .filter((r) => r.status !== "cancelled")
    .map((r) => ({ wanneer: r.heleDag ? `${tijd(r.start).split(" ")[0]} hele dag` : `${tijd(r.start)}-${r.eind ? r.eind.toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" }) : "?"}`, titel: r.titel ?? "(zonder titel)", soort: r.soort, agenda: r.agenda }));
}

export async function contracten() {
  const d = await getContractsDashboard();
  return {
    actieveKlanten: d.totals.activeClients,
    maandelijkseContractomzet: eur(d.totals.monthlyRevenue),
    binnenkortAflopend: d.totals.expiringSoon,
    aandacht: d.attention.slice(0, 8).map((a) => ({ klant: a.clientName, urgentie: a.tone, wat: a.title, detail: a.detail })),
  };
}

/** Veilig uitvoeren: een mislukte bron mag de coach niet stilleggen. */
export async function veilig<T>(naam: string, fn: () => Promise<T>): Promise<T | { fout: string }> {
  try {
    return await fn();
  } catch (e) {
    return { fout: `${naam} niet beschikbaar: ${e instanceof Error ? e.message.slice(0, 160) : "onbekende fout"}` };
  }
}
