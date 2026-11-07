import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { files, shootScriptSources } from "@/db/schema";
import {
  decideBestMatch,
  scoreScriptFileForShoot,
  type ScoreFile,
  type ShootCandidate,
} from "./drive-script-score";

export type { MatchConfidence, ScoreFile, ScoreInput, ScoreResult, ShootCandidate } from "./drive-script-score";
export { dateTokens, decideBestMatch, scoreScriptFileForShoot } from "./drive-script-score";

/**
 * Koppelt script-PDF's uit Google Drive automatisch aan de juiste opname.
 *
 * De betrouwbare sleutel (bevestigd met het team) is: dezelfde klant + de
 * opnamedatum in de bestandsnaam of de mapnaam, en losse mappen per opname.
 * We koppelen alleen automatisch bij een zekere match (datum in naam/pad);
 * twijfelgevallen worden een "suggestie" die het team met één klik bevestigt.
 * Zo ontstaan er nooit verkeerde captions. De scorelogica staat (puur/testbaar)
 * in `drive-script-score.ts`.
 */

type CandidateFile = ScoreFile & { externalId: string };

/** Kandidaat-scriptbestanden (PDF) van een klant uit de al gesynchroniseerde Drive-map. */
async function candidateFilesByClient(clientIds: string[]): Promise<Map<string, CandidateFile[]>> {
  const result = new Map<string, CandidateFile[]>();
  if (clientIds.length === 0) return result;
  const rows = await db
    .select({
      clientId: files.clientId,
      externalId: files.externalId,
      name: files.name,
      path: files.path,
      mimeType: files.mimeType,
      modifiedAt: files.modifiedAt,
    })
    .from(files)
    .where(
      and(
        inArray(files.clientId, clientIds),
        eq(files.isFolder, false),
        isNull(files.deletedAt),
        // Script-PDF's: in een Scripts-map óf met "script" in naam/pad.
        or(
          eq(files.category, "Scripts"),
          sql`lower(${files.path}) like '%script%'`,
          sql`lower(${files.name}) like '%script%'`,
        ),
        // Alleen PDF's (de captiongenerator leest een PDF).
        or(
          eq(files.mimeType, "application/pdf"),
          sql`lower(${files.name}) like '%.pdf'`,
        ),
        // Geen macOS-restbestanden ("._naam.pdf") of Office-lockbestanden: die
        // lijken op het echte script maar bevatten geen leesbare PDF.
        sql`${files.name} not like '.\\_%' escape '\\'`,
        sql`${files.name} not like '~$%'`,
      ),
    );
  for (const r of rows) {
    if (!r.clientId || !r.externalId) continue;
    const list = result.get(r.clientId) ?? [];
    list.push({ externalId: r.externalId, name: r.name, path: r.path, modifiedAt: r.modifiedAt });
    result.set(r.clientId, list);
  }
  return result;
}

/** Eén kandidaat-script-PDF uit Drive, voor de handmatige kiezer. */
export type DriveScriptCandidate = {
  externalId: string;
  name: string;
  path: string | null;
  url: string | null;
  modifiedAt: string | null;
};

/**
 * Alle kandidaat-script-PDF's van één klant uit de gesynchroniseerde Drive-map,
 * nieuwste eerst — voor het handmatig kiezen van de juiste PDF in de Caption Maker.
 */
export async function driveScriptCandidatesForClient(clientId: string): Promise<DriveScriptCandidate[]> {
  const rows = await db
    .select({
      externalId: files.externalId,
      name: files.name,
      path: files.path,
      url: files.externalUrl,
      modifiedAt: files.modifiedAt,
    })
    .from(files)
    .where(
      and(
        eq(files.clientId, clientId),
        eq(files.isFolder, false),
        isNull(files.deletedAt),
        or(
          eq(files.category, "Scripts"),
          sql`lower(${files.path}) like '%script%'`,
          sql`lower(${files.name}) like '%script%'`,
        ),
        or(
          eq(files.mimeType, "application/pdf"),
          sql`lower(${files.name}) like '%.pdf'`,
        ),
        // Geen macOS-restbestanden ("._naam.pdf") of Office-lockbestanden: die
        // lijken op het echte script maar bevatten geen leesbare PDF.
        sql`${files.name} not like '.\\_%' escape '\\'`,
        sql`${files.name} not like '~$%'`,
      ),
    );
  return rows
    .filter((r): r is typeof r & { externalId: string } => Boolean(r.externalId))
    .map((r) => ({
      externalId: r.externalId,
      name: r.name,
      path: r.path ?? null,
      url: r.url ?? null,
      modifiedAt: r.modifiedAt ? r.modifiedAt.toISOString() : null,
    }))
    .sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
}

