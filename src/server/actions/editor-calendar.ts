"use server";

import { requireInternal } from "@/server/auth/context";
import { getOrCreateIcalToken, icalFeedUrl, regenerateIcalToken } from "@/server/editor-ical";

/** Haalt (of maakt) de persoonlijke agenda-feed-URL van de ingelogde medewerker. */
export async function getMyAgendaFeed(): Promise<{ url: string }> {
  const viewer = await requireInternal();
  const token = await getOrCreateIcalToken(viewer.id);
  return { url: icalFeedUrl(token) };
}

/** Maakt een nieuwe feed-URL (de oude abonnementslink werkt daarna niet meer). */
export async function regenerateMyAgendaFeed(): Promise<{ url: string }> {
  const viewer = await requireInternal();
  const token = await regenerateIcalToken(viewer.id);
  return { url: icalFeedUrl(token) };
}
