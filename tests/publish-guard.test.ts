import { describe, expect, it } from "vitest";
import {
  decideSync,
  defaultMode,
  publicationFingerprint,
  publishBlocks,
  remoteDiffers,
  type ClientPublishing,
  type PublicationState,
  type Release,
  type RemoteState,
} from "@/lib/publish-guard";
import { amsterdamLocal, buildMetricoolPost } from "@/lib/metricool-payload";
import { findOwn, MetricoolScheduler, type ScheduledPost } from "@/server/integrations/metricool-scheduler";

/**
 * Publiceren via Metricool: de veiligheidsregels.
 * Uitgangspunt van Jarno: niets gaat online zonder bewuste vrijgave, alleen op
 * het juiste kanaal, nooit iets wat niet in de planning staat, en een latere
 * wijziging van de planning wordt nooit ongemerkt doorgezet.
 */

const NOW = new Date("2026-11-12T10:00:00+01:00");

const pub = (o: Partial<PublicationState> = {}): PublicationState => ({
  calendarItemId: "item-1",
  mode: "metricool",
  clientId: "client-auto-christiaan",
  itemDeleted: false,
  network: "instagram",
  networkSelected: true,
  videoVersionId: "video-v3",
  videoIsLatestApproved: true,
  caption: "Een M3 Touring met 312 km op de teller.",
  scheduledFor: "2026-11-18T17:30:00+01:00",
  title: "BMW M3 Touring",
  ...o,
});

const client = (o: Partial<ClientPublishing> = {}): ClientPublishing => ({
  weHandlePosting: true,
  metricoolPublishing: true,
  metricoolBlogId: "5169272",
  connectedNetworks: ["instagram", "tiktok", "facebook"],
  clientApprovalRequired: false,
  ...o,
});

const releaseFor = (p: PublicationState, c = client()): Release => ({
  releasedAt: NOW.toISOString(),
  releasedById: "milou",
  fingerprint: publicationFingerprint(p, c.metricoolBlogId),
});

const blocks = (p: PublicationState, c = client(), r: Release = releaseFor(p, c), extra: { clientApproved?: boolean; globalEnabled?: boolean; now?: Date } = {}) =>
  publishBlocks({ pub: p, client: c, release: r, clientApproved: extra.clientApproved ?? false, globalEnabled: extra.globalEnabled ?? true, now: extra.now ?? NOW }).map((b) => b.code);

const fresh: RemoteState = { syncStatus: "niet_verstuurd", metricoolUuid: null, sentFingerprint: null };

describe("vrijgave is altijd nodig", () => {
  it("vrijgegeven en alles klopt: mag naar Metricool", () => {
    expect(blocks(pub())).toEqual([]);
  });
  it("zonder vrijgave gaat er niets", () => {
    expect(blocks(pub(), client(), null)).toContain("not_released");
    expect(decideSync({ blocks: publishBlocks({ pub: pub(), client: client(), release: null, clientApproved: false, globalEnabled: true, now: NOW }), remote: fresh, release: null, currentFingerprint: "x", cancelled: false, mode: "metricool" }).kind).toBe("none");
  });
  it("noodschakelaar uit: niets", () => {
    expect(blocks(pub(), client(), releaseFor(pub()), { globalEnabled: false })).toContain("global_off");
  });
  it("klant niet aangezet voor Metricool of klant post zelf: niets", () => {
    expect(blocks(pub(), client({ metricoolPublishing: false }))).toContain("client_not_enabled");
    expect(blocks(pub(), client({ weHandlePosting: false }))).toContain("client_posts_self");
  });
  it("klantgoedkeuring vereist en nog niet gegeven: niets", () => {
    expect(blocks(pub(), client({ clientApprovalRequired: true }))).toContain("client_approval");
    expect(blocks(pub(), client({ clientApprovalRequired: true }), releaseFor(pub()), { clientApproved: true })).toEqual([]);
  });
});

