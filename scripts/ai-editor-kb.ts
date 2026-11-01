/**
 * Zet de teamhandleiding van de Shortclips AI Editor in de Shortclips
 * Kennisbank (cursus "Shortclips AI Editor", les "Zo maak je een
 * advertentievideo met de AI Editor").
 *
 *   npm run ai-editor:kb
 *
 * Idempotent en veilig: bestaat de les al (herkend aan source_ref), dan wordt
 * er niets gewijzigd, zodat aanpassingen die in de kennisbank zelf zijn gedaan
 * nooit worden overschreven. Draait in vercel-build.
 *
 * De cursus is afgeschermd voor de rollen die de AI Editor mogen gebruiken.
 */
import { eq, sql } from "drizzle-orm";
import { db, rawClient } from "../src/db/client";
import { kbCourses, kbLessons, users } from "../src/db/schema";
import { AI_EDITOR_GUIDE, AI_EDITOR_GUIDE_TITLE } from "../src/lib/ai-editor-guide";
import { docToPlainText, type PMDoc, type PMNode } from "../src/lib/kennisbank-doc";

const COURSE_REF = "ai-editor:course";
const LESSON_REF = "ai-editor:handleiding:v1";
const ROLES = ["project_coordinator", "content_creator"];

const text = (t: string, marks?: PMNode["marks"]): PMNode => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (t: string): PMNode => ({ type: "paragraph", content: [text(t)] });
const list = (items: string[], code = false): PMNode => ({
  type: "bulletList",
  content: items.map((i) => ({ type: "listItem", content: [{ type: "paragraph", content: [text(i, code ? [{ type: "code" }] : undefined)] }] })),
});

function guideDoc(): PMDoc {
  const content: PMNode[] = [];
  for (const s of AI_EDITOR_GUIDE) {
    content.push({ type: "heading", attrs: { level: 2 }, content: [text(s.title)] });
    for (const p of s.paragraphs ?? []) content.push(para(p));
    if (s.bullets?.length) content.push(list(s.bullets));
    if (s.examples?.length) {
      content.push(para("Voorbeelden van berichten:"));
      content.push(list(s.examples, true));
    }
  }
  content.push(para("De AI Editor staat in het portaal onder AI Tools, Shortclips AI Editor. In de editor zelf staat dezelfde uitleg onder Hoe werkt het?"));
  return { type: "doc", content };
}

function log(...a: unknown[]) {
  console.log("[ai-editor-kb]", ...a);
}

async function main() {
  const [existing] = await db.select({ id: kbLessons.id }).from(kbLessons).where(eq(kbLessons.sourceRef, LESSON_REF)).limit(1);
  if (existing) { log("Handleiding staat al in de kennisbank, niets gewijzigd."); return; }

  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, "jarno@shortclips.nl")).limit(1);
  let [course] = await db.select({ id: kbCourses.id }).from(kbCourses).where(eq(kbCourses.sourceRef, COURSE_REF)).limit(1);
  if (!course) {
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${kbCourses.sortOrder}), 0)` }).from(kbCourses);
    [course] = await db.insert(kbCourses).values({
      title: "Shortclips AI Editor",
      description: "Van ruwe camerabeelden naar een advertentievideo in de Shortclips Ads Style: opnemen, genereren, feedback geven in de chat en exporteren.",
      sortOrder: Number(max) + 1,
      isRestricted: true,
      allowedRoles: ROLES,
      isPublished: true,
      sourceRef: COURSE_REF,
      updatedById: owner?.id ?? null,
    }).returning({ id: kbCourses.id });
    log("Cursus aangemaakt.");
  }

  const doc = guideDoc();
  await db.insert(kbLessons).values({
    courseId: course!.id,
    title: AI_EDITOR_GUIDE_TITLE,
    content: doc as never,
    contentText: docToPlainText(doc),
    sortOrder: 1,
    isPublished: true,
    sourceRef: LESSON_REF,
    updatedById: owner?.id ?? null,
  });
  log("Handleiding toegevoegd.");
}

main()
  .catch((e) => { console.error("[ai-editor-kb] mislukt:", e); process.exit(1); })
  .finally(async () => {
    const raw = rawClient();
    if ("end" in raw && typeof raw.end === "function") await raw.end();
    else if ("close" in raw && typeof raw.close === "function") await raw.close();
  });
