import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * Publicatiecheck vóór publicatie (Contentplanning):
 *  1. Ondertiteling en caption worden per video lui aangemaakt, idempotent.
 *  2. De caption-check is hetzelfde punt als in de checklist na publicatie.
 *  3. De voortgangsteller na publicatie telt het nieuwe vooraf-punt niet mee.
 *  4. Bestaande vinkjes worden nooit overschreven bij opnieuw laden.
 */
let deliverableId = "";

beforeAll(async () => {
  const db = await freshDatabase();
  const { clients, deliverables } = await import("@/db/schema");
  const [c] = await db.insert(clients).values({ slug: "klant-pc", name: "Klant PC", status: "active" }).returning({ id: clients.id });
  const [d] = await db.insert(deliverables).values({ clientId: c!.id, title: "Video 1", status: "approved" }).returning({ id: deliverables.id });
  deliverableId = d!.id;
});
afterAll(closeDatabase);

describe("publicatiecheck vooraf", () => {
  it("maakt ondertiteling en caption aan en is idempotent", async () => {
    const { getPrePublicationChecks } = await import("@/server/publication-checks");
    const a = (await getPrePublicationChecks([deliverableId])).get(deliverableId)!;
    const b = (await getPrePublicationChecks([deliverableId, deliverableId])).get(deliverableId)!;
    expect(a.subtitles.id).toBeTruthy();
    expect(a.caption.id).toBe(b.caption.id);
    expect(a.subtitles.done).toBe(false);
  });

  it("caption afvinken telt ook in de checklist na publicatie, ondertiteling niet", async () => {
    const { db } = await import("@/db/client");
    const { publicationChecks } = await import("@/db/schema");
    const { getPrePublicationChecks, getPublicationCheckSummaries, getOrCreatePublicationChecks } = await import("@/server/publication-checks");
    const pre = (await getPrePublicationChecks([deliverableId])).get(deliverableId)!;
    await db.update(publicationChecks).set({ done: true }).where(eq(publicationChecks.id, pre.caption.id));
    await db.update(publicationChecks).set({ done: true }).where(eq(publicationChecks.id, pre.subtitles.id));

    const after = await getOrCreatePublicationChecks(deliverableId);
    expect(after.find((x) => x.label === "Caption gecontroleerd op spelfouten")!.done).toBe(true);
    expect(after.some((x) => x.label === "Ondertiteling en teksten gecontroleerd")).toBe(false);

    const sum = (await getPublicationCheckSummaries([deliverableId])).get(deliverableId)!;
    expect(sum).toEqual({ done: 1, total: 5 });

    // Opnieuw laden zet niets terug.
    const again = (await getPrePublicationChecks([deliverableId])).get(deliverableId)!;
    expect(again.caption.done).toBe(true);
    expect(again.subtitles.done).toBe(true);
  });
});
