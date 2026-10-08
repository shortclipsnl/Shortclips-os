import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  aiKnowledge,
  aiOutputs,
  clientAiProfiles,
  clientContacts,
  clients,
  deliverables,
  productionDays,
  users,
} from "@/db/schema";
import { assertClientAccess, scopeToClients, type Viewer } from "@/server/auth/context";

/* ------------------------------------------------------------------ *
 * Kennisbank & klantcontext voor de AI Tools
 * ------------------------------------------------------------------ */

export type CaptionProfile = {
  branche?: string;
  doelgroep?: string;
  toneOfVoice?: string;
  schrijfstijl?: string;
  emojiGebruik?: string;
  lengteInstagram?: string;
  lengteTiktok?: string;
  hashtagVoorkeuren?: string;
  vasteAfsluiting?: string;
  contactgegevens?: string;
  voorbeelden?: string[];
};
export type EditingProfile = { aandachtspunten?: string; voorbeelden?: string[] };
export type CommunicationProfile = { afspraken?: string; voorbeelden?: string[] };

export async function listCentralKnowledge() {
  return db
    .select({
      id: aiKnowledge.id,
      category: aiKnowledge.category,
      title: aiKnowledge.title,
      body: aiKnowledge.body,
    })
    .from(aiKnowledge)
    .where(isNull(aiKnowledge.deletedAt))
    .orderBy(asc(aiKnowledge.category), asc(aiKnowledge.title));
}

/** Centrale kennisbank als één tekstblok, optioneel gefilterd op categorieën. */
export async function centralKnowledgeText(categories?: string[]): Promise<string> {
  const rows = await listCentralKnowledge();
  const filtered = categories ? rows.filter((r) => categories.includes(r.category)) : rows;
  if (filtered.length === 0) return "";
  return filtered.map((r) => `## ${r.title} (${r.category})\n${r.body}`).join("\n\n");
}

export async function getClientAiProfile(clientId: string) {
  const [row] = await db
    .select({
      id: clientAiProfiles.id,
      captionProfile: clientAiProfiles.captionProfile,
      editingProfile: clientAiProfiles.editingProfile,
      communicationProfile: clientAiProfiles.communicationProfile,
    })
    .from(clientAiProfiles)
    .where(eq(clientAiProfiles.clientId, clientId))
    .limit(1);
  return row ?? null;
}

export function captionProfileToText(p: CaptionProfile | null | undefined): string {
  if (!p || Object.keys(p).length === 0) return "(nog geen captionprofiel ingesteld — gebruik een neutrale, professionele Shortclips-stijl.)";
  const lines: string[] = [];
  const add = (label: string, v?: string) => v && v.trim() && lines.push(`- ${label}: ${v.trim()}`);
  add("Branche", p.branche);
  add("Doelgroep", p.doelgroep);
  add("Tone of voice", p.toneOfVoice);
  add("Schrijfstijl", p.schrijfstijl);
  add("Emoji-gebruik", p.emojiGebruik);
  add("Captionlengte Instagram", p.lengteInstagram);
  add("Captionlengte TikTok", p.lengteTiktok);
  add("Hashtagvoorkeuren", p.hashtagVoorkeuren);
  add("Vaste afsluiting", p.vasteAfsluiting);
  add("Contactgegevens (alleen deze gebruiken, nooit verzinnen)", p.contactgegevens);
  if (p.voorbeelden && p.voorbeelden.length) {
    lines.push(`\nEerder goedgekeurde captions (leer de schrijfstijl hiervan, kopieer ze niet):`);
    p.voorbeelden.filter(Boolean).forEach((v, i) => lines.push(`Voorbeeld ${i + 1}:\n${v}`));
  }
  return lines.join("\n");
}

/** Live feitelijke klantcontext uit het dashboard (voor de berichtassistent). */
export async function getClientContextFacts(viewer: Viewer, clientId: string): Promise<string> {
  assertClientAccess(viewer, clientId);
  const [client] = await db
    .select({
      name: clients.name,
      quota: clients.monthlyVideoQuota,
      coordinator: users.fullName,
      startedOn: clients.startedOn,
    })
    .from(clients)
    .leftJoin(users, eq(users.id, clients.coordinatorId))
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return "";

  const [counts] = await db
    .select({
      inProduction: sql<number>`count(*) filter (where ${deliverables.status} not in ('published','analysis_available'))`,
      awaitingClient: sql<number>`count(*) filter (where ${deliverables.status} in ('client_review','client_revision'))`,
    })
    .from(deliverables)
    .where(and(eq(deliverables.clientId, clientId), isNull(deliverables.deletedAt)));

  const [shoot] = await db
    .select({ scheduledOn: productionDays.scheduledOn })
    .from(productionDays)
    .where(
      and(
        eq(productionDays.clientId, clientId),
        isNull(productionDays.deletedAt),
        sql`${productionDays.scheduledOn} >= current_date`,
        sql`${productionDays.status} <> 'cancelled'`,
      ),
    )
    .orderBy(asc(productionDays.scheduledOn))
    .limit(1);

  const [contact] = await db
    .select({ fullName: clientContacts.fullName })
    .from(clientContacts)
    .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
    .orderBy(desc(clientContacts.isPrimary))
    .limit(1);

  const facts: string[] = [`- Klant: ${client.name}`];
  if (client.coordinator) facts.push(`- Vaste contactpersoon bij Shortclips (Content Creative): ${client.coordinator}`);
  if (contact?.fullName) facts.push(`- Contactpersoon bij de klant: ${contact.fullName}`);
  facts.push(`- Afgesproken shorts per maand: ${client.quota ?? 0}`);
  facts.push(`- Video's momenteel in productie: ${Number(counts?.inProduction ?? 0)}`);
  facts.push(`- Video's die nu op klantfeedback wachten: ${Number(counts?.awaitingClient ?? 0)}`);
  facts.push(shoot?.scheduledOn ? `- Eerstvolgende geplande opname: ${shoot.scheduledOn}` : `- Geen opname gepland.`);
  return facts.join("\n");
}

/** Geschiedenis van gegenereerde output. */
export async function listAiOutputs(viewer: Viewer, tool: string, clientId?: string) {
  const conds = [isNull(aiOutputs.deletedAt), eq(aiOutputs.tool, tool), scopeToClients(viewer, aiOutputs.clientId)];
  if (clientId) conds.push(eq(aiOutputs.clientId, clientId));
  return db
    .select({
      id: aiOutputs.id,
      title: aiOutputs.title,
      output: aiOutputs.output,
      createdAt: aiOutputs.createdAt,
      clientName: clients.name,
    })
    .from(aiOutputs)
    .innerJoin(clients, eq(clients.id, aiOutputs.clientId))
    .where(and(...conds))
    .orderBy(desc(aiOutputs.createdAt))
    .limit(40);
}

/** Actieve klanten voor de keuzelijsten. */
export async function listActiveClientsForAi(viewer: Viewer) {
  return db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(isNull(clients.deletedAt), inArray(clients.status, ["active", "onboarding"]), scopeToClients(viewer, clients.id)))
    .orderBy(asc(clients.name));
}
