/**
 * Statusoverzicht "Jouw contentplanning" — één bron voor het klantportaal én
 * de contentplanning-PDF. Puur (geen database), zodat het te testen is en
 * portaal en PDF altijd exact hetzelfde laten zien.
 *
 * Uitgangspunt: een onderdeel staat alleen op "afgerond" als de gegevens in de
 * planning dat aantonen. Ontbreekt er iets, dan tonen we eerlijk "in
 * voorbereiding" of "actie nodig"; er wordt niets aangevuld of verzonnen.
 */

export type ChecklistState = "done" | "preparing" | "action" | "na";

export type ChecklistItem = {
  key: "videos" | "dates" | "platforms" | "captions" | "publishing" | "client";
  /** Korte titel, bijv. "Video's geproduceerd". */
  title: string;
  /** Eén regel uitleg op basis van de echte gegevens. */
  detail: string;
  state: ChecklistState;
  /** Wie is aan zet: Shortclips of de klant (voor de scheiding in de weergave). */
  owner: "shortclips" | "klant";
  /** Optionele link in het portaal (alleen bij klantacties). */
  href?: string;
};

export const STATE_LABEL: Record<ChecklistState, string> = {
  done: "Afgerond",
  preparing: "In voorbereiding",
  action: "Actie nodig",
  na: "Niet van toepassing",
};

/** Video-statussen waarin de montage klaar en goedgekeurd is. */
const VIDEO_READY = new Set(["approved", "ready_to_publish", "scheduled", "published", "analysis_available"]);

export type ChecklistPost = {
  status: string; // to_prepare | ready | scheduled | published | failed
  scheduledOn: string;
  scheduledAt: string | null;
  platforms: string[];
  caption: string | null;
  /** Status van de gekoppelde video (deliverable), of null als er geen koppeling is. */
  videoStatus: string | null;
};

export type ChecklistInput = {
  weHandlePosting: boolean;
  /** Gedeelde posts vanaf deze week (inclusief al gepubliceerde van deze week). */
  posts: ChecklistPost[];
  /** Video's die op feedback van de klant wachten (status client_review). */
  videosAwaitingClient: number;
  /** Scripts die op feedback van de klant wachten (status client_review). */
  scriptsAwaitingClient: number;
  /** Vandaag als YYYY-MM-DD (Europe/Amsterdam). */
  today: string;
};

