import "server-only";
import { getNumberSetting, getStringSetting, setNumberSetting, setStringSetting } from "@/server/app-settings";

/**
 * Intern instelbare waarden die in het klantportaal zichtbaar zijn (feedback-
 * termijnen, annulerings- en overige voorwaarden). Zo staan de exacte dagen en
 * bedragen op één plek en zijn ze aanpasbaar zonder code — niet hardcoded.
 */

export type PortalSettings = {
  feedbackDaysScripts: number;
  feedbackDaysVideos: number;
  cancelNoticeDays: number;
  cancelFee: string;
  cancelLateNote: string;
  reshootFee: string;
  extraFeedbackFee: string;
  travelCost: string;
  responseTime: string;
};

export const PORTAL_SETTINGS_DEFAULTS: PortalSettings = {
  feedbackDaysScripts: 3,
  feedbackDaysVideos: 3,
  cancelNoticeDays: 7,
  cancelFee: "€ 395 excl. btw",
  cancelLateNote: "Bij annulering binnen 24 uur voor de opnamedag wordt 100% van de opnamedag in rekening gebracht.",
  reshootFee: "€ 95 per opnieuw opgenomen video (kosteloos bij een fout vanuit Shortclips)",
  extraFeedbackFee: "€ 75 per extra feedbackronde",
  travelCost: "€ 0,35 per km",
  responseTime: "Binnen één werkdag (ma–vr, 09:00–17:00)",
};

const K = {
  feedbackDaysScripts: "portal.feedback_days_scripts",
  feedbackDaysVideos: "portal.feedback_days_videos",
  cancelNoticeDays: "portal.cancel_notice_days",
  cancelFee: "portal.cancel_fee",
  cancelLateNote: "portal.cancel_late_note",
  reshootFee: "portal.reshoot_fee",
  extraFeedbackFee: "portal.extra_feedback_fee",
  travelCost: "portal.travel_cost",
  responseTime: "portal.response_time",
} as const;

export async function getPortalSettings(): Promise<PortalSettings> {
  const d = PORTAL_SETTINGS_DEFAULTS;
  const [feedbackDaysScripts, feedbackDaysVideos, cancelNoticeDays, cancelFee, cancelLateNote, reshootFee, extraFeedbackFee, travelCost, responseTime] = await Promise.all([
    getNumberSetting(K.feedbackDaysScripts, d.feedbackDaysScripts),
    getNumberSetting(K.feedbackDaysVideos, d.feedbackDaysVideos),
    getNumberSetting(K.cancelNoticeDays, d.cancelNoticeDays),
    getStringSetting(K.cancelFee, d.cancelFee),
    getStringSetting(K.cancelLateNote, d.cancelLateNote),
    getStringSetting(K.reshootFee, d.reshootFee),
    getStringSetting(K.extraFeedbackFee, d.extraFeedbackFee),
    getStringSetting(K.travelCost, d.travelCost),
    getStringSetting(K.responseTime, d.responseTime),
  ]);
  return { feedbackDaysScripts, feedbackDaysVideos, cancelNoticeDays, cancelFee, cancelLateNote, reshootFee, extraFeedbackFee, travelCost, responseTime };
}

/** Alleen de getallen; licht, voor jobs (herinneringen) die geen prose nodig hebben. */
export async function getFeedbackDays(): Promise<{ scripts: number; videos: number }> {
  const [scripts, videos] = await Promise.all([
    getNumberSetting(K.feedbackDaysScripts, PORTAL_SETTINGS_DEFAULTS.feedbackDaysScripts),
    getNumberSetting(K.feedbackDaysVideos, PORTAL_SETTINGS_DEFAULTS.feedbackDaysVideos),
  ]);
  return { scripts, videos };
}

export async function savePortalSettings(input: PortalSettings, updatedById?: string): Promise<void> {
  const num = (k: string, v: number) => setNumberSetting(k, v, { category: "portal", updatedById });
  const str = (k: string, v: string) => setStringSetting(k, v, { category: "portal", updatedById });
  await Promise.all([
    num(K.feedbackDaysScripts, input.feedbackDaysScripts),
    num(K.feedbackDaysVideos, input.feedbackDaysVideos),
    num(K.cancelNoticeDays, input.cancelNoticeDays),
    str(K.cancelFee, input.cancelFee),
    str(K.cancelLateNote, input.cancelLateNote),
    str(K.reshootFee, input.reshootFee),
    str(K.extraFeedbackFee, input.extraFeedbackFee),
    str(K.travelCost, input.travelCost),
    str(K.responseTime, input.responseTime),
  ]);
}
