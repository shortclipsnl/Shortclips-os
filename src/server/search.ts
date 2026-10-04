import "server-only";
import {
  and,
  eq,
  ilike,
  isNull,
  or,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  clientContacts,
  clientKnowledge,
  clients,
  contentCalendar,
  deliverables,
  files,
  invoices,
  productionDays,
  reviewComments,
  reviewThreads,
  scripts,
  tasks,
} from "@/db/schema";
import { scopeToClients, type Viewer } from "@/server/auth/context";

export type SearchHit = {
  kind: string;
  kindLabel: string;
  title: string;
  subtitle?: string | null;
  href: string;
  clientName?: string | null;
};

const LIMIT_PER_KIND = 5;

/**
 * Universele zoekfunctie over alle domeinen.
 *
 * Elke deelquery wordt begrensd door `scopeToClients`, zodat zoeken nooit een
 * achterdeur wordt naar klanten waar iemand geen toegang toe heeft.
 */
export async function universalSearch(
  viewer: Viewer,
  rawQuery: string,
): Promise<SearchHit[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;

  const scope = (col: Parameters<typeof scopeToClients>[1]) =>
    scopeToClients(viewer, col);

  const [
    clientHits,
    contactHits,
    scriptHits,
    videoHits,
    dayHits,
    fileHits,
    taskHits,
    commentHits,
    knowledgeHits,
    calendarHits,
    invoiceHits,
  ] = await Promise.all([
    db
      .select({ id: clients.id, slug: clients.slug, name: clients.name, sector: clients.sector })
      .from(clients)
      .where(and(isNull(clients.deletedAt), or(ilike(clients.name, like), ilike(clients.sector, like)), scope(clients.id)))
      .limit(LIMIT_PER_KIND),

    db
      .select({ id: clientContacts.id, name: clientContacts.fullName, role: clientContacts.role, clientId: clientContacts.clientId, clientName: clients.name, slug: clients.slug })
      .from(clientContacts)
      .innerJoin(clients, eq(clients.id, clientContacts.clientId))
      .where(and(isNull(clientContacts.deletedAt), or(ilike(clientContacts.fullName, like), ilike(clientContacts.email, like)), scope(clientContacts.clientId)))
      .limit(LIMIT_PER_KIND),

    db
      .select({ id: scripts.id, title: scripts.title, status: scripts.status, clientName: clients.name })
      .from(scripts)
      .innerJoin(clients, eq(clients.id, scripts.clientId))
      .where(and(isNull(scripts.deletedAt), or(ilike(scripts.title, like), ilike(scripts.hook, like), ilike(scripts.body, like)), scope(scripts.clientId)))
      .limit(LIMIT_PER_KIND),

    db
      .select({ id: deliverables.id, title: deliverables.title, status: deliverables.status, clientName: clients.name })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(and(isNull(deliverables.deletedAt), ilike(deliverables.title, like), scope(deliverables.clientId)))
      .limit(LIMIT_PER_KIND),

    db
      .select({ id: productionDays.id, title: productionDays.title, scheduledOn: productionDays.scheduledOn, clientName: clients.name })
      .from(productionDays)
      .innerJoin(clients, eq(clients.id, productionDays.clientId))
      .where(and(isNull(productionDays.deletedAt), or(ilike(productionDays.title, like), ilike(productionDays.locationName, like)), scope(productionDays.clientId)))
      .limit(LIMIT_PER_KIND),

    db
      .select({ id: files.id, name: files.name, category: files.category, url: files.externalUrl, clientName: clients.name })
      .from(files)
      .leftJoin(clients, eq(clients.id, files.clientId))
      .where(and(isNull(files.deletedAt), eq(files.isFolder, false), ilike(files.name, like), scope(files.clientId)))
      .limit(LIMIT_PER_KIND),

    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, clientName: clients.name })
      .from(tasks)
      .leftJoin(clients, eq(clients.id, tasks.clientId))
      .where(and(isNull(tasks.deletedAt), ilike(tasks.title, like), scope(tasks.clientId)))
      .limit(LIMIT_PER_KIND),

    // Interne opmerkingen alleen voor wie die mag lezen.
    viewer.permissions.has("comments:read_internal")
      ? db
          .select({ id: reviewComments.id, body: reviewComments.body, deliverableId: reviewThreads.deliverableId, clientName: clients.name })
          .from(reviewComments)
          .innerJoin(reviewThreads, eq(reviewThreads.id, reviewComments.threadId))
          .innerJoin(deliverables, eq(deliverables.id, reviewThreads.deliverableId))
          .innerJoin(clients, eq(clients.id, deliverables.clientId))
          .where(and(isNull(reviewComments.deletedAt), ilike(reviewComments.body, like), scope(deliverables.clientId)))
          .limit(LIMIT_PER_KIND)
      : Promise.resolve([]),

    db
      .select({ id: clientKnowledge.id, title: clientKnowledge.title, body: clientKnowledge.body, clientName: clients.name, slug: clients.slug })
      .from(clientKnowledge)
      .innerJoin(clients, eq(clients.id, clientKnowledge.clientId))
      .where(and(isNull(clientKnowledge.deletedAt), or(ilike(clientKnowledge.title, like), ilike(clientKnowledge.body, like)), scope(clientKnowledge.clientId)))
      .limit(LIMIT_PER_KIND),

    db
      .select({ id: contentCalendar.id, title: contentCalendar.title, scheduledOn: contentCalendar.scheduledOn, clientName: clients.name })
      .from(contentCalendar)
      .innerJoin(clients, eq(clients.id, contentCalendar.clientId))
      .where(and(isNull(contentCalendar.deletedAt), or(ilike(contentCalendar.title, like), ilike(contentCalendar.caption, like)), scope(contentCalendar.clientId)))
      .limit(LIMIT_PER_KIND),

    viewer.permissions.has("finance:read")
      ? db
          .select({ id: invoices.id, number: invoices.number, status: invoices.status, clientName: clients.name })
          .from(invoices)
          .innerJoin(clients, eq(clients.id, invoices.clientId))
          .where(and(isNull(invoices.deletedAt), ilike(invoices.number, like), scope(invoices.clientId)))
          .limit(LIMIT_PER_KIND)
      : Promise.resolve([]),
  ]);

  const hits: SearchHit[] = [
    ...clientHits.map((r) => ({ kind: "client", kindLabel: "Klant", title: r.name, subtitle: r.sector, href: `/clients/${r.slug}` })),
    ...contactHits.map((r) => ({ kind: "contact", kindLabel: "Contactpersoon", title: r.name, subtitle: r.role, href: `/clients/${r.slug}?tab=contacten`, clientName: r.clientName })),
    ...scriptHits.map((r) => ({ kind: "script", kindLabel: "Script", title: r.title, subtitle: r.status, href: `/scripts/${r.id}`, clientName: r.clientName })),
    ...videoHits.map((r) => ({ kind: "video", kindLabel: "Video", title: r.title, subtitle: r.status, href: `/videos/${r.id}`, clientName: r.clientName })),
    ...dayHits.map((r) => ({ kind: "production", kindLabel: "Opnamedag", title: r.title, subtitle: r.scheduledOn, href: `/productions/${r.id}`, clientName: r.clientName })),
    ...fileHits.map((r) => ({ kind: "file", kindLabel: "Bestand", title: r.name, subtitle: r.category, href: r.url ?? "#", clientName: r.clientName })),
    ...taskHits.map((r) => ({ kind: "task", kindLabel: "Taak", title: r.title, subtitle: r.status, href: `/tasks?focus=${r.id}`, clientName: r.clientName })),
    ...commentHits.map((r) => ({ kind: "comment", kindLabel: "Opmerking", title: r.body.slice(0, 90), href: `/videos/${r.deliverableId}`, clientName: r.clientName })),
    ...knowledgeHits.map((r) => ({ kind: "knowledge", kindLabel: "Klantkennis", title: r.title, subtitle: r.body.slice(0, 90), href: `/clients/${r.slug}?tab=kennis`, clientName: r.clientName })),
    ...calendarHits.map((r) => ({ kind: "calendar", kindLabel: "Planning", title: r.title, subtitle: r.scheduledOn, href: `/calendar?datum=${r.scheduledOn}`, clientName: r.clientName })),
    ...invoiceHits.map((r) => ({ kind: "invoice", kindLabel: "Factuur", title: r.number, subtitle: r.status, href: `/finance?factuur=${r.id}`, clientName: r.clientName })),
  ];

  return hits;
}
