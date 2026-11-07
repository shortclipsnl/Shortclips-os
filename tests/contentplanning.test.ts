import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { buildPlanningChecklist, type ChecklistPost } from "@/lib/content-planning-status";

/**
 * Contentplanning: statusoverzicht + PDF.
 *  1. De checklist toont alleen "afgerond" als de planning dat aantoont.
 *  2. Overzicht en PDF bevatten uitsluitend gedeelde items van de eigen klant.
 *  3. De klantroute kan nooit een andere klant exporteren; de teamroute
 *     respecteert klantscope en weigert klantaccounts.
 */

// Geen Chrome in de testomgeving: de "PDF" is hier de HTML zelf, zodat we de inhoud kunnen controleren.
vi.mock("@/server/pdf/render", () => ({ htmlToPdf: async (html: string) => new TextEncoder().encode(html) }));
vi.mock("@/server/audit", () => ({ auditLog: async () => undefined }));

let currentViewer: unknown = null;
vi.mock("@/server/auth/context", async (orig) => {
  const real = await orig<typeof import("@/server/auth/context")>();
  return { ...real, getViewer: async () => currentViewer };
});

const iso = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
};

const post = (o: Partial<ChecklistPost> = {}): ChecklistPost => ({
  status: "scheduled", scheduledOn: iso(2), scheduledAt: "18:00", platforms: ["tiktok"], caption: "Caption", videoStatus: "approved", ...o,
});

describe("checklist (puur)", () => {
  const today = iso(0);
  it("alles klaar en Shortclips publiceert → Alles staat klaar, niets bij de klant", () => {
    const c = buildPlanningChecklist({ weHandlePosting: true, posts: [post(), post()], videosAwaitingClient: 0, scriptsAwaitingClient: 0, today });
    expect(c.allDone).toBe(true);
    expect(c.headline).toBe("Alles staat klaar.");
    expect(c.items.find((i) => i.key === "client")!.state).toBe("done");
  });
  it("ontbrekende caption, tijd en kanaal → in voorbereiding, geen nep-vinkjes", () => {
    const c = buildPlanningChecklist({ weHandlePosting: true, posts: [post({ caption: "", scheduledAt: null, platforms: [], status: "to_prepare", videoStatus: "editing" })], videosAwaitingClient: 0, scriptsAwaitingClient: 0, today });
    for (const k of ["videos", "dates", "platforms", "captions", "publishing"]) expect(c.items.find((i) => i.key === k)!.state).toBe("preparing");
    expect(c.allDone).toBe(false);
    expect(c.headline).not.toBe("Alles staat klaar.");
  });
  it("klant publiceert zelf → publicatie n.v.t. en actie bij de klant", () => {
    const c = buildPlanningChecklist({ weHandlePosting: false, posts: [post({ status: "ready" })], videosAwaitingClient: 0, scriptsAwaitingClient: 0, today });
    expect(c.items.find((i) => i.key === "publishing")!.state).toBe("na");
    const cl = c.items.find((i) => i.key === "client")!;
    expect(cl.state).toBe("action");
    expect(cl.detail).toMatch(/zelf plaatsen/);
  });
  it("video wacht op feedback → actie met link naar video's", () => {
    const c = buildPlanningChecklist({ weHandlePosting: true, posts: [post()], videosAwaitingClient: 2, scriptsAwaitingClient: 1, today });
    const cl = c.items.find((i) => i.key === "client")!;
    expect(cl.state).toBe("action");
    expect(cl.href).toBe("/portal/videos");
    expect(c.needsClient).toBe(true);
  });
  it("geen planning → niets afgerond", () => {
    const c = buildPlanningChecklist({ weHandlePosting: true, posts: [], videosAwaitingClient: 0, scriptsAwaitingClient: 0, today });
    expect(c.items.filter((i) => i.owner === "shortclips").every((i) => i.state === "preparing")).toBe(true);
  });
});

