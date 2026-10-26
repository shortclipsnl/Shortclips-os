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
  // Aanvullende afspraken (document "Zo leggen we het vast").
  contractTerm: string;
  billingNote: string;
  shootDuration: string;
  reviewDays: number;
  reviewAutoApproveDays: number;
  extraContentNote: string;
  rawFootageFee: string;
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
  contractTerm: "Minimaal 3 maanden, daarna maandelijks opzegbaar met één kalendermaand.",
  billingNote: "De facturatie vindt plaats vóór de opname.",
  shootDuration: "Een opnamedag duurt gemiddeld 4 tot 7 uur.",
  reviewDays: 3,
  reviewAutoApproveDays: 5,
  extraContentNote: "Extra video's kunnen tijdens een opnamedag worden opgenomen wanneer de planning dit toelaat. Dit geldt uitsluitend voor short video content en wordt aanvullend gefactureerd volgens het geldende tarief.",
  rawFootageFee: "€ 450 per opnamedag, binnen 90 dagen",
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
  contractTerm: "portal.contract_term",
  billingNote: "portal.billing_note",
  shootDuration: "portal.shoot_duration",
  reviewDays: "portal.review_days",
  reviewAutoApproveDays: "portal.review_auto_approve_days",
  extraContentNote: "portal.extra_content_note",
  rawFootageFee: "portal.raw_footage_fee",
} as const;

export async function getPortalSettings(): Promise<PortalSettings> {
  const d = PORTAL_SETTINGS_DEFAULTS;
  const [
    feedbackDaysScripts, feedbackDaysVideos, cancelNoticeDays, cancelFee, cancelLateNote, reshootFee, extraFeedbackFee, travelCost, responseTime,
    contractTerm, billingNote, shootDuration, reviewDays, reviewAutoApproveDays, extraContentNote, rawFootageFee,
  ] = await Promise.all([
    getNumberSetting(K.feedbackDaysScripts, d.feedbackDaysScripts),
    getNumberSetting(K.feedbackDaysVideos, d.feedbackDaysVideos),
    getNumberSetting(K.cancelNoticeDays, d.cancelNoticeDays),
    getStringSetting(K.cancelFee, d.cancelFee),
    getStringSetting(K.cancelLateNote, d.cancelLateNote),
    getStringSetting(K.reshootFee, d.reshootFee),
    getStringSetting(K.extraFeedbackFee, d.extraFeedbackFee),
    getStringSetting(K.travelCost, d.travelCost),
    getStringSetting(K.responseTime, d.responseTime),
    getStringSetting(K.contractTerm, d.contractTerm),
    getStringSetting(K.billingNote, d.billingNote),
    getStringSetting(K.shootDuration, d.shootDuration),
    getNumberSetting(K.reviewDays, d.reviewDays),
    getNumberSetting(K.reviewAutoApproveDays, d.reviewAutoApproveDays),
    getStringSetting(K.extraContentNote, d.extraContentNote),
    getStringSetting(K.rawFootageFee, d.rawFootageFee),
  ]);
  return {
    feedbackDaysScripts, feedbackDaysVideos, cancelNoticeDays, cancelFee, cancelLateNote, reshootFee, extraFeedbackFee, travelCost, responseTime,
    contractTerm, billingNote, shootDuration, reviewDays, reviewAutoApproveDays, extraContentNote, rawFootageFee,
  };
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
    str(K.contractTerm, input.contractTerm),
    str(K.billingNote, input.billingNote),
    str(K.shootDuration, input.shootDuration),
    num(K.reviewDays, input.reviewDays),
    num(K.reviewAutoApproveDays, input.reviewAutoApproveDays),
    str(K.extraContentNote, input.extraContentNote),
    str(K.rawFootageFee, input.rawFootageFee),
  ]);
}
