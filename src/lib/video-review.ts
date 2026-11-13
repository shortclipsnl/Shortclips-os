/**
 * Videobeoordeling in het klantportaal: de status per video, afgeleid uit
 * wat er werkelijk vastligt (sessiestatus van het editingproject, goedkeuringen
 * en verstuurde feedback per versie). Puur en zonder database, zodat het
 * overal hetzelfde rekent en los te testen is.
 *
 * Eén bron per vraag:
 *  - "staat de sessie bij de klant?"   → status van het editingproject (deliverable)
 *  - "is deze versie goedgekeurd?"     → portal_video_approvals (per versie)
 *  - "is er feedback op deze versie?"  → portal_video_comments (per versie)
 * Daardoor kunnen klant en team nooit twee tegenstrijdige statussen zien.
 */

export type VideoReviewKey = "wacht" | "feedback_ontvangen" | "feedback_verwerken" | "opnieuw_beoordelen" | "goedgekeurd";

export const VIDEO_REVIEW_LABEL: Record<VideoReviewKey, string> = {
  wacht: "Wacht op beoordeling",
  feedback_ontvangen: "Feedback ontvangen",
  feedback_verwerken: "Feedback wordt verwerkt",
  opnieuw_beoordelen: "Opnieuw beoordelen",
  goedgekeurd: "Goedgekeurd",
};

export const VIDEO_REVIEW_TONE: Record<VideoReviewKey, "orange" | "blue" | "green"> = {
  wacht: "orange",
  feedback_ontvangen: "blue",
  feedback_verwerken: "blue",
  opnieuw_beoordelen: "orange",
  goedgekeurd: "green",
};

/** Sessiestatus zoals het portaal die al kent (zie portal-frame.ts). */
export type SessionKey = "feedback" | "verwerken" | "goedgekeurd" | "online" | "productie" | null;

export type ReviewInput = {
  session: SessionKey;
  /** Ruwe status van het editingproject, voor "editor is bezig". */
  deliverableStatus: string | null;
  currentMediaFileId: string;
  approvedMediaFileIds: string[];
  /** Verstuurde klantopmerkingen (geen concepten, geen editorreacties). */
  submitted: Array<{ mediaFileId: string; completed: boolean }>;
};

export type ReviewState = {
  key: VideoReviewKey | null;
  /** Mag de klant nu feedback plaatsen en goedkeuren? */
  canReview: boolean;
};

const EDITOR_BUSY = new Set(["editing", "editor_revision", "internal_review", "awaiting_editor"]);

export function videoReviewState(i: ReviewInput): ReviewState {
  if (i.approvedMediaFileIds.includes(i.currentMediaFileId)) return { key: "goedgekeurd", canReview: false };

  const onCurrent = i.submitted.filter((c) => c.mediaFileId === i.currentMediaFileId);
  const onOlder = i.submitted.filter((c) => c.mediaFileId !== i.currentMediaFileId);

  if (onCurrent.length > 0) {
    const allDone = onCurrent.every((c) => c.completed);
    const busy = (i.deliverableStatus && EDITOR_BUSY.has(i.deliverableStatus)) || onCurrent.some((c) => c.completed);
    // Alles afgevinkt maar nog geen nieuwe versie: de editor is bezig met opleveren.
    const key: VideoReviewKey = allDone || busy ? "feedback_verwerken" : "feedback_ontvangen";
    // Aanvullen of alsnog goedkeuren blijft mogelijk zolang de sessie bij de klant ligt.
    return { key, canReview: i.session === "feedback" || i.session === "verwerken" };
  }

  // Sessie als geheel goedgekeurd of online: niet opnieuw aanbieden.
  if (i.session === "goedgekeurd" || i.session === "online") return { key: "goedgekeurd", canReview: false };

  if (onOlder.length > 0 && (i.session === "feedback" || i.session === "verwerken")) {
    return { key: "opnieuw_beoordelen", canReview: true };
  }

  if (i.session === "feedback" || i.session === "verwerken") return { key: "wacht", canReview: true };

  // Geen gekoppeld editingproject of nog in productie: alleen bekijken.
  return { key: null, canReview: false };
}