export type Checklist = {
  items: ChecklistItem[];
  /** Kop bovenaan: "Alles staat klaar." alleen als dat ook zo is. */
  headline: string;
  subline: string;
  allDone: boolean;
  needsClient: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function buildPlanningChecklist(input: ChecklistInput): Checklist {
  const { posts, weHandlePosting, today } = input;
  const total = posts.length;
  const items: ChecklistItem[] = [];

  if (total === 0) {
    // Nog niets gedeeld vanaf deze week: niets kan "afgerond" zijn.
    const prep = (key: ChecklistItem["key"], title: string, detail: string): ChecklistItem => ({ key, title, detail, state: "preparing", owner: "shortclips" });
    items.push(prep("videos", "Video's geproduceerd", "De volgende video's worden voorbereid."));
    items.push(prep("dates", "Publicatiedatums ingepland", "De planning voor de komende periode volgt."));
    items.push(prep("platforms", "Verdeeld over je kanalen", "Volgt zodra de planning klaarstaat."));
    items.push(prep("captions", "Titels en captions", "Volgt zodra de planning klaarstaat."));
  } else {
    // 1. Video's: klaar als de post zelf klaar/ingepland/online is, of de
    //    gekoppelde video goedgekeurd is.
    const videoReady = posts.filter((p) => ["ready", "scheduled", "published"].includes(p.status) || (p.videoStatus != null && VIDEO_READY.has(p.videoStatus))).length;
    items.push({
      key: "videos",
      title: "Video's geproduceerd",
      detail: videoReady === total ? `${plural(total, "video staat", "video's staan")} klaar.` : `${videoReady} van ${total} video's klaar, de rest is in productie.`,
      state: videoReady === total ? "done" : "preparing",
      owner: "shortclips",
    });

    // 2. Datums en tijdstippen.
    const withTime = posts.filter((p) => Boolean(p.scheduledAt)).length;
    items.push({
      key: "dates",
      title: "Publicatiedatums ingepland",
      detail: withTime === total ? `Alle ${plural(total, "publicatie", "publicaties")} hebben een vaste dag en tijd.` : `Datums staan vast; ${total - withTime} ${total - withTime === 1 ? "tijdstip volgt" : "tijdstippen volgen"} nog.`,
      state: withTime === total ? "done" : "preparing",
      owner: "shortclips",
    });

    // 3. Kanalen.
    const withPlatform = posts.filter((p) => p.platforms.length > 0).length;
    const uniq = [...new Set(posts.flatMap((p) => p.platforms))];
    const names: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", linkedin: "LinkedIn" };
    const list = uniq.map((u) => names[u] ?? u);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(", ")} en ${list[list.length - 1]}` : list[0] ?? "";
    items.push({
      key: "platforms",
      title: "Verdeeld over je kanalen",
      detail: withPlatform === total ? `Ingepland op ${joined}.` : `${total - withPlatform} ${total - withPlatform === 1 ? "publicatie wacht" : "publicaties wachten"} nog op een kanaal.`,
      state: withPlatform === total ? "done" : "preparing",
      owner: "shortclips",
    });

    // 4. Captions.
    const withCaption = posts.filter((p) => (p.caption ?? "").trim().length > 0).length;
    items.push({
      key: "captions",
      title: "Titels en captions",
      detail: withCaption === total ? "Geschreven en klaar voor publicatie." : `${withCaption} van ${total} captions klaar, de rest volgt.`,
      state: withCaption === total ? "done" : "preparing",
      owner: "shortclips",
    });
  }

  // 5. Publicatie door Shortclips.
  const open = posts.filter((p) => p.status !== "published");
  if (!weHandlePosting) {
    items.push({ key: "publishing", title: "Publicatie door Shortclips", detail: "Je plaatst de video's zelf, wij zorgen dat alles klaarstaat.", state: "na", owner: "shortclips" });
  } else if (total === 0) {
    items.push({ key: "publishing", title: "Publicatie door Shortclips", detail: "Wij plaatsen je video's. Je hoeft hier niets voor te doen.", state: "preparing", owner: "shortclips" });
  } else {
    const notScheduled = open.filter((p) => p.status !== "scheduled").length;
    items.push({
      key: "publishing",
      title: "Publicatie door Shortclips",
      detail: notScheduled === 0 ? "Alles staat klaar om automatisch online te gaan. Je hoeft niets te doen." : `Wij zetten ${plural(notScheduled, "video", "video's")} nog klaar voor publicatie. Je hoeft niets te doen.`,
      state: notScheduled === 0 ? "done" : "preparing",
      owner: "shortclips",
    });
  }

  // 6. Wat ligt er bij de klant?
  const asks: string[] = [];
  let href: string | undefined;
  if (input.videosAwaitingClient > 0) { asks.push(`${plural(input.videosAwaitingClient, "video wacht", "video's wachten")} op je feedback`); href = "/portal/videos"; }
  if (input.scriptsAwaitingClient > 0) { asks.push(`${plural(input.scriptsAwaitingClient, "script wacht", "scripts wachten")} op je akkoord`); href ??= "/portal/scripts"; }
  if (!weHandlePosting) {
    const toPost = open.filter((p) => p.scheduledOn >= today);
    const overdue = open.filter((p) => p.scheduledOn < today).length;
    if (toPost.length > 0) asks.push(`${plural(toPost.length, "video", "video's")} zelf plaatsen, eerstvolgende op ${dayLabel(toPost[0]!.scheduledOn)}`);
    if (overdue > 0) asks.push(`${plural(overdue, "video staat", "video's staan")} nog niet online`);
  }
  items.push({
    key: "client",
    title: "Wat we van jou nodig hebben",
    detail: asks.length === 0 ? "Er ligt op dit moment niets bij jou." : `${asks.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()),
    state: asks.length === 0 ? "done" : "action",
    owner: "klant",
    href,
  });

  const needsClient = items.some((i) => i.state === "action");
  const allDone = items.every((i) => i.state === "done" || i.state === "na");
  const headline = allDone ? "Alles staat klaar." : needsClient ? "Er is een actie van jou nodig." : "Je planning wordt afgerond.";
  const subline = allDone
    ? weHandlePosting
      ? "Alles staat klaar om impact te maken. Wij regelen de publicatie, jij hoeft niets te doen."
      : "Alles staat klaar om impact te maken. De video's staan voor je klaar om te plaatsen."
    : needsClient
      ? "Bijna alles is geregeld. Hieronder zie je wat er nog van jou nodig is."
      : "Shortclips rondt de laatste onderdelen af. Je hoeft nu niets te doen.";
  return { items, headline, subline, allDone, needsClient };
}

/**
 * De vier blokken op de PDF-pagina "Jouw contentplanning. Alles staat klaar."
 * in de volgorde van het sjabloon: Captions en CTA's, Publicatie en timing,
 * Kanalen en instellingen, Optimalisatie. Zelfde bron als het portaal.
 */
export function pdfCardStates(c: Checklist, report: "recent" | "none"): ChecklistState[] {
  const st = (k: ChecklistItem["key"]) => c.items.find((i) => i.key === k)?.state ?? "preparing";
  const pub = st("publishing");
  const timing: ChecklistState = st("dates") === "done" && (pub === "done" || pub === "na") ? "done" : "preparing";
  return [st("captions") === "done" ? "done" : "preparing", timing, st("platforms") === "done" ? "done" : "preparing", report === "recent" ? "done" : "preparing"];
}

export const PDF_NOT_READY = {
  headline: "Bijna alles staat klaar.",
  subline: "Een paar onderdelen zijn nog in voorbereiding. Zodra alles klaarstaat, zie je dat hier en in je portaal.",
};
