import { createHash } from "node:crypto";

/**
 * Poortwachter voor publiceren via Metricool.
 *
 * Grondregel: er gaat nooit iets naar Metricool zonder bewuste vrijgave door
 * een medewerker, en alleen precies wat er bij die vrijgave in beeld stond.
 *
 *  - Een vrijgave legt een vingerafdruk vast van klant, Metricool-merk, item,
 *    exacte videoversie, kanalen, caption per kanaal en tijdstip per kanaal.
 *  - Verandert er daarna iets in de planning (datum, tijd, caption, kanaal,
 *    video, verwijderd), dan wordt die wijziging NOOIT automatisch doorgezet.
 *    De vrijgave vervalt en een al ingeplande post gaat in de wacht (concept in
 *    Metricool), zodat hij niet online komt tot iemand opnieuw vrijgeeft.
 *  - Shortclips raakt in Metricool alleen posts aan die het zelf heeft gemaakt
 *    (herkend aan de opgeslagen UUID). Alles wat het team zelf in Metricool zet,
 *    blijft onaangeroerd.
 *
 * Dit bestand is puur (geen database, geen netwerk) zodat elke regel getest is.
 */

export type Network = "instagram" | "tiktok" | "facebook" | "youtube";
export const NETWORKS: readonly Network[] = ["instagram", "tiktok", "facebook", "youtube"];

/** Minimale voorlooptijd: dichter op het tijdstip plannen we niet meer in. */
export const MIN_LEAD_MINUTES = 15;

export type SyncStatus =
  | "niet_verstuurd" // nog nooit naar Metricool
  | "wordt_verstuurd" // slot: er loopt een aanroep
  | "ingepland" // bevestigd door Metricool
  | "in_de_wacht" // als concept in Metricool gezet na een wijziging
  | "gepubliceerd" // gevonden in de statistieken
  | "mislukt"
  | "geannuleerd"
  | "proef"; // proefmodus: alles gecontroleerd, maar niets echt naar Metricool gestuurd

/** Wat er nu in de planning staat voor één publicatie (één kanaal). */
/**
 * Hoe dit kanaal gepost wordt. "handmatig" = het team post zelf in de app van
 * het platform; Shortclips stuurt dan NIETS naar Metricool. "metricool" = via
 * Metricool na vrijgave. Per kanaal te kiezen; standaard uit de klantinstelling.
 * Een kanaal dat niet in Metricool gekoppeld is, kan alleen handmatig.
 */
export type PublishMode = "handmatig" | "metricool";

export type PublicationState = {
  calendarItemId: string;
  /** Gekozen manier van posten voor dit kanaal. */
  mode: PublishMode;
  clientId: string;
  /** Verwijderd uit de planning? */
  itemDeleted: boolean;
  network: Network;
  /** Staat dit kanaal (nog) aan op het planningitem? */
  networkSelected: boolean;
  /** Exacte videoversie die gekoppeld is (video_versions.id), of null. */
  videoVersionId: string | null;
  /** Is die versie de nieuwste én goedgekeurde versie van de video? */
  videoIsLatestApproved: boolean;
  /** Caption zoals die voor dit kanaal gepubliceerd zou worden. */
  caption: string;
  /** Tijdstip voor dit kanaal, ISO met offset (bijv. 2026-11-18T17:30:00+01:00). */
  scheduledFor: string;
  /** Titel (verplicht voor YouTube). */
  title: string;
};

export type ClientPublishing = {
  /** Publiceert Shortclips voor deze klant (clients.we_handle_posting)? */
  weHandlePosting: boolean;
  /** Is publiceren via Metricool voor deze klant expliciet aangezet? */
  metricoolPublishing: boolean;
  /** Metricool-merk (blogId) uit de klantkoppeling, of null. */
  metricoolBlogId: string | null;
  /** Kanalen die bij dit merk in Metricool gekoppeld zijn. */
  connectedNetworks: Network[];
  /** Moet ook de klant goedkeuren? */
  clientApprovalRequired: boolean;
};

