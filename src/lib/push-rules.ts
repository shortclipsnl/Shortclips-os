/**
 * Spelregels voor pushmeldingen naar klanten. Bewust puur (geen database), zodat
 * ze los te testen zijn en overal hetzelfde werken.
 *
 *  - Stille uren: tussen 21:00 en 08:00 (Nederlandse tijd) gaat er geen push uit.
 *    De melding blijft staan en wordt de volgende ochtend verstuurd.
 *  - Daglimiet: maximaal twee automatische pushmeldingen per klantgebruiker per
 *    dag. Handmatige meldingen van het team tellen niet mee.
 *  - Bundelen: staan er meerdere meldingen van dezelfde soort klaar, dan gaat er
 *    één push uit ("3 nieuwe video's staan klaar").
 */

export const PUSH_TIMEZONE = "Europe/Amsterdam";
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;
export const DAILY_PUSH_LIMIT = 2;

/** Soorten klantmeldingen. Labels zijn wat de klant ziet bij zijn instellingen. */
export const CLIENT_NOTIFICATION_TYPES = [
  { type: "video_review", label: "Video's klaar voor je feedback" },
  { type: "script_review", label: "Scripts klaar voor je akkoord" },
  { type: "opname_reminder", label: "Herinnering opnamedag" },
  { type: "video_published", label: "Video online gezet" },
  { type: "file_comment", label: "Reactie van het team op een video" },
  { type: "content_plan", label: "Contentplanning bijgewerkt" },
  { type: "results", label: "Nieuwe maandresultaten" },
  { type: "manual", label: "Belangrijke updates van Shortclips" },
] as const;

export type ClientNotificationType = (typeof CLIENT_NOTIFICATION_TYPES)[number]["type"];

export const CLIENT_NOTIFICATION_TYPE_SET = new Set<string>(CLIENT_NOTIFICATION_TYPES.map((t) => t.type));

/**
 * Welke voorkeur hoort bij een meldingstype? Scriptcontrole kent eigen typenamen
 * (script_review_ready e.d.); die vallen onder "Scripts klaar voor je akkoord".
 * Geeft null voor typen die nooit als push naar een klant gaan.
 */
export function preferenceTypeFor(type: string): ClientNotificationType | null {
  if (CLIENT_NOTIFICATION_TYPE_SET.has(type)) return type as ClientNotificationType;
  if (type === "script_review_ready" || type === "script_review_reminder") return "script_review";
  return null;
}

/** Uur (0-23) en datum (yyyy-mm-dd) in Nederlandse tijd. */
export function localParts(now: Date): { hour: number; day: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: PUSH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), day: `${parts.year}-${parts.month}-${parts.day}` };
}

export function isQuietHours(now: Date = new Date()): boolean {
  const { hour } = localParts(now);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/** Hoeveel automatische pushmeldingen mogen er nog uit, gegeven wat er vandaag al ging. */
export function remainingToday(sentToday: number): number {
  return Math.max(0, DAILY_PUSH_LIMIT - sentToday);
}

export type PendingPush = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: Date;
};

export type PushPayload = {
  title: string;
  body: string;
  href: string;
  /** Meldingen met dezelfde tag vervangen elkaar op het toestel. */
  tag: string;
  notificationIds: string[];
};

const BUNDLE_TEXT: Record<string, { title: (n: number) => string; body: string; href: string }> = {
  video_review: { title: (n) => `${n} video's staan klaar voor je feedback`, body: "Bekijk ze en geef je akkoord of feedback.", href: "/portal/videos" },
  script_review: { title: (n) => `${n} scripts staan klaar voor je akkoord`, body: "Lees ze rustig door en laat je reactie achter.", href: "/portal/scripts" },
  video_published: { title: (n) => `${n} nieuwe video's staan online`, body: "Bekijk wat er is geplaatst.", href: "/portal/videos" },
  file_comment: { title: (n) => `${n} nieuwe reacties van het team`, body: "Bekijk ze bij je video's.", href: "/portal/videos" },
};

/**
 * Zet wachtende meldingen om naar zo min mogelijk pushberichten: per soort één
 * bericht. Handmatige meldingen worden nooit gebundeld.
 */
export function bundlePending(items: PendingPush[]): PushPayload[] {
  const byType = new Map<string, PendingPush[]>();
  for (const item of items) {
    const key = item.type === "manual" ? `manual:${item.id}` : item.type;
    const list = byType.get(key) ?? [];
    list.push(item);
    byType.set(key, list);
  }

  const payloads: PushPayload[] = [];
  for (const [key, list] of byType) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = list[0]!;
    const bundle = BUNDLE_TEXT[first.type];
    if (list.length > 1 && bundle) {
      payloads.push({
        title: bundle.title(list.length),
        body: bundle.body,
        href: bundle.href,
        tag: key,
        notificationIds: list.map((i) => i.id),
      });
    } else {
      // Geen bundeltekst of één item: het nieuwste item tonen, de rest meenemen.
      const latest = list[list.length - 1]!;
      payloads.push({
        title: latest.title,
        body: latest.body ?? "",
        href: safePortalHref(latest.href),
        tag: key,
        notificationIds: list.map((i) => i.id),
      });
    }
  }

  // Handmatige meldingen eerst, daarna op tijd.
  return payloads.sort((a, b) => Number(b.tag.startsWith("manual:")) - Number(a.tag.startsWith("manual:")));
}

/** Alleen eigen portaalpaden; al het andere valt terug op het overzicht. */
export function safePortalHref(href: string | null | undefined): string {
  if (!href) return "/portal";
  if (!href.startsWith("/portal")) return "/portal";
  if (href.startsWith("//") || href.includes("\\") || href.includes("://")) return "/portal";
  return href;
}

/** Vergrendelscherm-veilige tekst: kort, zonder inhoud van scripts of cijfers. */
export function lockScreenSafe(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
