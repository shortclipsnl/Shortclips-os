import "server-only";
import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { attentionStates, clients, users, type AttentionNote } from "@/db/schema";
import { CORE_STAFF_EMAILS, coreStaffRank } from "@/server/core-staff";
import { getQualityOverview, type AttentionArea, type AttentionPriority } from "@/server/quality";
import type { Viewer } from "@/server/auth/context";

/**
 * Aandachtspunten zoals het team ze ziet: de live signalen uit `quality.ts`,
 * aangevuld met wat het team ermee deed (status, verantwoordelijke, notities)
 * en de handmatig toegevoegde punten.
 */

export type AttentionStatus = "open" | "bezig" | "klaar";
export type AttentionItem = {
  key: string;
  clientName: string | null;
  clientLogoUrl: string | null;
  clientColor: string | null;
  action: string;
  reason: string;
  why: string;
  priority: AttentionPriority;
  area: AttentionArea;
  ownerId: string | null;
  status: AttentionStatus;
  /** Eerste keer gezien (ISO). */
  since: string;
  doneAt: string | null;
  notes: AttentionNote[];
  href: string | null;
  kids: { label: string; sub: string; href?: string }[];
  manual: boolean;
  /** Concrete deadline (YYYY-MM-DD), waar bekend. */
  dueOn: string | null;
};
export type TeamMember = { id: string; name: string; initials: string; role: string };

/** Na zoveel dagen komt een als afgerond gemarkeerd punt terug als het probleem nog steeds bestaat. */
const REOPEN_AFTER_DAYS = 3;
const DONE_VISIBLE_DAYS = 7;

const ROLE_LABEL: Record<string, string> = {
  jarno: "Founder", milou: "Content Creative", jiska: "Content Creative", rutger: "Head of Content",
};

export async function listAttentionTeam(): Promise<TeamMember[]> {
  const rows = await db.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users)
    .where(and(inArray(users.email, [...CORE_STAFF_EMAILS]), isNull(users.deletedAt)));
  return rows
    .sort((a, b) => coreStaffRank(a.email) - coreStaffRank(b.email))
    .map((r) => {
      const first = r.fullName.trim().split(/\s+/)[0] ?? r.fullName;
      const key = r.email.toLowerCase().split("@")[0];
      return { id: r.id, name: first, initials: first.slice(0, 2).toUpperCase(), role: ROLE_LABEL[key] ?? "" };
    });
}

export async function getAttentionBoard(viewer: Viewer, opts: { trusted?: boolean } = {}): Promise<{ items: AttentionItem[]; team: TeamMember[] }> {
  const [{ items: signals }, team] = await Promise.all([getQualityOverview(viewer, opts), listAttentionTeam()]);
  const now = Date.now();

  // Elk signaal krijgt een rij (eerste keer gezien), zodat we weten hoe lang het
  // al openstaat en de meldingen-job weet wat nieuw is. Bestaande rijen blijven.
  if (signals.length) {
    await db.insert(attentionStates).values(signals.map((s) => ({
      signalKey: s.id, title: s.action, clientLabel: s.clientName ?? null, category: s.area,
      priority: s.priority, reason: s.reason,
    }))).onConflictDoNothing({ target: attentionStates.signalKey });
  }

  const keys = signals.map((s) => s.id);
  const doneSince = new Date(now - DONE_VISIBLE_DAYS * 864e5);
  const states = await db.select().from(attentionStates).where(or(
    keys.length ? inArray(attentionStates.signalKey, keys) : sql`false`,
    and(eq(attentionStates.manual, "true"), or(sql`${attentionStates.status} <> 'klaar'`, gte(attentionStates.doneAt, doneSince))),
    and(eq(attentionStates.status, "klaar"), gte(attentionStates.doneAt, doneSince)),
  ));
  const byKey = new Map(states.map((r) => [r.signalKey, r]));

  const items: AttentionItem[] = [];
  const reopen: string[] = [];
  const active = new Set(keys);

  for (const s of signals) {
    const st = byKey.get(s.id);
    let status = (st?.status ?? "open") as AttentionStatus;
    // Afgerond, maar het probleem is er na een paar dagen nog steeds → weer open.
    // Klantbehoud-punten niet: die zijn per maand/fase en zijn met een vastgelegde
    // actie afgerond; heropenen zou een dagelijkse herhaling geven.
    if (status === "klaar" && st?.doneAt && !s.id.startsWith("retentie-") && now - st.doneAt.getTime() > REOPEN_AFTER_DAYS * 864e5) {
      status = "open";
      reopen.push(s.id);
    }
    items.push({
      key: s.id, clientName: s.clientName ?? null, clientLogoUrl: s.clientLogoUrl ?? null, clientColor: s.clientColor ?? null,
      action: s.action, reason: s.reason, why: s.detail, priority: s.priority, area: s.area,
      ownerId: st?.assigneeId ?? s.ownerId ?? null, status,
      since: (st?.createdAt ?? new Date()).toISOString(), doneAt: status === "klaar" ? st?.doneAt?.toISOString() ?? null : null,
      notes: st?.notes ?? [], href: s.href, kids: s.kids ?? [], manual: false, dueOn: s.dueOn ?? null,
    });
  }

  // Handmatige punten en recent afgeronde punten waarvan het signaal al weg is.
  const manualClientIds = states.filter((r) => r.manual === "true" && r.clientId).map((r) => r.clientId!);
  const logos = manualClientIds.length
    ? await db.select({ id: clients.id, logoUrl: clients.logoUrl, color: clients.color, slug: clients.slug }).from(clients).where(inArray(clients.id, manualClientIds))
    : [];
  const logoById = new Map(logos.map((l) => [l.id, l]));
  for (const r of states) {
    if (active.has(r.signalKey)) continue;
    const manual = r.manual === "true";
    if (!manual && r.status !== "klaar") continue;
    const logo = r.clientId ? logoById.get(r.clientId) : undefined;
    items.push({
      key: r.signalKey, clientName: r.clientLabel, clientLogoUrl: logo?.logoUrl ?? null, clientColor: logo?.color ?? null,
      action: r.title ?? "Aandachtspunt", reason: manual ? (r.reason ?? "Handmatig toegevoegd") : "Opgelost",
      why: manual ? (r.reason ?? "Handmatig toegevoegd. Rond dit punt zelf af als het klaar is.") : "Dit punt is afgerond.",
      priority: (r.priority as AttentionPriority) ?? "normaal", area: (r.category as AttentionArea) ?? "overig",
      ownerId: r.assigneeId, status: r.status as AttentionStatus, since: r.createdAt.toISOString(),
      doneAt: r.doneAt?.toISOString() ?? null, notes: r.notes ?? [],
      href: manual && logo ? `/clients/${logo.slug}` : null, kids: [], manual, dueOn: null,
    });
  }

  if (reopen.length) {
    await db.update(attentionStates).set({ status: "open", doneAt: null, doneById: null, updatedAt: new Date() })
      .where(inArray(attentionStates.signalKey, reopen));
  }

  return { items, team };
}
