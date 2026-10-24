import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  developmentPoints,
  developmentSnapshots,
  kbCourses,
  kbLessons,
  users,
} from "@/db/schema";
import { requireInternal, isOwner, can, type Viewer } from "@/server/auth/context";
import { aiConfigured, runJsonPrompt } from "@/server/ai/client";

/* ------------------------------------------------------------------ helpers */

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];
const n = (v: unknown) => Number(v ?? 0);
const today = () => new Date().toISOString().slice(0, 10);

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Leidinggevende = mag ontwikkelpunten van anderen zien.
 * (eigenaar, projectcoördinator, of expliciet team/editors-rechten).
 */
export function canSeeTeamDevelopment(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return (
    isOwner(viewer) ||
    viewer.primaryRole === "project_coordinator" ||
    can(viewer, "team:read") ||
    can(viewer, "editors:read")
  );
}

/** Leidinggevende die ontwikkelpunten mag beoordelen/aanpassen. */
export function canReviewDevelopment(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return (
    isOwner(viewer) ||
    viewer.primaryRole === "project_coordinator" ||
    can(viewer, "team:write") ||
    can(viewer, "editors:write")
  );
}

/** Of de kijker de ontwikkelpunten van deze medewerker mag inzien. */
export function canViewUserDevelopment(viewer: Viewer, userId: string): boolean {
  return viewer.id === userId || canSeeTeamDevelopment(viewer);
}

/* ------------------------------------------------------------------ metrics */

export type DevMetrics = {
  opgeleverd: number;
  lopend: number;
  gemIntern: number | null;
  gemKlant: number | null;
  internalCorrectionRate: number | null; // % opgeleverd met interne revisie
  onTimeRate: number | null; // % op tijd opgeleverd
  metDeadline: number;
  interneFeedback: number; // interne review-opmerkingen op eigen video's (laatste periode)
  klantFeedback: number;
  deadlineMissesOpen: number;
  deadlineMissesTotaal: number;
  lessonsDone: number;
  sampleSize: number; // opgeleverde video's in de periode (basis voor betrouwbaarheid)
};

/**
 * Objectieve kerncijfers per medewerker uit de bestaande bronnen (deliverables,
 * review-opmerkingen, deadlinemissers, kennisbankvoortgang). Geen oordeel, alleen
 * cijfers — de basis voor zowel de weergave, het verloop als de AI-analyse.
 */
export async function getUserMetrics(userId: string, days = 90): Promise<DevMetrics> {
  const since = sql`current_date - ${`${days} days`}::interval`;
  const [delRes, revRes, dmRes, kbRes] = await Promise.all([
    db.execute(sql`
      select
        count(*) filter (where status in ('published','approved','scheduled','ready_to_publish','analysis_available'))::int as opgeleverd,
        count(*) filter (where status in ('editing','editor_revision'))::int as lopend,
        count(*) filter (where status in ('published','approved','scheduled','ready_to_publish','analysis_available') and internal_revision_rounds > 0)::int as intern_gecorrigeerd,
        round(avg(internal_revision_rounds)::numeric, 2) as gem_intern,
        round(avg(client_revision_rounds)::numeric, 2) as gem_klant,
        count(*) filter (where published_at is not null and due_on is not null and published_at::date <= due_on)::int as op_tijd,
        count(*) filter (where published_at is not null and due_on is not null)::int as met_deadline
      from deliverables
      where editor_id = ${userId} and deleted_at is null
    `),
    db.execute(sql`
      select
        count(*) filter (where rt.visibility = 'internal')::int as intern,
        count(*) filter (where rt.visibility = 'client')::int as klant
      from review_comments rc
      join review_threads rt on rt.id = rc.thread_id and rt.deleted_at is null
      join deliverables d on d.id = rt.deliverable_id
      where d.editor_id = ${userId} and rc.deleted_at is null
        and rc.author_user_id is distinct from ${userId}
        and rc.created_at >= ${since}
    `),
    db.execute(sql`
      select
        count(*) filter (where resolved = false)::int as open,
        count(*)::int as totaal
      from deadline_misses
      where responsible_user_id = ${userId}
    `),
    db.execute(sql`
      select count(*)::int as done
      from kb_progress
      where user_id = ${userId} and completed_at is not null
    `),
  ]);

  const d = rows<Record<string, unknown>>(delRes)[0] ?? {};
  const rev = rows<Record<string, unknown>>(revRes)[0] ?? {};
  const dm = rows<Record<string, unknown>>(dmRes)[0] ?? {};
  const kb = rows<Record<string, unknown>>(kbRes)[0] ?? {};

  const opgeleverd = n(d.opgeleverd);
  const internGecorrigeerd = n(d.intern_gecorrigeerd);
  const metDeadline = n(d.met_deadline);
  const opTijd = n(d.op_tijd);

  return {
    opgeleverd,
    lopend: n(d.lopend),
    gemIntern: d.gem_intern != null ? Number(d.gem_intern) : null,
    gemKlant: d.gem_klant != null ? Number(d.gem_klant) : null,
    internalCorrectionRate: opgeleverd > 0 ? Math.round((internGecorrigeerd / opgeleverd) * 1000) / 10 : null,
    onTimeRate: metDeadline > 0 ? Math.round((opTijd / metDeadline) * 1000) / 10 : null,
    metDeadline,
    interneFeedback: n(rev.intern),
    klantFeedback: n(rev.klant),
    deadlineMissesOpen: n(dm.open),
    deadlineMissesTotaal: n(dm.totaal),
    lessonsDone: n(kb.done),
    sampleSize: opgeleverd,
  };
}