/** "3 goedgekeurd · 2 wachten op beoordeling · 1 feedback ontvangen" */
export function reviewSummary(keys: Array<VideoReviewKey | null>): Array<{ key: VideoReviewKey; count: number; label: string }> {
  const order: VideoReviewKey[] = ["goedgekeurd", "wacht", "opnieuw_beoordelen", "feedback_ontvangen", "feedback_verwerken"];
  const plural: Record<VideoReviewKey, [string, string]> = {
    goedgekeurd: ["goedgekeurd", "goedgekeurd"],
    wacht: ["wacht op beoordeling", "wachten op beoordeling"],
    opnieuw_beoordelen: ["opnieuw te beoordelen", "opnieuw te beoordelen"],
    feedback_ontvangen: ["feedback ontvangen", "feedback ontvangen"],
    feedback_verwerken: ["feedback in verwerking", "feedback in verwerking"],
  };
  return order
    .map((key) => {
      const count = keys.filter((k) => k === key).length;
      return { key, count, label: `${count} ${count === 1 ? plural[key][0] : plural[key][1]}` };
    })
    .filter((x) => x.count > 0);
}

/** Seconden → Frame.io V4-framestempel (beeldnummer). Getest tegen echte
 *  opmerkingen: 295 bij 50 fps = 00:00:05:45. */
export function secondsToFramestamp(seconds: number, fps: number | null | undefined): number {
  const rate = fps && fps > 0 && fps < 241 ? fps : 25;
  return Math.max(0, Math.round(seconds * rate));
}

export function framestampToMs(stamp: number, fps: number | null | undefined): number {
  const rate = fps && fps > 0 && fps < 241 ? fps : 25;
  return Math.max(0, Math.round((stamp / rate) * 1000));
}

/** 18500 → "0:18" ; 75000 → "1:15" */
export function formatTimecode(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Tekst zoals hij in Frame.io verschijnt: altijd herkenbaar als klantfeedback. */
export function frameCommentText(c: { authorName: string | null; clientName: string; body: string; replyTo?: string | null }): string {
  const who = c.authorName ? `${c.authorName} (${c.clientName})` : c.clientName;
  const prefix = c.replyTo ? `Reactie van ${who} op "${c.replyTo.slice(0, 80)}${c.replyTo.length > 80 ? "…" : ""}"` : `Klantfeedback van ${who}`;
  return `${prefix} via het Shortclips portaal:\n${c.body}`;
}

/** Is dit een opmerking die het portaal zelf in Frame.io heeft gezet? */
export function isPortalFrameText(text: string | null | undefined): boolean {
  return !!text && /via het Shortclips portaal:/.test(text);
}

/**
 * Hoort een opmerking uit Frame.io (van het team) als antwoord bij een
 * klantopmerking? Frame.io V4 geeft bij reacties geen ouder-id mee, dus we
 * koppelen alleen bij een duidelijke match: zelfde versie, binnen 1 seconde van
 * de klantopmerking en daarna geplaatst. Alles wat niet matcht blijft intern.
 */
export function matchReplyParent<T extends { id: string; mediaFileId: string; timecodeMs: number | null; createdAt: Date }>(
  candidate: { mediaFileId: string; timecodeMs: number | null; createdAt: Date },
  clientComments: T[],
): T | null {
  if (candidate.timecodeMs == null) return null;
  let best: T | null = null;
  for (const c of clientComments) {
    if (c.mediaFileId !== candidate.mediaFileId || c.timecodeMs == null) continue;
    if (c.createdAt.getTime() > candidate.createdAt.getTime()) continue;
    const d = Math.abs(c.timecodeMs - candidate.timecodeMs);
    if (d > 1000) continue;
    if (!best || d < Math.abs((best.timecodeMs ?? 0) - candidate.timecodeMs)) best = c;
  }
  return best;
}
