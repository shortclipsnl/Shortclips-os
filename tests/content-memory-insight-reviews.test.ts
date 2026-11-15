import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, users } from "@/db/schema";
import type { Viewer } from "@/server/auth/context";

let clientId = "";
let otherId = "";
let viewer: Viewer;

describe("klantinzichten: beoordeling door het team", () => {
  beforeAll(async () => {
    const db = await freshDatabase();
    const [u] = await db.insert(users).values({ email: "team@example.com", fullName: "Team Lid", status: "active", primaryRole: "owner" }).returning({ id: users.id });
    const [a, b] = await db.insert(clients).values([
      { slug: "klant-ci", name: "Klant CI", status: "active" },
      { slug: "klant-ci-2", name: "Klant CI 2", status: "active" },
    ]).returning({ id: clients.id });
    clientId = a!.id;
    otherId = b!.id;
    viewer = { id: u!.id, clientScope: null, isPortalUser: false, isEditorOnly: false, permissions: new Set(["analytics:read"]) } as unknown as Viewer;
  });
  afterAll(closeDatabase);

  it("begint leeg: de klant ziet niets zonder goedkeuring", async () => {
    const { loadInsightReviews } = await import("@/server/content-memory/client-insights-store");
    expect(await loadInsightReviews(clientId)).toEqual([]);
  });

  it("slaat goedkeuring en eigen tekst op, één regel per inzicht", async () => {
    const { loadInsightReviews, setInsightReview } = await import("@/server/content-memory/client-insights-store");
    expect((await setInsightReview(viewer, clientId, { key: "meer:hook:Prijs", decision: "tonen" })).ok).toBe(true);
    await setInsightReview(viewer, clientId, { key: "meer:hook:Prijs", decision: "tonen", clientTitle: "  Prijs in de opening  ", clientText: "Werkt goed." });
    await setInsightReview(viewer, clientId, { key: "minder:cta:Geen duidelijke CTA", decision: "verbergen" });
    const rows = await loadInsightReviews(clientId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.key === "meer:hook:Prijs")).toMatchObject({ decision: "tonen", clientTitle: "Prijs in de opening", clientText: "Werkt goed." });
    expect(rows.find((r) => r.key.startsWith("minder"))?.decision).toBe("verbergen");
    // Lege tekst = terug naar de standaardtekst.
    await setInsightReview(viewer, clientId, { key: "meer:hook:Prijs", decision: "tonen", clientTitle: "", clientText: null });
    expect((await loadInsightReviews(clientId)).find((r) => r.key === "meer:hook:Prijs")).toMatchObject({ clientTitle: null, clientText: null });
  });

  it("houdt klanten gescheiden en weigert toegang buiten de eigen klanten", async () => {
    const { loadInsightReviews, setInsightReview } = await import("@/server/content-memory/client-insights-store");
    expect(await loadInsightReviews(otherId)).toEqual([]);
    const scoped = { ...viewer, clientScope: [otherId] } as Viewer;
    await expect(setInsightReview(scoped, clientId, { key: "meer:hook:Prijs", decision: "tonen" })).rejects.toThrow();
  });
});