export type Release = {
  releasedAt: string;
  releasedById: string;
  /** Vingerafdruk van alles wat bij de vrijgave vastlag. */
  fingerprint: string;
} | null;

export type RemoteState = {
  syncStatus: SyncStatus;
  /** Door ons aangemaakte Metricool-post (UUID blijft gelijk bij wijzigen). */
  metricoolUuid: string | null;
  /** Vingerafdruk waarmee de post in Metricool staat. */
  sentFingerprint: string | null;
};

/* ------------------------------------------------------------------ */

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * Vingerafdruk van één publicatie. Alles wat bepaalt WAT, WAAR en WANNEER er
 * online komt zit erin. Witruimte aan begin en eind van de caption telt niet.
 */
/** Standaardkeuze voor een kanaal: handmatig tenzij de klant op Metricool staat én het kanaal daar gekoppeld is. */
export function defaultMode(network: Network, client: Pick<ClientPublishing, "metricoolPublishing" | "connectedNetworks">): PublishMode {
  return client.metricoolPublishing && client.connectedNetworks.includes(network) ? "metricool" : "handmatig";
}

export function publicationFingerprint(p: PublicationState, blogId: string | null): string {
  const payload = {
    item: p.calendarItemId,
    client: p.clientId,
    blog: blogId,
    network: p.network,
    video: p.videoVersionId,
    caption: p.caption.trim(),
    at: new Date(p.scheduledFor).toISOString(),
    title: p.network === "youtube" ? p.title.trim() : null,
  };
  return createHash("sha256").update(canonical(payload)).digest("hex");
}

/* ------------------------------------------------------------------ */

export type Block = { code: string; message: string };

/**
 * Alle redenen waarom deze publicatie NIET naar Metricool mag. Lege lijst =
 * mag. Wordt in de interface gebruikt (knop uit + uitleg) én op de server
 * vlak voor de aanroep opnieuw gecontroleerd.
 */
export function publishBlocks(input: {
  pub: PublicationState;
  client: ClientPublishing;
  release: Release;
  clientApproved: boolean;
  /** Globale noodschakelaar (instelling). Uit = nooit iets versturen. */
  globalEnabled: boolean;
  now: Date;
}): Block[] {
  const { pub, client, release, now } = input;
  const out: Block[] = [];
  const add = (code: string, message: string) => out.push({ code, message });

  if (pub.mode !== "metricool") add("manual_mode", "Dit kanaal staat op handmatig posten.");
  if (!input.globalEnabled) add("global_off", "Publiceren via Metricool staat uit in de instellingen.");
  if (pub.itemDeleted) add("not_in_planning", "Dit item staat niet (meer) in de contentplanning.");
  if (!client.weHandlePosting) add("client_posts_self", "Deze klant plaatst zelf; Shortclips publiceert niets.");
  if (!client.metricoolPublishing) add("client_not_enabled", "Publiceren via Metricool is voor deze klant niet aangezet.");
  if (!client.metricoolBlogId) add("no_brand", "Deze klant heeft geen Metricool-merk gekoppeld.");
  if (!pub.networkSelected) add("network_not_selected", "Dit kanaal staat niet aan op het planningitem.");
  if (client.metricoolBlogId && !client.connectedNetworks.includes(pub.network))
    add("network_not_connected", `Dit kanaal is niet gekoppeld aan het Metricool-merk van deze klant.`);
  if (!pub.videoVersionId) add("no_video", "Er is geen definitieve video gekoppeld.");
  else if (!pub.videoIsLatestApproved) add("old_video", "De gekoppelde video is niet de nieuwste goedgekeurde versie.");
  if (!pub.caption.trim()) add("no_caption", "De caption is leeg.");
  if (pub.network === "youtube" && !pub.title.trim()) add("no_title", "YouTube vraagt een titel.");

  const at = new Date(pub.scheduledFor);
  if (Number.isNaN(at.getTime())) add("bad_time", "Het tijdstip is ongeldig.");
  else if (at.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60_000)
    add("too_late", `Het tijdstip ligt in het verleden of binnen ${MIN_LEAD_MINUTES} minuten.`);

  if (client.clientApprovalRequired && !input.clientApproved) add("client_approval", "De klant moet deze publicatie nog goedkeuren.");

  if (!release) add("not_released", "Nog niet vrijgegeven door een medewerker.");
  else if (release.fingerprint !== publicationFingerprint(pub, client.metricoolBlogId))
    add("changed_after_release", "Er is iets gewijzigd na de vrijgave. Controleer en geef opnieuw vrij.");

  return out;
}