/* ------------------------------------------------------------- AI-analyse */

type ZekerheidLabel = "bewezen" | "waarschijnlijk" | "hypothese";
type DevType = "fout" | "vaardigheid" | "feedback";

type AiPoint = {
  type: DevType;
  category: string;
  thema: string;
  title: string;
  description: string;
  advies: string;
  zekerheid: ZekerheidLabel;
  trainingZoekterm?: string;
};

const SYSTEM = `Je bent een rustige, eerlijke teamcoach bij Shortclips (een short-video bureau). Je analyseert hoe één MEDEWERKER (meestal een editor) presteert, uitsluitend op basis van de meegeleverde cijfers en feedback, en benoemt concrete ontwikkelpunten.

Strikte regels:
- Baseer ALLES uitsluitend op de meegeleverde gegevens. Verzin niets en noem nooit cijfers die er niet staan.
- Trek GEEN conclusies als er te weinig gegevens zijn; markeer onzekere punten als "hypothese".
- Maak scherp onderscheid in "type":
  - "fout" = een daadwerkelijke, herhaalde fout die uit de cijfers blijkt (bv. structureel veel interne revisierondes of gemiste deadlines).
  - "vaardigheid" = een te ontwikkelen vaardigheid of groeipunt.
  - "feedback" = persoonlijke/gedragsmatige feedback (samenwerking, communicatie).
  - KLANTVOORKEUREN (wat een specifieke klant mooi vindt) zijn NOOIT een fout van de medewerker; benoem die hooguit als vaardigheid ("leren inspelen op klantvoorkeuren"), nooit als fout.
- Label elk punt met zekerheid: "bewezen" (volgt direct uit de cijfers), "waarschijnlijk" of "hypothese".
- Geef per punt een concreet, vriendelijk advies om te verbeteren, en waar passend een korte "trainingZoekterm" (een onderwerp om in de interne kennisbank op te zoeken, bv. "kleurcorrectie" of "deadlines plannen").
- Geef 2 tot 5 punten. Als de cijfers juist goed zijn, mag je ook benoemen wat goed gaat als "vaardigheid" met zekerheid "bewezen".
- Schrijf in het Nederlands, kort en opbouwend. Geen hard oordeel.

JSON-opmaak (STRIKT, anders onbruikbaar):
- Antwoord met UITSLUITEND één geldig JSON-object, zonder tekst eromheen en zonder markdown.
- Gebruik binnen tekstwaarden GEEN dubbele aanhalingstekens; gebruik indien nodig enkele.
- Geen letterlijke regeleinden binnen waarden en geen trailing komma's.
- Exact dit formaat:
{"punten":[{"type":"fout|vaardigheid|feedback","category":"kwaliteit|deadlines|feedback|techniek|samenwerking","thema":"korte-kebab-sleutel","title":"...","description":"...","advies":"...","zekerheid":"bewezen|waarschijnlijk|hypothese","trainingZoekterm":"..."}]}`;

/** Voldoende gegevens om überhaupt iets zinnigs te zeggen? */
function hasEnoughData(m: DevMetrics): boolean {
  return (
    m.sampleSize >= 3 ||
    m.interneFeedback >= 3 ||
    m.klantFeedback >= 3 ||
    m.deadlineMissesTotaal >= 1 ||
    (m.gemKlant != null && m.gemKlant >= 1)
  );
}