describe("overzicht, PDF en toegang", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let A = "", B = "", EMPTY = "";

  beforeAll(async () => {
    db = await freshDatabase();
    s = await import("@/db/schema");
    const ins = async (slug: string, name: string, weHandlePosting: boolean) =>
      (await db.insert(s.clients).values({ slug, name, status: "active", weHandlePosting }).returning({ id: s.clients.id }))[0]!.id;
    A = await ins("klant-a", "Klant A", true);
    B = await ins("klant-b", "Klant B", false);
    EMPTY = await ins("klant-leeg", "Klant Leeg", true);

    await db.insert(s.contentCalendar).values([
      { clientId: A, title: "A gedeelde video", scheduledOn: iso(1), scheduledAt: "18:00", status: "scheduled", platforms: ["tiktok", "instagram"], caption: "x", clientApproved: true },
      { clientId: A, title: "A geheim concept", scheduledOn: iso(2), status: "scheduled", platforms: ["tiktok"], clientApproved: false },
      { clientId: A, title: "A oude video", scheduledOn: iso(-40), status: "published", platforms: ["tiktok"], clientApproved: true },
      { clientId: B, title: "B video", scheduledOn: iso(1), scheduledAt: "12:00", status: "ready", platforms: ["instagram"], caption: "y", clientApproved: true },
    ]);
    // Klant B: 9 video's op één dag → kalender moet doorlopen op een vervolgpagina.
    await db.insert(s.contentCalendar).values(Array.from({ length: 9 }, (_, i) => ({
      clientId: B, title: `B drukke dag ${i + 1}`, scheduledOn: iso(3), scheduledAt: `1${i}:00`, status: "ready" as const, platforms: ["tiktok"], caption: "z", clientApproved: true,
    })));
  });
  afterAll(async () => { await closeDatabase(); });

  it("overzicht bevat alleen gedeelde, actuele items van de eigen klant", async () => {
    const { loadContentPlanningOverview } = await import("@/server/content-planning/overview");
    const o = (await loadContentPlanningOverview(A))!;
    expect(o.posts.map((p) => p.title)).toEqual(["A gedeelde video"]);
    expect(o.unsharedCount).toBe(1);
    expect(o.checklist.allDone).toBe(true);
  });

  it("PDF-HTML: juiste klant, geen concepten, vervolgpagina bij drukke dag, lege planning zonder verzonnen data", async () => {
    const { loadContentPlanningOverview } = await import("@/server/content-planning/overview");
    const { renderContentPlanningHtml } = await import("@/server/content-planning/pdf-html");
    const pages = (html: string, kind: string) => (html.match(new RegExp(`data-page="${kind}"`, "g")) ?? []).length;

    const oa = (await loadContentPlanningOverview(A))!;
    const a = renderContentPlanningHtml(oa);
    expect(a).toContain("A gedeelde video");
    expect(a).not.toContain("A geheim concept");
    expect(a).not.toContain("B video");
    expect(pages(a, "status")).toBe(1);
    // Nog geen gepubliceerde maandanalyse → Optimalisatie niet "klaar" en de kop zegt niet dat alles klaar is.
    expect(oa.pdfCards).toEqual(["done", "done", "done", "preparing"]);
    expect(a).toContain("Bijna alles staat klaar.");

    // Met een gepubliceerde maandanalyse van deze maand is alles klaar: pagina gelijk aan het sjabloon.
    const period = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
    await db.insert(s.clientReports).values({ clientId: A, period, title: "Maandanalyse", status: "gepubliceerd" });
    const oa2 = (await loadContentPlanningOverview(A))!;
    expect(oa2.pdfCards.every((c) => c === "done")).toBe(true);
    const a2 = renderContentPlanningHtml(oa2);
    expect(a2).not.toContain("Bijna alles staat klaar.");
    expect(a2).not.toContain('class="badge');

    // Klant B: 9 video's op één dag → 3 kalenderpagina's voor die week (4 + 4 + 1), plus "B video".
    const b = renderContentPlanningHtml((await loadContentPlanningOverview(B))!);
    for (let i = 1; i <= 9; i++) expect(b).toContain(`B drukke dag ${i}`);
    expect(pages(b, "kalender")).toBeGreaterThanOrEqual(3);

    const e = renderContentPlanningHtml((await loadContentPlanningOverview(EMPTY))!);
    expect(pages(e, "kalender")).toBe(1);
    expect(e).not.toContain('class="slot"');
  });

  it("klantroute exporteert altijd en alleen de eigen klant", async () => {
    const { GET } = await import("@/app/api/portal/contentplanning/pdf/route");
    currentViewer = null;
    expect((await GET()).status).toBe(401);
    currentViewer = { id: "u", isPortalUser: true, clientId: B, clientScope: [B], permissions: new Set(), isEditorOnly: false, primaryRole: "client" };
    const res = await GET();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("B video");
    expect(html).not.toContain("A gedeelde video");
    expect(res.headers.get("Content-Disposition")).toContain("Klant_B");
  });

  it("teamroute: scope, rechten en geen klantaccounts", async () => {
    const { GET } = await import("@/app/api/contentplanning/[clientId]/pdf/route");
    const call = (id: string) => GET(new Request("http://x"), { params: Promise.resolve({ clientId: id }) });
    // Klantaccount mag de teamroute niet gebruiken, ook niet voor de eigen klant.
    currentViewer = { id: "u", isPortalUser: true, clientId: B, clientScope: [B], permissions: new Set(["calendar:read"]), isEditorOnly: false, primaryRole: "client" };
    expect((await call(B)).status).toBe(403);
    // Teamlid met scope op alleen A.
    currentViewer = { id: "t", isPortalUser: false, clientId: null, clientScope: [A], permissions: new Set(["calendar:read"]), isEditorOnly: false, primaryRole: "project_coordinator" };
    expect((await call(B)).status).toBe(403);
    const ok = await call(A);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("A gedeelde video");
    // Zonder leesrecht op de contentplanning.
    currentViewer = { id: "t", isPortalUser: false, clientId: null, clientScope: null, permissions: new Set(), isEditorOnly: false, primaryRole: "editor" };
    expect((await call(A)).status).toBe(403);
    // Eigenaar (alle klanten) krijgt exact dezelfde inhoud als de klant.
    currentViewer = { id: "o", isPortalUser: false, clientId: null, clientScope: null, permissions: new Set(["calendar:read"]), isEditorOnly: false, primaryRole: "owner" };
    const team = await (await call(B)).text();
    currentViewer = { id: "u", isPortalUser: true, clientId: B, clientScope: [B], permissions: new Set(), isEditorOnly: false, primaryRole: "client" };
    const { GET: portalGET } = await import("@/app/api/portal/contentplanning/pdf/route");
    expect(await (await portalGET()).text()).toBe(team);
  });
});