export type ShootForMatch = {
  productionDayId: string;
  clientId: string;
  scheduledOn: string;
  title: string | null;
  clientName: string | null;
};

export type MatchOutcome = {
  productionDayId: string;
  linked: number; // 0 of 1
  suggested: number; // 0 of 1
};

/**
 * Matcht Drive-script-PDF's aan de meegegeven opnames en schrijft de koppeling/
 * suggestie weg in `shoot_script_sources`. Respecteert menselijke keuzes: een al
 * bevestigde koppeling of een afgewezen rij wordt niet overschreven. Draait puur
 * op de DB (geen Drive-download) en is dus snel en veilig voor een achtergrond-job.
 */
export async function matchDriveScriptsForShoots(shoots: ShootForMatch[]): Promise<MatchOutcome[]> {
  if (shoots.length === 0) return [];
  const clientIds = [...new Set(shoots.map((s) => s.clientId))];
  const [filesByClient, existing] = await Promise.all([
    candidateFilesByClient(clientIds),
    db
      .select({
        productionDayId: shootScriptSources.productionDayId,
        status: shootScriptSources.status,
        confirmedAt: shootScriptSources.confirmedAt,
        fileExternalId: shootScriptSources.fileExternalId,
      })
      .from(shootScriptSources)
      .where(inArray(shootScriptSources.productionDayId, shoots.map((s) => s.productionDayId))),
  ]);
  const existingByDay = new Map(existing.map((e) => [e.productionDayId, e]));

  const outcomes: MatchOutcome[] = [];
  for (const shoot of shoots) {
    const prior = existingByDay.get(shoot.productionDayId);
    // Menselijke beslissing respecteren: bevestigde koppeling of afwijzing laten staan.
    if (prior && (prior.confirmedAt || prior.status === "afgewezen")) {
      outcomes.push({ productionDayId: shoot.productionDayId, linked: prior.status === "gekoppeld" ? 1 : 0, suggested: prior.status === "suggestie" ? 1 : 0 });
      continue;
    }

    const clientFiles = filesByClient.get(shoot.clientId) ?? [];
    const candidates: ShootCandidate[] = clientFiles.map((f) => ({
      fileExternalId: f.externalId,
      fileName: f.name,
      filePath: f.path ?? null,
      result: scoreScriptFileForShoot(
        { scheduledOn: shoot.scheduledOn, title: shoot.title, clientName: shoot.clientName },
        f,
      ),
    }));
    const decision = decideBestMatch(candidates);

    if (!decision) {
      // Geen geldige (klant-matchende) kandidaat. Stond er eerder wél een
      // automatische koppeling/suggestie — bijv. een verkeerd gekoppeld script van
      // een andere klant — dan halen we die nu weg, zodat de captions/briefing 'm
      // niet meer gebruiken. Alleen opruimen als Drive echt bestanden had (niet bij
      // een lege/haperende sync), en nooit een door mensen bevestigde koppeling.
      if (prior && clientFiles.length > 0) {
        await db.delete(shootScriptSources).where(eq(shootScriptSources.productionDayId, shoot.productionDayId));
      }
      outcomes.push({ productionDayId: shoot.productionDayId, linked: 0, suggested: 0 });
      continue;
    }

    const { best, status } = decision;
    const now = new Date();
    await db
      .insert(shootScriptSources)
      .values({
        productionDayId: shoot.productionDayId,
        clientId: shoot.clientId,
        status,
        confidence: best.result.confidence,
        fileExternalId: best.fileExternalId,
        fileName: best.fileName.slice(0, 400),
        filePath: best.filePath,
        matchReason: best.result.reason,
        matchedAt: now,
      })
      .onConflictDoUpdate({
        target: shootScriptSources.productionDayId,
        set: {
          status,
          confidence: best.result.confidence,
          fileExternalId: best.fileExternalId,
          fileName: best.fileName.slice(0, 400),
          filePath: best.filePath,
          matchReason: best.result.reason,
          matchedAt: now,
          updatedAt: now,
        },
      });

    outcomes.push({ productionDayId: shoot.productionDayId, linked: status === "gekoppeld" ? 1 : 0, suggested: status === "suggestie" ? 1 : 0 });
  }
  return outcomes;
}