export type GenerateResult =
  | { ok: true; count: number }
  | { ok: false; reason: "no_provider" | "no_data" | "error" | "forbidden"; message?: string };

/**
 * Bouwt de AI-ontwikkelanalyse voor één medewerker uit de echte cijfers en zet
 * de punten om in `development_points`. Bestaande punten blijven behouden:
 * - door een leidinggevende afgehandelde punten (resolved/dismissed) worden
 *   gerespecteerd en niet heropend;
 * - nog open punten worden bijgewerkt met de nieuwste onderbouwing;
 * - nieuwe thema's komen erbij.
 *
 * `trusted` = aangeroepen vanuit een vertrouwde server-job zonder sessie.
 */
export async function generateUserDevelopment(
  userId: string,
  trusted = false,
  createdById: string | null = null,
): Promise<GenerateResult> {
  if (!trusted) {
    const viewer = await requireInternal();
    if (viewer.id !== userId && !canReviewDevelopment(viewer)) {
      return { ok: false, reason: "forbidden", message: "Geen toegang." };
    }
    createdById = viewer.id;
  }
  if (!aiConfigured()) return { ok: false, reason: "no_provider" };

  const [u] = await db
    .select({ id: users.id, fullName: users.fullName, role: users.primaryRole })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!u) return { ok: false, reason: "error", message: "Medewerker niet gevonden." };

  const metrics = await getUserMetrics(userId, 90);
  if (!hasEnoughData(metrics)) {
    return { ok: false, reason: "no_data", message: "Nog te weinig gegevens voor een betrouwbare analyse." };
  }

  // Concrete voorbeelden: video's met de meeste interne revisierondes (bron van
  // mogelijke terugkerende fouten) en recente interne feedbackregels.
  const [topRevRes, recentFbRes] = await Promise.all([
    db.execute(sql`
      select title, internal_revision_rounds as intern, client_revision_rounds as klant
      from deliverables
      where editor_id = ${userId} and deleted_at is null and internal_revision_rounds > 0
      order by internal_revision_rounds desc, client_revision_rounds desc
      limit 8
    `),
    db.execute(sql`
      select left(rc.body, 240) as body
      from review_comments rc
      join review_threads rt on rt.id = rc.thread_id and rt.deleted_at is null and rt.visibility = 'internal'
      join deliverables d on d.id = rt.deliverable_id
      where d.editor_id = ${userId} and rc.deleted_at is null
        and rc.author_user_id is distinct from ${userId}
      order by rc.created_at desc
      limit 12
    `),
  ]);

  const dataBlock = {
    medewerker: u.fullName,
    rol: u.role,
    periodeDagen: 90,
    cijfers: metrics,
    videosMetMeesteInterneRevisies: rows<Record<string, unknown>>(topRevRes).map((r) => ({
      titel: r.title,
      interneRevisies: n(r.intern),
      klantRevisies: n(r.klant),
    })),
    recenteInterneFeedback: rows<{ body: string }>(recentFbRes).map((r) => r.body).filter(Boolean),
  };

  const res = await runJsonPrompt<{ punten: AiPoint[] }>({
    system: SYSTEM,
    user: `Analyseer deze medewerker en geef ontwikkelpunten. Gegevens (JSON):\n${JSON.stringify(dataBlock)}`,
    maxTokens: 6000,
  });
  if (!res.ok) return { ok: false, reason: res.reason === "no_provider" ? "no_provider" : "error", message: res.error };

  const punten = Array.isArray(res.data?.punten) ? res.data.punten : [];
  if (punten.length === 0) {
    return { ok: false, reason: "error", message: "De analyse leverde geen bruikbare punten op. Probeer het opnieuw." };
  }

  const evidenceBase = { bron: "ai", periodeDagen: 90, cijfers: metrics };
  let count = 0;

  for (const p of punten) {
    const type: DevType = p.type === "fout" || p.type === "feedback" ? p.type : "vaardigheid";
    const zekerheid: ZekerheidLabel =
      p.zekerheid === "bewezen" || p.zekerheid === "hypothese" ? p.zekerheid : "waarschijnlijk";
    const title = String(p.title ?? "").trim().slice(0, 240);
    if (!title) continue;
    const dedupeKey = `ai:${userId}:${slug(p.thema || title)}`.slice(0, 180);

    // Bestaand punt met deze sleutel? Respecteer een afgehandeld oordeel.
    const [existing] = await db
      .select({ id: developmentPoints.id, status: developmentPoints.status })
      .from(developmentPoints)
      .where(and(eq(developmentPoints.dedupeKey, dedupeKey), isNull(developmentPoints.deletedAt)))
      .limit(1);
    if (existing && (existing.status === "resolved" || existing.status === "dismissed")) continue;

    // Best-effort trainingkoppeling op de zoekterm.
    const training = p.trainingZoekterm ? await findTraining(p.trainingZoekterm) : null;

    const values = {
      type,
      category: String(p.category ?? "kwaliteit").slice(0, 40),
      title,
      description: String(p.description ?? "").trim(),
      advies: String(p.advies ?? "").trim(),
      zekerheid,
      source: "ai" as const,
      evidence: evidenceBase as unknown as Record<string, unknown>,
      kbCourseId: training?.courseId ?? null,
      kbLessonId: training?.lessonId ?? null,
    };

    if (existing) {
      await db
        .update(developmentPoints)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(developmentPoints.id, existing.id));
    } else {
      await db.insert(developmentPoints).values({
        userId,
        ...values,
        dedupeKey,
        createdById,
      });
    }
    count++;
  }

  return { ok: true, count };
}