describe("alleen het juiste kanaal en het juiste account", () => {
  it("kanaal niet gekoppeld bij het merk van deze klant: geblokkeerd", () => {
    const p = pub({ network: "youtube" });
    expect(blocks(p, client(), releaseFor(p))).toContain("network_not_connected");
  });
  it("kanaal uitgezet op het planningitem: geblokkeerd", () => {
    const p = pub({ networkSelected: false });
    expect(blocks(p, client(), releaseFor(p))).toContain("network_not_selected");
  });
  it("geen Metricool-merk: geblokkeerd", () => {
    const c = client({ metricoolBlogId: null });
    expect(blocks(pub(), c, releaseFor(pub(), c))).toContain("no_brand");
  });
  it("merk van de klant gewijzigd na vrijgave: vrijgave vervalt", () => {
    expect(blocks(pub(), client({ metricoolBlogId: "9999999" }), releaseFor(pub()))).toContain("changed_after_release");
  });
  it("de post gaat altijd naar precies één kanaal", () => {
    const body = buildMetricoolPost(pub({ network: "tiktok" }), { mediaUrl: "https://x/v.mp4" }, { finalConfirmInApp: true });
    expect(body.providers).toEqual([{ network: "tiktok" }]);
    expect(body.instagramData).toBeUndefined();
    expect(body.tiktokData).toBeDefined();
  });
});

describe("nooit iets wat niet (meer) in de planning staat", () => {
  it("item verwijderd uit de planning: geblokkeerd", () => {
    expect(blocks(pub({ itemDeleted: true }))).toContain("not_in_planning");
  });
  it("item verwijderd terwijl de post al in Metricool staat: in de wacht, niet online", () => {
    const p = pub({ itemDeleted: true });
    const action = decideSync({ blocks: publishBlocks({ pub: p, client: client(), release: releaseFor(pub()), clientApproved: false, globalEnabled: true, now: NOW }), remote: { syncStatus: "ingepland", metricoolUuid: "uuid-1", sentFingerprint: "f" }, release: releaseFor(pub()), currentFingerprint: "g", cancelled: false, mode: "metricool" });
    expect(action.kind).toBe("hold");
  });
  it("geen definitieve of een oude videoversie: geblokkeerd", () => {
    expect(blocks(pub({ videoVersionId: null }))).toContain("no_video");
    const old = pub({ videoIsLatestApproved: false });
    expect(blocks(old, client(), releaseFor(old))).toContain("old_video");
  });
});

describe("latere wijzigingen in de planning worden nooit ongemerkt doorgezet", () => {
  const released = pub();
  const rel = releaseFor(released);
  const scheduled: RemoteState = { syncStatus: "ingepland", metricoolUuid: "uuid-1", sentFingerprint: rel!.fingerprint };
  const cases: Array<[string, Partial<PublicationState>]> = [
    ["datum of tijd verschoven", { scheduledFor: "2026-11-25T17:30:00+01:00" }],
    ["caption aangepast", { caption: "Andere tekst" }],
    ["nieuwe videoversie", { videoVersionId: "video-v4" }],
    ["ander planningitem", { calendarItemId: "item-2" }],
  ];
  for (const [name, change] of cases) {
    it(`${name}: vrijgave vervalt en de geplande post gaat in de wacht`, () => {
      const now = pub(change);
      const b = publishBlocks({ pub: now, client: client(), release: rel, clientApproved: false, globalEnabled: true, now: NOW });
      expect(b.map((x) => x.code)).toContain("changed_after_release");
      const action = decideSync({ blocks: b, remote: scheduled, release: rel, currentFingerprint: publicationFingerprint(now, "5169272"), cancelled: false, mode: "metricool" });
      expect(action.kind).toBe("hold");
    });
  }
  it("alleen witruimte rond de caption veranderd: telt niet als wijziging", () => {
    expect(blocks(pub({ caption: "  Een M3 Touring met 312 km op de teller.\n" }), client(), rel)).toEqual([]);
  });
  it("een hele planning in één keer verschoven: elk item gaat in de wacht, niets wordt bijgewerkt of gepubliceerd", () => {
    const items = Array.from({ length: 20 }, (_, i) => pub({ calendarItemId: `item-${i}` }));
    const actions = items.map((p) => {
      const r = releaseFor(p);
      const moved = { ...p, scheduledFor: "2026-12-01T09:00:00+01:00" };
      const b = publishBlocks({ pub: moved, client: client(), release: r, clientApproved: false, globalEnabled: true, now: NOW });
      return decideSync({ blocks: b, remote: { syncStatus: "ingepland", metricoolUuid: `u-${p.calendarItemId}`, sentFingerprint: r!.fingerprint }, release: r, currentFingerprint: "x", cancelled: false, mode: "metricool" }).kind;
    });
    expect(new Set(actions)).toEqual(new Set(["hold"]));
  });
  it("na opnieuw vrijgeven: de bestaande post wordt bijgewerkt, er komt geen tweede", () => {
    const moved = pub({ scheduledFor: "2026-11-25T17:30:00+01:00" });
    const r2 = releaseFor(moved);
    const action = decideSync({ blocks: publishBlocks({ pub: moved, client: client(), release: r2, clientApproved: false, globalEnabled: true, now: NOW }), remote: { syncStatus: "in_de_wacht", metricoolUuid: "uuid-1", sentFingerprint: rel!.fingerprint }, release: r2, currentFingerprint: publicationFingerprint(moved, "5169272"), cancelled: false, mode: "metricool" });
    expect(action.kind).toBe("update");
  });
});