/* ------------------------------------------------------------------ */

export type SyncAction =
  | { kind: "create" } // nieuwe post maken
  | { kind: "update" } // bestaande eigen post bijwerken (zelfde UUID)
  | { kind: "hold"; reason: string } // eigen post als concept in de wacht zetten
  | { kind: "delete"; reason: string } // eigen post verwijderen (alleen bij annuleren)
  | { kind: "none"; reason: string };

/**
 * Wat moet er met Metricool gebeuren? Wordt aangeroepen bij een vrijgave en
 * door de controle om de 15 minuten. Kiest bij twijfel altijd voor "niets doen"
 * of "in de wacht": nooit voor publiceren.
 */
export function decideSync(input: {
  blocks: Block[];
  remote: RemoteState;
  release: Release;
  currentFingerprint: string;
  cancelled: boolean;
  mode: PublishMode;
}): SyncAction {
  const { blocks, remote, cancelled } = input;
  const ours = Boolean(remote.metricoolUuid);

  if (remote.syncStatus === "wordt_verstuurd") return { kind: "none", reason: "Er loopt al een verzending." };
  if (remote.syncStatus === "gepubliceerd") return { kind: "none", reason: "Al gepubliceerd; gepubliceerde posts worden niet gewijzigd." };

  // Overgezet naar handmatig terwijl er al een eigen post in Metricool staat:
  // die post moet weg, anders komt de video er twee keer op.
  if (input.mode === "handmatig") return ours ? { kind: "delete", reason: "Overgezet naar handmatig posten." } : { kind: "none", reason: "Handmatig posten: Shortclips stuurt niets naar Metricool." };

  if (cancelled) return ours ? { kind: "delete", reason: "Geannuleerd in Shortclips." } : { kind: "none", reason: "Geannuleerd, niets in Metricool." };

  if (blocks.length > 0) {
    // Mag niet (meer) online. Staat er al een eigen post klaar, dan direct in de wacht.
    if (ours && remote.syncStatus === "ingepland") return { kind: "hold", reason: blocks[0]!.message };
    return { kind: "none", reason: blocks[0]!.message };
  }

  // Vanaf hier: vrijgegeven en alles klopt.
  if (!ours) return { kind: "create" };
  if (remote.sentFingerprint === input.currentFingerprint && remote.syncStatus === "ingepland")
    return { kind: "none", reason: "Staat al zo in Metricool." };
  return { kind: "update" };
}

/* ------------------------------------------------------------------ */

/**
 * Vergelijkt een eigen post zoals Metricool die teruggeeft met wat wij hebben
 * verstuurd. Wijkt iets af (iemand heeft rechtstreeks in Metricool gewerkt),
 * dan is dat een conflict: het systeem zet niets stil terug en publiceert niets
 * anders, maar zet de post in de wacht en meldt het.
 */
export function remoteDiffers(sent: { text: string; at: string; network: Network }, remote: { text: string; at: string; networks: string[]; draft: boolean }): string | null {
  if (remote.draft) return null; // in de wacht is veilig
  if (remote.networks.length !== 1 || remote.networks[0] !== sent.network) return "Kanalen in Metricool wijken af.";
  if (new Date(remote.at).getTime() !== new Date(sent.at).getTime()) return "Tijdstip in Metricool wijkt af.";
  if (remote.text.trim() !== sent.text.trim()) return "Caption in Metricool wijkt af.";
  return null;
}
