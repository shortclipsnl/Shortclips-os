import "server-only";
import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings, clients, tasks, users } from "@/db/schema";
import { isCoreStaff } from "@/server/core-staff";
import { notify } from "@/server/notifications";
import { runJob } from "@/server/jobs/runner";
import { todayAmsterdam } from "@/lib/planning-deadline";
import {
  KLANTMOMENT_PREFIX,
  computeMoments,
  isDue,
  longDate,
  momentDedupeKey,
  momentLabel,
  taskDescription,
  yearOnlyJubilee,
  type ClientMoment,
  type DateStatus,
  type MomentInput,
} from "@/lib/klantmomenten";

/**
 * Klantmomenten (nov 2026): samenwerkingsjubilea en bedrijfsjubilea.
 *
 * Geen aparte pagina en geen nieuwe tabel. De gegevens die nog niet in het
 * klantrecord staan (indicatie van de startdatum, oprichtingsdatum of -jaar)
 * staan in één app-instelling per klant-id. "Klant sinds" uit het klantrecord
 * blijft leidend; de indicatie wordt alleen gebruikt zolang dat veld leeg is.
 *
 * Een week vooraf krijgt de verantwoordelijke van de klant (coördinator) een
 * taak op de eigen takenpagina én een melding. Elke taak bestaat per moment
 * maar één keer (ook na afronden), dus er komt nooit een dubbele.
 */

const SETTING_KEY = "klantmomenten.data";

export type MomentData = {
  /** Indicatie van de start van de samenwerking (alleen gebruikt als "Klant sinds" leeg is). */
  startEstimate?: string | null;
  /** Bevestigde start uit een getekende offerte (alleen gebruikt als "Klant sinds" leeg is). */
  startConfirmed?: string | null;
  foundedOn?: string | null;
  foundedYear?: number | null;
  foundedSource?: string | null;
  /** Korte notitie voor het team, bijv. een tegenstrijdigheid om recht te zetten. */
  note?: string | null;
};

type MomentStore = Record<string, MomentData>;

/**
 * Startwaarden uit het onderzoek Klantmomenten (12 nov 2026), per klant-slug.
 * Wordt alleen gebruikt om de instelling de eerste keer te vullen; daarna is
 * de instelling (te wijzigen op de klantpagina) de enige bron.
 */
const SEED: Record<string, MomentData> = {
  "donker-groep": { startEstimate: "2025-11-18", foundedYear: 1961, foundedSource: "Website klant" },
  luxewagen: { startEstimate: "2023-01-01", foundedYear: 2001, foundedSource: "Eigen opgave klant", note: "Spelling contactpersoon controleren: Venema of Veenema." },
  "shades-by-erik-kuster": { startConfirmed: "2026-02-20" },
  "365werk": { foundedYear: 2013, foundedSource: "Website klant" },
  "makelaardij-friesland": { startEstimate: "2025-04-01", foundedOn: "1998-06-01", foundedYear: 1998, foundedSource: "Openbaar register" },
  "hoekstra-transport": { startConfirmed: "2026-06-10", foundedYear: 1929, foundedSource: "Website klant" },
  "marco-van-beek-premium-cars": { startEstimate: "2023-07-01", foundedYear: 1939, foundedSource: "Website klant" },
  nahv: { startEstimate: "2024-07-01" },
  ai2: { startEstimate: "2025-08-01" },
  "benz-collector-sneek": { startEstimate: "2023-08-01" },
  hegro: { startConfirmed: "2026-09-21" },
  kubo: { startConfirmed: "2026-09-24" },
  "koops-chalets": { startEstimate: "2023-10-01" },
};

async function readStore(): Promise<MomentStore | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SETTING_KEY)).limit(1);
  return row ? ((row.value as MomentStore) ?? {}) : null;
}

async function writeStore(store: MomentStore, updatedById?: string | null): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: SETTING_KEY, value: store, category: "klantmomenten", description: "Klantmomenten: startdatum-indicatie en oprichtingsdatum per klant", updatedById: updatedById ?? null })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: store, updatedById: updatedById ?? null, updatedAt: new Date() } });
}

/** Alle momentgegevens, per klant-id. Vult de instelling de eerste keer uit het onderzoek. */
export async function getMomentStore(): Promise<MomentStore> {
  const existing = await readStore();
  if (existing) return existing;
  const rows = await db.select({ id: clients.id, slug: clients.slug }).from(clients).where(inArray(clients.slug, Object.keys(SEED)));
  const store: MomentStore = {};
  for (const r of rows) store[r.id] = SEED[r.slug]!;
  await writeStore(store);
  return store;
}

export async function updateMomentData(clientId: string, patch: MomentData, updatedById: string): Promise<void> {
  const store = await getMomentStore();
  store[clientId] = { ...(store[clientId] ?? {}), ...patch };
  await writeStore(store, updatedById);
}

/** Effectieve invoer voor de berekening. "Klant sinds" uit het klantrecord gaat altijd voor. */
export function momentInput(startedOn: string | null, data: MomentData | undefined): MomentInput {
  const d = data ?? {};
  let start: MomentInput["start"] = null;
  if (startedOn) start = { date: startedOn.slice(0, 10), status: "bevestigd" };
  else if (d.startConfirmed) start = { date: d.startConfirmed, status: "bevestigd" };
  else if (d.startEstimate) start = { date: d.startEstimate, status: "indicatie" };
  return {
    start,
    foundedOn: d.foundedOn ?? null,
    foundedYear: d.foundedYear ?? (d.foundedOn ? Number(d.foundedOn.slice(0, 4)) : null),
    foundedStatus: d.foundedSource === "KvK-uittreksel" ? "bevestigd" : "indicatie",
  };
}

