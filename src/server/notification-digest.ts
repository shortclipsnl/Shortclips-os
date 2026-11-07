import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, users } from "@/db/schema";
import { notify } from "@/server/notifications";

/**
 * Dagbundel voor meldingen die anders per stuk binnenkomen (technische
 * storingen, ontbrekende doelstanden). Per ontvanger per dag precies één
 * melding: komt er die dag iets bij, dan wordt dezelfde melding aangevuld in
 * plaats van een nieuwe te sturen. Een al gelezen melding popt niet opnieuw op.
 * Zo blijft het belletje rustig en is alles toch terug te lezen.
 */
export type DigestInput = {
  roles: string[];
  /** Soort bundel, bijv. "tech" of "goal_stand". */
  digest: string;
  type: string;
  level?: "info" | "warning" | "critical";
  /** Titel bij n punten. */
  title: (n: number) => string;
  /** Eén regel voor dit punt; dubbele regels worden genegeerd. */
  line: string;
  href: string;
  now?: Date;
};

const BULLET = "• ";

export async function notifyDigest(input: DigestInput): Promise<number> {
  const day = (input.now ?? new Date()).toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const dedupeKey = `digest:${input.digest}:${day}`;
  const recipients = await db.select({ id: users.id }).from(users)
    .where(and(inArray(users.primaryRole, input.roles as ("owner")[]), eq(users.status, "active"), isNull(users.deletedAt)));
  if (!recipients.length) return 0;

  let sent = 0;
  for (const r of recipients) {
    const [existing] = await db.select({ id: notifications.id, body: notifications.body }).from(notifications)
      .where(and(eq(notifications.userId, r.id), eq(notifications.dedupeKey, dedupeKey))).limit(1);
    if (!existing) {
      sent += await notify({ userIds: [r.id], type: input.type, level: input.level ?? "warning", title: input.title(1), body: BULLET + input.line, href: input.href, dedupeKey });
      continue;
    }
    const lines = (existing.body ?? "").split("\n").filter(Boolean);
    if (lines.includes(BULLET + input.line)) continue;
    lines.push(BULLET + input.line);
    await db.update(notifications).set({
      title: input.title(lines.length).slice(0, 240),
      body: lines.join("\n").slice(0, 2000),
      updatedAt: new Date(),
    }).where(eq(notifications.id, existing.id));
  }
  return sent;
}

/** Technische storingen (koppelingen, agenda's): alleen naar de eigenaar, max. één per dag. */
export function notifyTechnical(line: string, level: "warning" | "critical" = "warning") {
  return notifyDigest({
    roles: ["owner"], digest: "tech", type: "technical_digest", level, href: "/settings/integrations", line,
    title: (n) => (n === 1 ? "Technische storing" : `${n} technische storingen vandaag`),
  });
}