describe("dubbele posts voorkomen", () => {
  const p = pub();
  const r = releaseFor(p);
  const fp = publicationFingerprint(p, "5169272");
  it("eerste keer: aanmaken", () => {
    expect(decideSync({ blocks: [], remote: fresh, release: r, currentFingerprint: fp, cancelled: false, mode: "metricool" }).kind).toBe("create");
  });
  it("al ingepland met dezelfde inhoud: niets doen", () => {
    expect(decideSync({ blocks: [], remote: { syncStatus: "ingepland", metricoolUuid: "u", sentFingerprint: fp }, release: r, currentFingerprint: fp, cancelled: false, mode: "metricool" }).kind).toBe("none");
  });
  it("verzending loopt al (dubbelklik, tweede tabblad): niets doen", () => {
    expect(decideSync({ blocks: [], remote: { syncStatus: "wordt_verstuurd", metricoolUuid: null, sentFingerprint: null }, release: r, currentFingerprint: fp, cancelled: false, mode: "metricool" }).kind).toBe("none");
  });
  it("na een time-out: de al aangemaakte post wordt teruggevonden in plaats van opnieuw gemaakt", () => {
    const body = buildMetricoolPost(p, { mediaUrl: "https://x/v.mp4" }, { finalConfirmInApp: true });
    const remote: ScheduledPost[] = [
      { id: "1", uuid: "a", text: body.text, at: body.publicationDate.dateTime, networks: ["instagram"], draft: false },
      { id: "2", uuid: "b", text: "Post die het team zelf maakte", at: body.publicationDate.dateTime, networks: ["instagram"], draft: false },
    ];
    expect(findOwn(remote, body)?.uuid).toBe("a");
    expect(findOwn([remote[1]!], body)).toBeNull();
  });
  it("gepubliceerde posts worden nooit meer gewijzigd", () => {
    expect(decideSync({ blocks: [], remote: { syncStatus: "gepubliceerd", metricoolUuid: "u", sentFingerprint: "old" }, release: r, currentFingerprint: fp, cancelled: false, mode: "metricool" }).kind).toBe("none");
  });
});

describe("tijd en Metricool-instellingen", () => {
  it("tijdstip in het verleden of binnen 15 minuten: geblokkeerd", () => {
    const p = pub({ scheduledFor: "2026-11-12T10:10:00+01:00" });
    expect(blocks(p, client(), releaseFor(p))).toContain("too_late");
  });
  it("tijd gaat in Amsterdamse tijd naar Metricool, ook rond de wintertijd", () => {
    expect(amsterdamLocal("2026-11-18T16:30:00Z")).toBe("2026-11-18T17:30:00");
    expect(amsterdamLocal("2026-07-01T15:30:00Z")).toBe("2026-07-01T17:30:00");
  });
  it("standaard laatste bevestiging in de Metricool-app (autoPublish uit)", () => {
    expect(buildMetricoolPost(pub(), { mediaUrl: "u" }, { finalConfirmInApp: true }).autoPublish).toBe(false);
  });
  it("YouTube vraagt een titel", () => {
    const p = pub({ network: "youtube", title: " " });
    expect(blocks(p, client({ connectedNetworks: ["youtube"] }), releaseFor(p, client({ connectedNetworks: ["youtube"] })))).toContain("no_title");
  });
});