/** Zoekt een passende les in de kennisbank op een zoekterm (titel of inhoud). */
async function findTraining(term: string): Promise<{ lessonId: string; courseId: string } | null> {
  const q = term.trim();
  if (q.length < 3) return null;
  const like = `%${q}%`;
  const [lesson] = await db
    .select({ id: kbLessons.id, courseId: kbLessons.courseId })
    .from(kbLessons)
    .where(
      and(
        isNull(kbLessons.deletedAt),
        eq(kbLessons.isPublished, true),
        or(sql`${kbLessons.title} ilike ${like}`, sql`${kbLessons.contentText} ilike ${like}`),
      ),
    )
    .limit(1);
  return lesson ? { lessonId: lesson.id, courseId: lesson.courseId } : null;
}

/* ----------------------------------------------------------------- getters */

export type DevPointRow = {
  id: string;
  type: string;
  category: string;
  title: string;
  description: string;
  advies: string;
  zekerheid: string;
  status: string;
  source: string;
  kbLessonId: string | null;
  kbCourseId: string | null;
  lessonTitle: string | null;
  courseTitle: string | null;
  reviewedById: string | null;
  createdAt: Date;
};

/** Alle ontwikkelpunten van een medewerker, met gekoppelde trainingstitels. */
export async function getUserPoints(userId: string): Promise<DevPointRow[]> {
  const list = await db
    .select({
      id: developmentPoints.id,
      type: developmentPoints.type,
      category: developmentPoints.category,
      title: developmentPoints.title,
      description: developmentPoints.description,
      advies: developmentPoints.advies,
      zekerheid: developmentPoints.zekerheid,
      status: developmentPoints.status,
      source: developmentPoints.source,
      kbLessonId: developmentPoints.kbLessonId,
      kbCourseId: developmentPoints.kbCourseId,
      lessonTitle: kbLessons.title,
      courseTitle: kbCourses.title,
      reviewedById: developmentPoints.reviewedById,
      createdAt: developmentPoints.createdAt,
    })
    .from(developmentPoints)
    .leftJoin(kbLessons, eq(kbLessons.id, developmentPoints.kbLessonId))
    .leftJoin(kbCourses, eq(kbCourses.id, developmentPoints.kbCourseId))
    .where(and(eq(developmentPoints.userId, userId), isNull(developmentPoints.deletedAt)))
    .orderBy(desc(developmentPoints.createdAt));
  return list as DevPointRow[];
}

/** Verloop: laatste snapshots (oplopend op datum) voor de grafiek. */
export async function getUserTrend(userId: string, limit = 12) {
  const snaps = await db
    .select({ snapshotOn: developmentSnapshots.snapshotOn, metrics: developmentSnapshots.metrics })
    .from(developmentSnapshots)
    .where(eq(developmentSnapshots.userId, userId))
    .orderBy(desc(developmentSnapshots.snapshotOn))
    .limit(limit);
  return snaps.reverse();
}