/* ----------------------------- klantpagina ----------------------------- */

export type ClientMomentsView = {
  upcoming: (ClientMoment & { label: string; taskOpen: boolean })[];
  yearOnly: { year: number; years: number } | null;
  missingStart: boolean;
  startSource: "klantrecord" | "offerte" | "indicatie" | null;
  data: MomentData;
  note: string | null;
  history: { title: string; date: string; by: string | null }[];
};

export async function getClientMomentsView(clientId: string, startedOn: string | null): Promise<ClientMomentsView> {
  const store = await getMomentStore();
  const data = store[clientId] ?? {};
  const input = momentInput(startedOn, data);
  const today = todayAmsterdam();
  const moments = computeMoments(input, today, 1100).slice(0, 4);

  const rows = await db
    .select({ title: tasks.title, status: tasks.status, dedupeKey: tasks.dedupeKey, completedAt: tasks.completedAt, by: users.fullName })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(eq(tasks.clientId, clientId), like(tasks.dedupeKey, `${KLANTMOMENT_PREFIX}%`), isNull(tasks.deletedAt)));
  const openKeys = new Set(rows.filter((r) => r.status !== "done" && r.status !== "cancelled").map((r) => r.dedupeKey));

  return {
    upcoming: moments.map((m) => ({ ...m, label: momentLabel(m), taskOpen: openKeys.has(momentDedupeKey(clientId, m)) })),
    yearOnly: yearOnlyJubilee(input, today),
    missingStart: !input.start,
    startSource: startedOn ? "klantrecord" : data.startConfirmed ? "offerte" : data.startEstimate ? "indicatie" : null,
    data,
    note: data.note ?? null,
    history: rows
      .filter((r) => r.status === "done" && r.completedAt)
      .map((r) => ({ title: r.title.split(" | ").pop() ?? r.title, date: new Date(r.completedAt!).toISOString().slice(0, 10), by: r.by }))
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

/* ------------------------------ taken + melding ------------------------------ */

export async function syncClientMomentTasks(today = todayAmsterdam()) {
  const out = { checked: 0, created: 0, skippedNoOwner: 0 };
  const store = await getMomentStore();
  const rows = await db
    .select({
      id: clients.id,
      slug: clients.slug,
      name: clients.name,
      status: clients.status,
      startedOn: clients.startedOn,
      coordinatorId: clients.coordinatorId,
      coordStatus: users.status,
      coordEmail: users.email,
      coordDeleted: users.deletedAt,
    })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(and(isNull(clients.deletedAt), eq(clients.status, "active")));

  for (const c of rows) {
    const due = computeMoments(momentInput(c.startedOn, store[c.id]), today, 10).filter((m) => isDue(m, today));
    for (const m of due) {
      out.checked++;
      const key = momentDedupeKey(c.id, m);
      // Bestaat de taak al (open of afgerond), dan niets doen: nooit dubbel.
      const [existing] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.dedupeKey, key), isNull(tasks.deletedAt))).limit(1);
      if (existing) continue;

      const ownerOk = c.coordinatorId && !c.coordDeleted && c.coordStatus === "active" && isCoreStaff(c.coordEmail);
      if (!ownerOk) {
        out.skippedNoOwner++;
        continue;
      }
      const label = momentLabel(m);
      const [task] = await db
        .insert(tasks)
        .values({
          clientId: c.id,
          title: `${c.name} | Klantmoment | ${label}`,
          description: taskDescription(m),
          status: "todo",
          priority: "normal",
          category: "klantcontact",
          assigneeId: c.coordinatorId!,
          dueOn: m.date,
          entityType: "client",
          entityId: c.id,
          source: "automation",
          dedupeKey: key,
        })
        .onConflictDoNothing()
        .returning({ id: tasks.id });
      if (!task) continue;

      const days = Math.max(0, Math.round((Date.parse(`${m.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
      const wanneer = days === 0 ? "vandaag" : days === 1 ? "morgen" : `over ${days} dagen`;
      await notify({
        userIds: [c.coordinatorId!],
        clientId: c.id,
        type: "client.moment",
        level: "info",
        title: `Klantmoment ${wanneer}: ${c.name}, ${label}`,
        body: `${label} op ${longDate(m.date)}.${m.status === "indicatie" ? " De datum is een indicatie, controleer die eerst bij de klant." : ""} De taak staat op je takenpagina.`,
        href: `/clients/${c.slug}`,
        entityType: "client",
        entityId: c.id,
        dedupeKey: key,
      });
      out.created++;
    }
  }
  return out;
}

/** Dagelijkse job klantmomenten.sync. */
export async function runKlantmomentenSync() {
  return runJob("system", "klantmomenten.sync", {}, async (ctx) => {
    const r = await syncClientMomentTasks();
    ctx.counters.processed = r.checked;
    ctx.counters.created = r.created;
    ctx.log(`Klantmomenten: ${r.created} taken aangemaakt, ${r.skippedNoOwner} zonder verantwoordelijke.`);
  });
}

let lastRun = 0;
/** Vangnet bij het laden van de takenpagina: hooguit eens per uur per server-instantie. */
export async function syncClientMomentTasksIfStale(maxAgeMinutes = 60): Promise<void> {
  if (Date.now() - lastRun < maxAgeMinutes * 60_000) return;
  lastRun = Date.now();
  try {
    await syncClientMomentTasks();
  } catch (error) {
    console.error("[klantmomenten] synchroniseren mislukt", error);
  }
}

export type { DateStatus };
