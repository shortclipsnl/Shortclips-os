import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getBoolSetting, getNumberSetting, getStringSetting, setBoolSetting, setNumberSetting, setStringSetting } from "@/server/app-settings";
import { parseHHMM } from "@/lib/ops-control/plan";

/**
 * Instellingen van de operationele controle (app_settings). Alles heeft een
 * veilige standaard, zodat de controle ook zonder instellingen goed draait.
 */
export type OpsControlSettings = {
  enabled: boolean;
  morning: string;
  /** Stille tussencontrole: werkt punten en taken bij, stuurt geen meldingen. */
  midday: string;
  afternoon: string;
  /** Tijd die in de taak als deadline voor "vandaag" staat. */
  dueTime: string;
  /** Leeg = automatisch (operationeel beheerder, anders Milou). */
  leadUserId: string;
  /** Leeg = automatisch (Rutger). Krijgt escalaties over punten van de operationeel verantwoordelijke zelf. */
  backupUserId: string;
  /** Werkdagen dat een geëscaleerd klantpunt openstaat vóór Jarno het ziet. */
  jarnoAfterWorkdays: number;
};

const K = {
  enabled: "opscontrol.enabled",
  morning: "opscontrol.morning",
  midday: "opscontrol.midday",
  afternoon: "opscontrol.afternoon",
  dueTime: "opscontrol.dueTime",
  leadUserId: "opscontrol.leadUserId",
  backupUserId: "opscontrol.backupUserId",
  jarnoAfterWorkdays: "opscontrol.jarnoAfterWorkdays",
} as const;

export const OPS_DEFAULTS: OpsControlSettings = {
  enabled: true, morning: "08:45", midday: "13:30", afternoon: "15:30", dueTime: "16:00",
  leadUserId: "", backupUserId: "", jarnoAfterWorkdays: 3,
};

export async function getOpsSettings(): Promise<OpsControlSettings> {
  const [enabled, morning, midday, afternoon, dueTime, leadUserId, backupUserId, jarnoAfterWorkdays] = await Promise.all([
    getBoolSetting(K.enabled, OPS_DEFAULTS.enabled),
    getStringSetting(K.morning, OPS_DEFAULTS.morning),
    getStringSetting(K.midday, OPS_DEFAULTS.midday),
    getStringSetting(K.afternoon, OPS_DEFAULTS.afternoon),
    getStringSetting(K.dueTime, OPS_DEFAULTS.dueTime),
    getStringSetting(K.leadUserId, ""),
    getStringSetting(K.backupUserId, ""),
    getNumberSetting(K.jarnoAfterWorkdays, OPS_DEFAULTS.jarnoAfterWorkdays),
  ]);
  return {
    enabled,
    morning: parseHHMM(morning) != null ? morning : OPS_DEFAULTS.morning,
    midday: parseHHMM(midday) != null ? midday : OPS_DEFAULTS.midday,
    afternoon: parseHHMM(afternoon) != null ? afternoon : OPS_DEFAULTS.afternoon,
    dueTime: parseHHMM(dueTime) != null ? dueTime : OPS_DEFAULTS.dueTime,
    leadUserId, backupUserId,
    jarnoAfterWorkdays: Math.min(20, Math.max(1, Math.round(jarnoAfterWorkdays))),
  };
}

export async function saveOpsSettings(s: OpsControlSettings, updatedById: string): Promise<void> {
  for (const t of [s.morning, s.midday, s.afternoon, s.dueTime]) {
    if (parseHHMM(t) == null) throw new Error(`Ongeldige tijd: ${t}`);
  }
  if (!((parseHHMM(s.morning) ?? 0) < (parseHHMM(s.midday) ?? 0) && (parseHHMM(s.midday) ?? 0) < (parseHHMM(s.afternoon) ?? 0))) {
    throw new Error("De tijden moeten oplopen: ochtend, dan de stille tussencontrole, dan de middagcontrole.");
  }
  const o = { category: "operationele-controle", updatedById };
  await setBoolSetting(K.enabled, s.enabled, o);
  await setStringSetting(K.morning, s.morning, o);
  await setStringSetting(K.midday, s.midday, o);
  await setStringSetting(K.afternoon, s.afternoon, o);
  await setStringSetting(K.dueTime, s.dueTime, o);
  await setStringSetting(K.leadUserId, s.leadUserId, o);
  await setStringSetting(K.backupUserId, s.backupUserId, o);
  await setNumberSetting(K.jarnoAfterWorkdays, s.jarnoAfterWorkdays, o);
}

async function activeIdByEmail(email: string): Promise<string | null> {
  const [u] = await db.select({ id: users.id }).from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt), eq(users.status, "active"))).limit(1);
  return u?.id ?? null;
}

async function activeId(id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [u] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt), eq(users.status, "active"))).limit(1);
  return u?.id ?? null;
}

export type EscalationPeople = { leadId: string | null; backupId: string | null; jarnoId: string | null };

/** Wie is operationeel verantwoordelijke, vervanger en Jarno? */
export async function resolveEscalationPeople(s?: OpsControlSettings): Promise<EscalationPeople> {
  const settings = s ?? (await getOpsSettings());
  let leadId = settings.leadUserId ? await activeId(settings.leadUserId) : null;
  if (!leadId) {
    const [om] = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.primaryRole, "operational_manager"), isNull(users.deletedAt), eq(users.status, "active"))).limit(1);
    leadId = om?.id ?? (await activeIdByEmail("milou@shortclips.nl"));
  }
  let backupId = settings.backupUserId ? await activeId(settings.backupUserId) : null;
  if (!backupId) backupId = await activeIdByEmail("rutger@shortclips.nl");
  const jarnoId = (await activeIdByEmail("jarno@shortclips.nl")) ?? (await ownerId());
  return { leadId, backupId: backupId === leadId ? null : backupId, jarnoId };
}

async function ownerId(): Promise<string | null> {
  const [u] = await db.select({ id: users.id }).from(users)
    .where(and(inArray(users.primaryRole, ["owner"]), isNull(users.deletedAt))).limit(1);
  return u?.id ?? null;
}