/** Teamoverzicht voor leidinggevenden: per medewerker de openstaande punten. */
export async function listTeamDevelopment() {
  const people = await db
    .select({ id: users.id, fullName: users.fullName, role: users.primaryRole, avatarUrl: users.avatarUrl })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.status, "active"),
        sql`${users.primaryRole} <> 'client'`,
      ),
    )
    .orderBy(users.fullName);
  if (people.length === 0) return [];

  const ids = people.map((p) => p.id);
  const counts = await db.execute(sql`
    select user_id as "userId",
      count(*) filter (where status in ('open','in_progress'))::int as open_punten,
      count(*) filter (where status in ('open','in_progress') and type = 'fout')::int as open_fouten,
      max(created_at) as laatste
    from development_points
    where user_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      and deleted_at is null
    group by user_id
  `);
  const byUser = new Map<string, { openPunten: number; openFouten: number; laatste: Date | null }>();
  for (const r of rows<Record<string, unknown>>(counts)) {
    byUser.set(String(r.userId), {
      openPunten: n(r.open_punten),
      openFouten: n(r.open_fouten),
      laatste: r.laatste ? new Date(r.laatste as string) : null,
    });
  }

  return people.map((p) => ({
    ...p,
    openPunten: byUser.get(p.id)?.openPunten ?? 0,
    openFouten: byUser.get(p.id)?.openFouten ?? 0,
    laatsteAnalyse: byUser.get(p.id)?.laatste ?? null,
  }));
}

/* -------------------------------------------------------------------- jobs */

/** Actieve interne medewerkers (geen klantaccounts). */
async function activeInternalUserIds(): Promise<string[]> {
  const list = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNull(users.deletedAt), eq(users.status, "active"), sql`${users.primaryRole} <> 'client'`));
  return list.map((u) => u.id);
}

/**
 * Nachtelijke momentopname van de kerncijfers per medewerker (voor het verloop).
 * Idempotent: één rij per medewerker per dag (upsert).
 */
export async function snapshotDevelopmentMetrics(): Promise<{ users: number }> {
  const ids = await activeInternalUserIds();
  const day = today();
  for (const userId of ids) {
    const m = await getUserMetrics(userId, 90);
    const [cnt] = await db
      .select({
        open: sql<number>`count(*) filter (where status in ('open','in_progress'))::int`,
        openFout: sql<number>`count(*) filter (where status in ('open','in_progress') and type = 'fout')::int`,
        resolved: sql<number>`count(*) filter (where status = 'resolved')::int`,
      })
      .from(developmentPoints)
      .where(and(eq(developmentPoints.userId, userId), isNull(developmentPoints.deletedAt)));

    const metrics = {
      opgeleverd: m.opgeleverd,
      internalCorrectionRate: m.internalCorrectionRate,
      onTimeRate: m.onTimeRate,
      gemIntern: m.gemIntern,
      gemKlant: m.gemKlant,
      openFouten: cnt?.openFout ?? 0,
      openPunten: cnt?.open ?? 0,
      resolvedPunten: cnt?.resolved ?? 0,
      deadlineMissesOpen: m.deadlineMissesOpen,
      lessonsDone: m.lessonsDone,
    };

    await db
      .insert(developmentSnapshots)
      .values({ userId, snapshotOn: day, metrics: metrics as unknown as Record<string, unknown> })
      .onConflictDoUpdate({
        target: [developmentSnapshots.userId, developmentSnapshots.snapshotOn],
        set: { metrics: metrics as unknown as Record<string, unknown> },
      });
  }
  return { users: ids.length };
}

/**
 * Maandelijkse AI-ontwikkelanalyse: genereert per medewerker met voldoende
 * gegevens één keer per maand verse ontwikkelpunten. Idempotent via de dedup op
 * de punten zelf; draait alleen als er een AI-sleutel is.
 */
export async function generateMonthlyDevelopment(): Promise<{ users: number; generated: number }> {
  if (!aiConfigured()) return { users: 0, generated: 0 };
  const ids = await activeInternalUserIds();
  const period = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
  let generated = 0;
  for (const userId of ids) {
    // Deze maand al een AI-punt gegenereerd? Dan overslaan.
    const [fresh] = await db
      .select({ id: developmentPoints.id })
      .from(developmentPoints)
      .where(
        and(
          eq(developmentPoints.userId, userId),
          eq(developmentPoints.source, "ai"),
          isNull(developmentPoints.deletedAt),
          sql`to_char(${developmentPoints.createdAt}, 'YYYY-MM') = ${period}`,
        ),
      )
      .limit(1);
    if (fresh) continue;
    const res = await generateUserDevelopment(userId, true).catch(() => null);
    if (res && res.ok) generated++;
  }
  return { users: ids.length, generated };
}
