import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { notifications, users } from "@/db/schema";

/** Technische storingen en ontbrekende doelstanden: maximaal één melding per dag, alleen voor de eigenaar. */
type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
let jarno: string;

beforeAll(async () => {
  db = await freshDatabase();
  const [j] = await db.insert(users).values({ email: "jarno@shortclips.nl", fullName: "Jarno Test", status: "active", primaryRole: "owner" }).returning({ id: users.id });
  jarno = j!.id;
  await db.insert(users).values({ email: "milou@shortclips.nl", fullName: "Milou Test", status: "active", primaryRole: "operational_manager" });
});
afterAll(async () => { await closeDatabase(); });

describe("dagbundel meldingen", () => {
  it("drie storingen op één dag = één melding met drie regels, alleen voor de eigenaar", async () => {
    const { notifyTechnical } = await import("@/server/notification-digest");
    await notifyTechnical("Frame.io synchroniseert niet");
    await notifyTechnical("Google Agenda: agenda 5b992921… niet bereikbaar");
    await notifyTechnical("Frame.io synchroniseert niet"); // dubbel: genegeerd
    await notifyTechnical("Google Drive synchroniseert niet");
    const all = await db.select().from(notifications);
    expect(all).toHaveLength(1);
    expect(all[0].userId).toBe(jarno);
    expect(all[0].title).toBe("3 technische storingen vandaag");
    expect(all[0].body!.split("\n")).toHaveLength(3);
  });

  it("gelezen melding popt niet opnieuw op, maar wordt wel aangevuld", async () => {
    const { notifyTechnical } = await import("@/server/notification-digest");
    await db.update(notifications).set({ readAt: new Date() });
    await notifyTechnical("Metricool synchroniseert niet");
    const [n] = await db.select().from(notifications);
    expect(n.readAt).not.toBeNull();
    expect(n.body).toContain("Metricool");
  });

  it("ontbrekende doelstanden: één melding per dag", async () => {
    const { notifyDigest } = await import("@/server/notification-digest");
    for (const t of ["Omzet Q4", "Nieuwe klanten", "Doorlooptijd editing"]) {
      await notifyDigest({ roles: ["owner"], digest: "goal_stand", type: "goal_stand_ontbreekt", href: "/doelen", line: t, title: (n) => `Stand van ${n} doelen ontbreekt` });
    }
    const goals = await db.select().from(notifications).where(eq(notifications.type, "goal_stand_ontbreekt"));
    expect(goals).toHaveLength(1);
    expect(goals[0].title).toBe("Stand van 3 doelen ontbreekt");
  });

  it("volgende dag weer een nieuwe melding", async () => {
    const { notifyTechnical, notifyDigest } = await import("@/server/notification-digest");
    void notifyTechnical;
    await notifyDigest({ roles: ["owner"], digest: "tech", type: "technical_digest", href: "/settings/integrations", line: "Frame.io synchroniseert niet", title: () => "Technische storing", now: new Date(Date.now() + 864e5) });
    expect((await db.select().from(notifications).where(eq(notifications.type, "technical_digest")))).toHaveLength(2);
  });
});
