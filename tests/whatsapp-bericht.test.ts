import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, freshDatabase } from "./helpers/db";
import { clients, deliverables, users } from "@/db/schema";
import {
  DEFAULT_WHATSAPP_BERICHT,
  LINK_PLACEHOLDER,
  applyVideoLink,
  isValidVideoLink,
  kanKopieren,
  normalizeVideoLink,
  sanitizeConcept,
  standaardMetLink,
  whatsappOpmaak,
} from "@/lib/whatsapp-bericht";
import type { Viewer } from "@/server/auth/context";

/**
 * WhatsApp-bericht eerste versies: twee vaste teksten in WhatsApp-notatie,
 * videolink automatisch in het bericht, nooit kopiëren met de tijdelijke
 * linktekst, en een concept per opname dat andere opnames niet raakt.
 */

type Db = Awaited<ReturnType<typeof freshDatabase>>;
let db: Db;
let editorId: string;
let opnameA: string;
let opnameB: string;

function viewer(email: string, extra: Partial<Viewer> = {}): Viewer {
  return { email, isPortalUser: false, isEditorOnly: false, ...extra } as unknown as Viewer;
}

const LINK = "https://next.frame.io/share/abc123";

beforeAll(async () => {
  db = await freshDatabase();
  const [e] = await db.insert(users).values({ email: "editor-wa@example.com", fullName: "Editor WA", status: "active", primaryRole: "editor" }).returning({ id: users.id });
  editorId = e!.id;
  const [c] = await db.insert(clients).values({ slug: "klant-wa", name: "Klant WA", status: "active" }).returning({ id: clients.id });
  const rows = await db
    .insert(deliverables)
    .values([
      { clientId: c!.id, title: "Opname oktober", status: "internal_review", editorId },
      { clientId: c!.id, title: "Opname november", status: "internal_review", editorId },
    ])
    .returning({ id: deliverables.id });
  opnameA = rows[0]!.id;
  opnameB = rows[1]!.id;
});

afterAll(async () => {
  await closeDatabase();
});

describe("standaardteksten", () => {
  it("optie 1 volgt de afgesproken tekst in WhatsApp-notatie", () => {
    const t = DEFAULT_WHATSAPP_BERICHT.videolink;
    const lines = t.split("\n");
    expect(lines[0]).toBe("Goedemorgen! 👋");
    expect(lines[1]).toBe("");
    expect(t).toContain("🎥 *Bekijk de video's hier:*\n[Voeg videolink toe]");
    expect(t).toContain("📅 *Contentplanning*\nIn de bijgevoegde PDF vind je de contentplanning.");
    expect(t).toContain("• *3 werkdagen:* de videolink is 3 werkdagen geldig.");
    expect(lines.filter((l) => l.startsWith("• "))).toHaveLength(3);
    expect(lines.at(-1)).toBe("Alvast bedankt! 😊");
    expect(t).not.toContain("**");
  });

  it("optie 2 verwijst naar het portaal, zonder videolink", () => {
    const t = DEFAULT_WHATSAPP_BERICHT.portaal;
    expect(t).toContain("staan klaar in jullie eigen Shortclips portaal! 🎬");
    expect(t).toContain("pagina _Video's_");
    expect(t).toContain("pagina _Contentplanning_");
    expect(t).toContain("Daarna sluiten we de feedbackronde af");
    expect(t).not.toContain(LINK_PLACEHOLDER);
    expect(t).not.toContain("**");
  });

  it("WhatsApp-opmaak: vet en cursief worden herkend", () => {
    expect(whatsappOpmaak("• *5 minuten:* zo lang duurt het")).toEqual([
      { text: "• " },
      { text: "5 minuten:", bold: true, italic: false },
      { text: " zo lang duurt het" },
    ]);
    const cursief = whatsappOpmaak("naar de pagina _Video's_. Hier");
    expect(cursief.find((d) => d.italic)?.text).toBe("Video's");
    expect(whatsappOpmaak("5 * 3 = 15")).toEqual([{ text: "5 * 3 = 15" }]);
  });
});

