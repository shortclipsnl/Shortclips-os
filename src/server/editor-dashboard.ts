import "server-only";
import { and, asc, count, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clientKnowledge, clients, deliverables, files, tasks, users } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * De editoromgeving. Bewust smal: wat moet ik vandaag doen, wat is er van mij,
 * en hoe doe ik het. Geen klantoverzichten, geen omzet, geen werk van collega's.
 */
export async function getEditorDashboard(viewer: Viewer) {
  const [queue, overdue, stats, openTasks, deliveredRows, meRows] = await Promise.all([
    db
      .select({
        id: deliverables.id,
        title: deliverables.title,
        status: deliverables.status,
        statusChangedAt: deliverables.statusChangedAt,
        dueOn: deliverables.dueOn,
        briefing: deliverables.briefing,
        currentVersion: deliverables.currentVersion,
        clientRevisionRounds: deliverables.clientRevisionRounds,
        internalRevisionRounds: deliverables.internalRevisionRounds,
        clientId: deliverables.clientId,
        clientName: clients.name,
        clientSlug: clients.slug,
        clientColor: clients.color,
        clientLogo: clients.logoUrl,
        scriptId: deliverables.scriptId,
        driveFolderId: deliverables.driveFolderId,
        frameUrl: deliverables.frameUrl,
        openComments: sql<number>`(
          select count(*) from review_threads rt
          where rt.deliverable_id = deliverables.id
            and rt.is_resolved = false and rt.deleted_at is null
        )`,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .where(
        and(
          isNull(deliverables.deletedAt),
          eq(deliverables.editorId, viewer.id),
          sql`${deliverables.status} in ('editing','editor_revision','awaiting_editor','internal_review','client_revision')`,
        ),
      )
      .orderBy(asc(deliverables.dueOn), asc(deliverables.statusChangedAt)),

    db
      .select({ total: count() })
      .from(deliverables)
      .where(
        and(
          isNull(deliverables.deletedAt),
          eq(deliverables.editorId, viewer.id),
          lt(deliverables.dueOn, today()),
          sql`${deliverables.status} in ('editing','editor_revision','awaiting_editor')`,
        ),
      ),

    // Eigen prestaties. Alleen objectieve cijfers, geen oordeel.
    db.execute(sql`
      select
        count(*) filter (where status in ('published','approved','scheduled','ready_to_publish','analysis_available'))::int as opgeleverd,
        count(*) filter (where status in ('published','approved','scheduled','ready_to_publish','analysis_available') and internal_revision_rounds > 0)::int as intern_gecorrigeerd,
        count(*) filter (where status in ('editing','editor_revision'))::int as lopend,
        round(avg(internal_revision_rounds)::numeric, 2) as gem_intern,
        round(avg(client_revision_rounds)::numeric, 2) as gem_klant,
        count(*) filter (
          where published_at is not null and due_on is not null and published_at::date <= due_on
        )::int as op_tijd,
        count(*) filter (where published_at is not null and due_on is not null)::int as met_deadline
      from deliverables
      where editor_id = ${viewer.id} and deleted_at is null
    `),

    db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueOn: tasks.dueOn,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          eq(tasks.assigneeId, viewer.id),
          sql`${tasks.status} in ('todo','in_progress','blocked')`,
        ),
      )
      .orderBy(asc(tasks.dueOn))
      .limit(10),

    // Maandoverzicht van opgeleverde projecten (deze + vorige 2 maanden), zodat
    // duidelijk is wat er per maand is afgerond. "Opgeleverd" = de video is
    // goedgekeurd/ingepland/gepubliceerd; de datum is publicatiedatum of anders
    // de laatste statuswijziging.
    db.execute(sql`
      select to_char((coalesce(d.published_at, d.status_changed_at)) at time zone 'Europe/Amsterdam', 'YYYY-MM') as maand,
             d.id, d.title, c.name as client_name, c.slug as client_slug, c.color as client_color, c.logo_url as client_logo,
             coalesce(d.published_at, d.status_changed_at) as op
      from deliverables d
      join clients c on c.id = d.client_id
      where d.editor_id = ${viewer.id} and d.deleted_at is null
        and d.status in ('approved','ready_to_publish','scheduled','published','analysis_available')
        and coalesce(d.published_at, d.status_changed_at) >= date_trunc('month', now() at time zone 'Europe/Amsterdam') - interval '2 months'
      order by op desc
      limit 200
    `),

    db.select({ note: users.availabilityNote }).from(users).where(eq(users.id, viewer.id)).limit(1),
  ]);

  // Huisstijl & referenties per klant waar de editor werk voor heeft (§5):
  // Drive-map "Branding" + klantkennis over stijl/tone-of-voice. Alleen bestaande
  // data; leeg blok wordt niet getoond.
  const clientIds = [...new Set(queue.map((q) => q.clientId))];
  const [brandFiles, styleNotes] = clientIds.length
    ? await Promise.all([
        db
          .select({ clientId: files.clientId, name: files.name, url: files.externalUrl })
          .from(files)
          .where(and(isNull(files.deletedAt), eq(files.isFolder, false), eq(files.category, "Branding"), inArray(files.clientId, clientIds)))
          .limit(40),
        db
          .select({ clientId: clientKnowledge.clientId, title: clientKnowledge.title, body: clientKnowledge.body, category: clientKnowledge.category })
          .from(clientKnowledge)
          .where(and(isNull(clientKnowledge.deletedAt), inArray(clientKnowledge.category, ["editing_style", "tone_of_voice", "hook_style", "branding"]), inArray(clientKnowledge.clientId, clientIds)))
          .limit(40),
      ])
    : [[], []];

  const brandingByClient = new Map<string, { clientId: string; clientName: string; clientSlug: string; files: { name: string; url: string | null }[]; notes: { title: string; body: string }[] }>();
  const clientMeta = new Map(queue.map((q) => [q.clientId, { name: q.clientName, slug: q.clientSlug }]));
  const ensure = (cid: string) => {
    let b = brandingByClient.get(cid);
    if (!b) {
      const m = clientMeta.get(cid);
      b = { clientId: cid, clientName: m?.name ?? "Klant", clientSlug: m?.slug ?? "", files: [], notes: [] };
      brandingByClient.set(cid, b);
    }
    return b;
  };
  for (const f of brandFiles) if (f.clientId) ensure(f.clientId).files.push({ name: f.name, url: f.url });
  for (const n of styleNotes) if (n.clientId) ensure(n.clientId).notes.push({ title: n.title, body: n.body });
  const branding = [...brandingByClient.values()].filter((b) => b.files.length > 0 || b.notes.length > 0);

  const row =
    ((stats as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
      (stats as unknown as Array<Record<string, unknown>>))[0] ?? {};

  const onTime = Number(row.op_tijd ?? 0);
  const withDeadline = Number(row.met_deadline ?? 0);
  const delivered = Number(row.opgeleverd ?? 0);
  const internCorrected = Number(row.intern_gecorrigeerd ?? 0);

  // Opgeleverde projecten per maand groeperen (meest recente maand eerst).
  type DeliveredItem = { id: string; title: string; clientName: string; clientSlug: string; clientColor: string | null; clientLogo: string | null; op: string };
  const deliveredRaw =
    ((deliveredRows as unknown as { rows?: Array<Record<string, unknown>> }).rows ??
      (deliveredRows as unknown as Array<Record<string, unknown>>)) ?? [];
  const monthMap = new Map<string, DeliveredItem[]>();
  for (const r of deliveredRaw) {
    const maand = String(r.maand ?? "");
    if (!maand) continue;
    const list = monthMap.get(maand) ?? [];
    list.push({
      id: String(r.id),
      title: String(r.title),
      clientName: String(r.client_name ?? ""),
      clientSlug: String(r.client_slug ?? ""),
      clientColor: (r.client_color as string | null) ?? null,
      clientLogo: (r.client_logo as string | null) ?? null,
      op: r.op instanceof Date ? r.op.toISOString() : String(r.op ?? ""),
    });
    monthMap.set(maand, list);
  }
  const deliveredByMonth = [...monthMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, items]) => ({ month, count: items.length, items }));

  return {
    queue,
    overdue: Number(overdue[0]?.total ?? 0),
    tasks: openTasks,
    branding,
    deliveredByMonth,
    availabilityNote: meRows[0]?.note ?? null,
    stats: {
      delivered,
      inProgress: Number(row.lopend ?? 0),
      avgInternalRevisions: row.gem_intern ? Number(row.gem_intern) : null,
      avgClientRevisions: row.gem_klant ? Number(row.gem_klant) : null,
      onTimeRate: withDeadline > 0 ? (onTime / withDeadline) * 100 : null,
      withDeadline,
      // Aandeel opgeleverde video's dat een interne correctie nodig had (doel < 5%).
      internalCorrectionRate: delivered > 0 ? (internCorrected / delivered) * 100 : null,
    },
  };
}
