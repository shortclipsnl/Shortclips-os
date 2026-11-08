import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";

/**
 * Statuscheck editors van begin tot eind op een echte (test)database:
 * job → check in het editorportaal → antwoord → voortgang en aandachtspunt.
 */
describe("Statuscheck editors (flow)", () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  let s: typeof import("@/db/schema");
  let svc: typeof import("@/server/editor-status-checks");
  let editor = "";
  let other = "";
  let videoId = "";

  const at = (iso: string) => vi.setSystemTime(new Date(iso));

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at("2026-11-11T08:00:00+01:00");
    db = await freshDatabase();
    s = await import("@/db/schema");
    svc = await import("@/server/editor-status-checks");
    const [c] = await db.insert(s.clients).values({ slug: "kkfh", name: "KKFH" }).returning({ id: s.clients.id });
    const [e] = await db.insert(s.users).values({ email: "quinn@x.nl", fullName: "Quinn B", status: "active", primaryRole: "editor" }).returning({ id: s.users.id });
    const [o] = await db.insert(s.users).values({ email: "noah@x.nl", fullName: "Noah", status: "active", primaryRole: "editor" }).returning({ id: s.users.id });
    editor = e!.id;
    other = o!.id;
    // Opname do 5 nov → editor deadline ma 16 nov (+7 wd), 50% op wo 11 nov (+4 wd).
    const [pd] = await db.insert(s.productionDays).values({ clientId: c!.id, title: "Opname", scheduledOn: "2026-11-05", status: "planned" }).returning({ id: s.productionDays.id });
    const [d] = await db.insert(s.deliverables).values({
      clientId: c!.id, productionDayId: pd!.id, title: "November opname", status: "editing", editorId: editor, dueOn: "2026-11-25",
      statusChangedAt: new Date("2026-11-06T10:00:00+01:00"),
    }).returning({ id: s.deliverables.id });
    videoId = d!.id;
  });
  afterEach(() => { vi.useRealTimers(); });
  afterAll(async () => { await closeDatabase(); });

  const checks = () => db.select().from(s.editorStatusChecks);
  const progress = async () => (await svc.getEditorProgress([{ id: videoId, status: "editing", editorId: editor, editorDueOn: "2026-11-16" }])).get(videoId);

  it("verstuurt halverwege één check, alleen in werktijd, en volgt het antwoord", async () => {
    await svc.runEditorStatusChecks();
    expect(await checks()).toHaveLength(0); // 08:00: buiten werktijd

    at("2026-11-11T10:05:00+01:00");
    await svc.runEditorStatusChecks();
    await svc.runEditorStatusChecks();
    const list = await checks();
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe("halfway");
    expect(list[0]!.editorDueOn).toBe("2026-11-16");
    const notes = await db.select().from(s.notifications).where(eq(s.notifications.userId, editor));
    expect(notes).toHaveLength(1);

    const open = await svc.listOpenStatusChecks(editor);
    expect(open).toHaveLength(1);
    expect(open[0]!.projectName).toBe("KKFH · November opname");
    expect((await progress())!.key).toBe("verstuurd");

    // Een werkdag later zonder reactie → aandachtspunt.
    at("2026-11-12T10:30:00+01:00");
    expect((await progress())!.key).toBe("geen_reactie");
    const signals = await svc.getEditorStatusSignals(() => true);
    expect(signals.map((x) => x.kind)).toEqual(["geen_reactie"]);

    // Een andere editor kan niet antwoorden.
    expect((await svc.answerStatusCheck(other, open[0]!.id, "bezig", null)).ok).toBe(false);
    // Nog niet begonnen, 2 werkdagen voor de deadline → risico.
    expect((await svc.answerStatusCheck(editor, open[0]!.id, "nog_niet", "wacht op muziek")).ok).toBe(true);
    const p = (await progress())!;
    expect(p.key).toBe("risico");
    expect(p.note).toBe("wacht op muziek");
    expect(await svc.listOpenStatusChecks(editor)).toHaveLength(0);

    // Dag voor de deadline + nog niet begonnen → extra check (zonder extra melding).
    at("2026-11-13T09:15:00+01:00");
    await svc.runEditorStatusChecks();
    const after = await checks();
    expect(after.map((c) => c.kind).sort()).toEqual(["halfway", "pre_deadline"]);
    expect(await db.select().from(s.notifications).where(eq(s.notifications.userId, editor))).toHaveLength(1);

    // Bijna klaar → groen; project naar interne controle → check verdwijnt bij de editor.
    const pre = await svc.listOpenStatusChecks(editor);
    await svc.answerStatusCheck(editor, pre[0]!.id, "bijna_klaar", null);
    expect((await progress())!.tone).toBe("good");
    await db.update(s.deliverables).set({ status: "internal_review" }).where(eq(s.deliverables.id, videoId));
    expect(await svc.listOpenStatusChecks(editor)).toHaveLength(0);
  });

  it("stuurt geen check voor afgeronde projecten en rekent opnieuw bij een nieuwe deadline", async () => {
    at("2026-11-11T10:05:00+01:00");
    await db.update(s.deliverables).set({ status: "approved" }).where(eq(s.deliverables.id, videoId));
    await svc.runEditorStatusChecks();
    expect(await checks()).toHaveLength(0);

    // Terug in edit, maar de opname verschuift naar 9 nov: 50% valt dan op vr 13 nov.
    await db.update(s.deliverables).set({ status: "editing" }).where(eq(s.deliverables.id, videoId));
    const [v] = await db.select().from(s.deliverables).where(eq(s.deliverables.id, videoId));
    await db.update(s.productionDays).set({ scheduledOn: "2026-11-09" }).where(eq(s.productionDays.id, v!.productionDayId!));
    await svc.runEditorStatusChecks();
    expect(await checks()).toHaveLength(0);
    at("2026-11-13T10:05:00+01:00");
    await svc.runEditorStatusChecks();
    const list = await checks();
    expect(list).toHaveLength(1);
    expect(list[0]!.cycleKey).toBe("first:2026-11-18");
  });
});
