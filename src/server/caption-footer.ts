import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, contentCalendar } from "@/db/schema";

/**
 * Standaard caption-footer per klant: het vaste contact-/servicesblok met
 * icoontjes plus de hashtags die onder élke post terugkomen. Komt uit de
 * contentplanning (de bestaande captions), zodat dit in de Caption Maker
 * automatisch onder de caption gezet kan worden.
 */

const HASH_RE = /#[\p{L}\p{N}_]+/gu;

function clean(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\r\n/g, "\n");
}

const isHashtagLine = (l: string) => {
  const t = l.trim();
  return t.length > 0 && t.split(/\s+/).every((w) => w.startsWith("#"));
};

/** Splitst één caption in het structurele footer-blok en de hashtags. */
function parseCaption(caption: string): { structural: string; hashtags: string[] } | null {
  const lines = clean(caption).split("\n");
  // Footer begint bij de eerste "icoon | tekst"-regel (services/contact).
  const start = lines.findIndex((l) => /\s\|\s/.test(l));
  if (start < 0) return null;
  const structural: string[] = [];
  const hashtags: string[] = [];
  for (const l of lines.slice(start)) {
    if (isHashtagLine(l)) {
      for (const m of l.match(HASH_RE) ?? []) hashtags.push(m);
    } else {
      structural.push(l.replace(/\s+$/, ""));
    }
  }
  while (structural.length && structural[structural.length - 1]!.trim() === "") structural.pop();
  return { structural: structural.join("\n"), hashtags };
}

/**
 * Leidt de vaste footer af uit meerdere captions van één klant: het meest
 * voorkomende structurele blok + de hashtags die in minstens de helft van de
 * posts terugkomen. `null` als er geen footer te herkennen is.
 */
export function deriveFooterFromCaptions(captions: string[]): string | null {
  const blockCount = new Map<string, number>();
  const tagPosts = new Map<string, number>();
  const tagOriginal = new Map<string, string>();
  let parsed = 0;

  for (const cap of captions) {
    if (!cap || cap.length <= 20) continue;
    const p = parseCaption(cap);
    if (!p || !p.structural.trim()) continue;
    parsed++;
    blockCount.set(p.structural, (blockCount.get(p.structural) ?? 0) + 1);
    const seen = new Set<string>();
    for (const t of p.hashtags) {
      const low = t.toLowerCase();
      if (!tagOriginal.has(low)) tagOriginal.set(low, t);
      if (!seen.has(low)) {
        seen.add(low);
        tagPosts.set(low, (tagPosts.get(low) ?? 0) + 1);
      }
    }
  }
  if (parsed === 0) return null;

  let bestBlock = "";
  let bestN = 0;
  for (const [block, n] of blockCount) if (n > bestN) { bestN = n; bestBlock = block; }
  if (!bestBlock.trim()) return null;

  const threshold = Math.max(1, Math.ceil(parsed / 2));
  const standardTags = [...tagPosts.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([low]) => tagOriginal.get(low)!);

  return standardTags.length ? `${bestBlock}\n${standardTags.join(" ")}` : bestBlock;
}

/**
 * De footer van een klant: de opgeslagen (eventueel handmatig aangepaste)
 * footer, of anders live afgeleid uit de contentplanning. Lege string als er
 * (nog) niets te herkennen is.
 */
export async function getClientCaptionFooter(clientId: string): Promise<string> {
  const [row] = await db.select({ footer: clients.captionFooter }).from(clients).where(eq(clients.id, clientId)).limit(1);
  if (row?.footer && row.footer.trim()) return row.footer;

  const caps = await db
    .select({ caption: contentCalendar.caption })
    .from(contentCalendar)
    .where(and(eq(contentCalendar.clientId, clientId), isNull(contentCalendar.deletedAt)))
    .orderBy(desc(contentCalendar.scheduledOn))
    .limit(200);
  const texts = caps.map((c) => c.caption).filter((x): x is string => !!x && x.length > 20);
  return deriveFooterFromCaptions(texts) ?? "";
}