describe("conflict: iemand wijzigt de post rechtstreeks in Metricool", () => {
  const sent = { text: "Caption", at: "2026-11-18T17:30:00", network: "instagram" as const };
  it("andere tijd of tekst wordt herkend", () => {
    expect(remoteDiffers(sent, { text: "Caption", at: "2026-11-18T18:15:00", networks: ["instagram"], draft: false })).toMatch(/Tijdstip/);
    expect(remoteDiffers(sent, { text: "Anders", at: sent.at, networks: ["instagram"], draft: false })).toMatch(/Caption/);
    expect(remoteDiffers(sent, { text: "Caption", at: sent.at, networks: ["instagram", "facebook"], draft: false })).toMatch(/Kanalen/);
    expect(remoteDiffers(sent, { ...sent, networks: ["instagram"], draft: false })).toBeNull();
  });
});

describe("proefmodus", () => {
  it("zonder METRICOOL_PUBLISHING_ENABLED wordt er niets naar Metricool gestuurd", async () => {
    const s = new MetricoolScheduler("token", false);
    expect(s.isLive).toBe(false);
    const res = await s.create("1", "2", buildMetricoolPost(pub(), { mediaUrl: "u" }, { finalConfirmInApp: true }));
    expect(res.dryRun).toBe(true);
  });
  it("wijzigen of verwijderen zonder eigen UUID wordt geweigerd", async () => {
    const s = new MetricoolScheduler("token", false);
    await expect(s.remove("1", "2", "99", "")).rejects.toThrow(/geen post van Shortclips/);
  });
});

describe("handmatig posten of via Metricool", () => {
  it("handmatig: er gaat nooit iets naar Metricool, ook niet als alles klopt", () => {
    const p = pub({ mode: "handmatig" });
    expect(blocks(p, client(), releaseFor(p))).toContain("manual_mode");
    expect(decideSync({ blocks: [], remote: fresh, release: releaseFor(p), currentFingerprint: "x", cancelled: false, mode: "handmatig" }).kind).toBe("none");
  });
  it("van Metricool naar handmatig terwijl de post al ingepland staat: Metricool-post wordt verwijderd, geen dubbele plaatsing", () => {
    expect(decideSync({ blocks: [], remote: { syncStatus: "ingepland", metricoolUuid: "u", sentFingerprint: "f" }, release: null, currentFingerprint: "f", cancelled: false, mode: "handmatig" }).kind).toBe("delete");
  });
  it("standaard: handmatig, tenzij de klant op Metricool staat en het kanaal gekoppeld is", () => {
    expect(defaultMode("instagram", { metricoolPublishing: false, connectedNetworks: ["instagram"] })).toBe("handmatig");
    expect(defaultMode("youtube", { metricoolPublishing: true, connectedNetworks: ["instagram"] })).toBe("handmatig");
    expect(defaultMode("instagram", { metricoolPublishing: true, connectedNetworks: ["instagram"] })).toBe("metricool");
  });
});

describe("op Metricool zetten is nog geen publiceren", () => {
  it("alleen het kanaal op Metricool zetten, zonder vrijgave: er wordt niets aangemaakt", () => {
    const p = pub({ mode: "metricool" });
    const b = publishBlocks({ pub: p, client: client(), release: null, clientApproved: false, globalEnabled: true, now: NOW });
    expect(b.map((x) => x.code)).toEqual(["not_released"]);
    expect(decideSync({ blocks: b, remote: fresh, release: null, currentFingerprint: publicationFingerprint(p, "5169272"), cancelled: false, mode: "metricool" }).kind).toBe("none");
  });
  it("zelfs met vrijgave gaat er niets uit zolang de noodschakelaar uit staat (standaard)", () => {
    const p = pub();
    const b = publishBlocks({ pub: p, client: client(), release: releaseFor(p), clientApproved: false, globalEnabled: false, now: NOW });
    expect(decideSync({ blocks: b, remote: fresh, release: releaseFor(p), currentFingerprint: publicationFingerprint(p, "5169272"), cancelled: false, mode: "metricool" }).kind).toBe("none");
  });
  it("standaard staat de klant op handmatig, dus een nieuw kanaal begint nooit op Metricool", () => {
    expect(defaultMode("instagram", { metricoolPublishing: false, connectedNetworks: ["instagram", "tiktok", "facebook", "youtube"] })).toBe("handmatig");
  });
});