describe("videolink", () => {
  it("wordt automatisch in het bericht gezet en bij wijziging vervangen", () => {
    const met = standaardMetLink(DEFAULT_WHATSAPP_BERICHT.videolink, LINK);
    expect(met).toContain(`*Bekijk de video's hier:*\n${LINK}`);
    expect(met).not.toContain(LINK_PLACEHOLDER);
    const andere = applyVideoLink(met, LINK, "https://wetransfer.com/x");
    expect(andere).toContain("https://wetransfer.com/x");
    expect(andere).not.toContain(LINK);
    expect(applyVideoLink(andere, "https://wetransfer.com/x", "")).toContain(LINK_PLACEHOLDER);
  });

  it("wordt opgeschoond en gecontroleerd", () => {
    expect(normalizeVideoLink("  next.frame.io/share/abc ")).toBe("https://next.frame.io/share/abc");
    expect(normalizeVideoLink("")).toBe("");
    expect(isValidVideoLink(LINK)).toBe(true);
    expect(isValidVideoLink("https://bla")).toBe(false);
  });
});

describe("kopiëren", () => {
  const alles = ["pdf", "gecontroleerd"];

  it("niet met de tijdelijke tekst [Voeg videolink toe]", () => {
    const r = kanKopieren("videolink", DEFAULT_WHATSAPP_BERICHT.videolink, "", alles);
    expect(r.kan).toBe(false);
  });

  it("niet als de link uit het bericht is gehaald", () => {
    const zonder = standaardMetLink(DEFAULT_WHATSAPP_BERICHT.videolink, LINK).replace(LINK, "");
    expect(kanKopieren("videolink", zonder, LINK, alles).kan).toBe(false);
  });

  it("pas als de checklist is afgevinkt", () => {
    const t = standaardMetLink(DEFAULT_WHATSAPP_BERICHT.videolink, LINK);
    expect(kanKopieren("videolink", t, LINK, ["gecontroleerd"]).kan).toBe(false);
    expect(kanKopieren("videolink", t, LINK, alles).kan).toBe(true);
    expect(kanKopieren("portaal", DEFAULT_WHATSAPP_BERICHT.portaal, "", ["portaal", "contentplanning"]).kan).toBe(false);
    expect(kanKopieren("portaal", DEFAULT_WHATSAPP_BERICHT.portaal, "", ["portaal", "contentplanning", "gecontroleerd"]).kan).toBe(true);
  });
});

describe("concept per opname", () => {
  it("sanitize gooit onbekende velden en checks weg", () => {
    const c = sanitizeConcept({ optie: "portaal", videoLink: " x ", teksten: { portaal: "Hoi\r\n", hack: "x" }, checks: { portaal: ["portaal", "videolink", "onzin"] }, gekopieerd: { videolink: "geen datum" }, extra: 1 });
    expect(c).toEqual({ optie: "portaal", videoLink: "x", teksten: { portaal: "Hoi\n" }, checks: { portaal: ["portaal"] }, gekopieerd: {} });
    expect(sanitizeConcept(null).optie).toBeNull();
  });

  it("opnames overschrijven elkaar niet en het board stuurt het alleen mee als het mag", async () => {
    await db
      .update(deliverables)
      .set({ whatsappBericht: sanitizeConcept({ optie: "videolink", videoLink: LINK, teksten: { videolink: `Hoi\n${LINK}` } }) })
      .where(eq(deliverables.id, opnameA));
    const { listEditorBoard } = await import("@/server/editor-board");
    const asEditor = viewer("editor-wa@example.com", { id: editorId, isEditorOnly: true });
    const zonder = await listEditorBoard(asEditor);
    expect(zonder.every((v) => v.whatsappBericht === null)).toBe(true);
    const met = await listEditorBoard(asEditor, { withWhatsappBericht: true });
    expect(met.find((v) => v.id === opnameA)?.whatsappBericht?.videoLink).toBe(LINK);
    expect(met.find((v) => v.id === opnameB)?.whatsappBericht).toEqual({ optie: null, videoLink: "", teksten: {}, checks: {}, gekopieerd: {} });
  });

  it("alleen eigenaar en kantoorteam", async () => {
    const { canUseWhatsappBericht } = await import("@/server/whatsapp-bericht-access");
    for (const mail of ["milou@shortclips.nl", "jiska@shortclips.nl", "rutger@shortclips.nl"]) {
      expect(canUseWhatsappBericht(viewer(mail))).toBe(true);
    }
    expect(canUseWhatsappBericht(viewer("x@shortclips.nl", { primaryRole: "owner" } as Partial<Viewer>))).toBe(true);
    expect(canUseWhatsappBericht(viewer("fabian@shortclips.nl", { isEditorOnly: true }))).toBe(false);
    expect(canUseWhatsappBericht(viewer("klant@bedrijf.nl", { isPortalUser: true }))).toBe(false);
    expect(canUseWhatsappBericht(null)).toBe(false);
  });
});
