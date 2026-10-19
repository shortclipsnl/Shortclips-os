/**
 * Eenmalige import van de Skool Classroom naar de Shortclips Kennisbank.
 *
 *   npm run kb:import            # importeert als dat nog niet gebeurd is
 *   npm run kb:import -- --check # alleen controleren wat er zou gebeuren
 *
 * Bron: data/kennisbank-import/ (de volledige Skool-export plus alle
 * afbeeldingen, bijlagen en video's als bestanden). Daardoor is de import
 * volledig onafhankelijk van Skool.
 *
 * Veiligheid:
 *  - Idempotent: draait alleen als er nog geen geslaagde Skool-import is én de
 *    kennisbank nog leeg is. Wijzigingen die Jarno later maakt worden dus nooit
 *    overschreven.
 *  - Alles in één transactie: of alles staat erin, of niets.
 *  - Inhoud wordt letterlijk overgenomen. Alleen technische verwijzingen worden
 *    omgezet: afbeeldingen naar onze eigen opslag en interne Skool-links naar
 *    de bijbehorende les in de kennisbank.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db, rawClient } from "../src/db/client";
import {
  kbAssetParts,
  kbAssets,
  kbChapters,
  kbCourses,
  kbImportRuns,
  kbLessons,
  kbProgress,
  users,
  KB_PART_SIZE,
} from "../src/db/schema";
import { docToPlainText, type PMDoc, type PMNode } from "../src/lib/kennisbank-doc";

const SOURCE = "skool-classroom";
const DIR = path.resolve(process.cwd(), "data/kennisbank-import");
const CHECK = process.argv.includes("--check");
const GROUP = "shortclips-founder-download-3459";

type SkoolNode = {
  course: { id: string; name: string; unitType: "course" | "set" | "module"; state: number; metadata: Record<string, unknown> };
  children?: SkoolNode[];
};
type Manifest = {
  images: Record<string, string>;
  files: Record<string, { path: string; fileName: string; contentType: string }>;
  videos: Record<string, { path: string; fileName: string; contentType: string }>;
};

function log(...a: unknown[]) {
  console.log("[kennisbank-import]", ...a);
}

async function main() {
  if (!fs.existsSync(path.join(DIR, "skool-export.json"))) {
    log("Geen importbundel gevonden, niets te doen.");
    return;
  }
  const [{ done }] = (await db
    .select({ done: sql<number>`count(*)::int` })
    .from(kbImportRuns)
    .where(sql`${kbImportRuns.source} = ${SOURCE} and ${kbImportRuns.status} = 'success'`)) as Array<{ done: number }>;
  const [{ courses: existing }] = (await db
    .select({ courses: sql<number>`count(*)::int` })
    .from(kbCourses)) as Array<{ courses: number }>;
  if (done > 0 || existing > 0) {
    log(`Overgeslagen: import is al gedaan (runs=${done}, cursussen=${existing}).`);
    return;
  }

  const exportData = JSON.parse(fs.readFileSync(path.join(DIR, "skool-export.json"), "utf8")) as {
    exportedAt: string;
    courses: Array<{ index: number; listing: { name: string; metadata: Record<string, unknown> }; tree: SkoolNode }>;
  };
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8")) as Manifest;

  // ---- 1. Id's vooraf toekennen, zodat interne links omgezet kunnen worden.
  const courseIdBySkoolName = new Map<string, string>();
  const lessonBySkoolModule = new Map<string, { courseId: string; lessonId: string }>();
  for (const c of exportData.courses) {
    const cid = crypto.randomUUID();
    courseIdBySkoolName.set(c.tree.course.name, cid);
    (function walk(n: SkoolNode) {
      if (n.course.unitType === "module") lessonBySkoolModule.set(n.course.id, { courseId: cid, lessonId: crypto.randomUUID() });
      for (const ch of n.children ?? []) walk(ch);
    })(c.tree);
  }

  const owner = (await db.select({ id: users.id }).from(users).where(sql`${users.primaryRole} = 'owner' and ${users.deletedAt} is null`).limit(2));
  const ownerId = owner.length === 1 ? owner[0]!.id : null;

  const stats = {
    courses: 0, chapters: 0, lessons: 0, draftChapters: 0, draftLessons: 0,
    images: 0, imagesMissing: [] as string[], files: 0, filesMissing: [] as string[],
    loomVideos: 0, skoolVideos: 0, skoolVideosMissing: [] as string[],
    internalLinksRewritten: 0, internalLinksUnresolved: [] as string[],
    externalLinks: 0, progressRows: 0,
  };

  if (CHECK) {
    log("Controle-modus: er wordt niets weggeschreven.");
  }

  await db.transaction(async (tx) => {
    const assetCache = new Map<string, string>();
    async function putAsset(rel: string, kind: "image" | "file" | "video", fileName: string, contentType: string, sourceRef: string): Promise<string | null> {
      const full = path.join(DIR, rel);
      if (!fs.existsSync(full)) return null;
      if (assetCache.has(rel)) return assetCache.get(rel)!;
      const data = fs.readFileSync(full);
      const sha256 = crypto.createHash("sha256").update(data).digest("hex");
      if (CHECK) {
        const fake = crypto.randomUUID();
        assetCache.set(rel, fake);
        return fake;
      }
      const [a] = await tx
        .insert(kbAssets)
        .values({ kind, fileName, contentType, byteSize: data.length, sha256, isComplete: true, sourceRef, createdById: ownerId })
        .returning({ id: kbAssets.id });
      for (let off = 0, part = 0; off < data.length; off += KB_PART_SIZE, part++) {
        const chunk = data.subarray(off, off + KB_PART_SIZE);
        await tx.insert(kbAssetParts).values({ assetId: a!.id, partNo: part, byteSize: chunk.length, data: Buffer.from(chunk) });
      }
      assetCache.set(rel, a!.id);
      return a!.id;
    }

    const imageType = (rel: string) => (rel.endsWith(".webp") ? "image/webp" : rel.endsWith(".gif") ? "image/gif" : rel.endsWith(".png") ? "image/png" : "image/jpeg");

    async function rewriteDoc(doc: PMDoc, ctx: string): Promise<PMDoc> {
      const walk = async (n: PMNode): Promise<PMNode> => {
        const out: PMNode = { ...n };
        if (n.type === "image" && typeof n.attrs?.src === "string") {
          const src = n.attrs.src;
          const rel = manifest.images[src];
          const id = rel ? await putAsset(rel, "image", path.basename(rel), imageType(rel), src) : null;
          // Skool-specifieke attributen (fileID, originalSrc) vallen weg; alt en title blijven.
          const attrs: Record<string, unknown> = { alt: n.attrs.alt ?? null, title: n.attrs.title ?? null };
          if (id) {
            attrs.src = `/api/kennisbank/assets/${id}`;
            stats.images++;
          } else {
            attrs.src = src;
            stats.imagesMissing.push(`${ctx}: ${src}`);
          }
          out.attrs = attrs;
        }
        if (n.marks) {
          out.marks = n.marks.map((m) => {
            if (m.type !== "link" || typeof m.attrs?.href !== "string") return m;
            const href = m.attrs.href;
            const mm = href.match(new RegExp(`skool\\.com/${GROUP}/classroom/([0-9a-f]{8})(?:\\?([^#]*))?`));
            if (!mm) {
              if (/^https?:/i.test(href)) stats.externalLinks++;
              return m;
            }
            const params = new URLSearchParams(mm[2] ?? "");
            const md = params.get("md");
            const cid = courseIdBySkoolName.get(mm[1]!);
            let target: string | null = null;
            if (md && lessonBySkoolModule.has(md)) {
              const t = lessonBySkoolModule.get(md)!;
              target = `/kennisbank/${t.courseId}?les=${t.lessonId}`;
            } else if (!md && cid) {
              target = `/kennisbank/${cid}`;
            }
            if (!target) {
              stats.internalLinksUnresolved.push(`${ctx}: ${href}`);
              return m;
            }
            stats.internalLinksRewritten++;
            return { ...m, attrs: { ...m.attrs, href: target, target: null, rel: null, class: null } };
          });
        }
        if (n.content) out.content = await Promise.all(n.content.map(walk));
        return out;
      };
      return (await walk(doc as unknown as PMNode)) as unknown as PMDoc;
    }

    for (const [ci, c] of exportData.courses.entries()) {
      const meta = c.listing.metadata as { title: string; desc?: string; coverImage?: string; privacy?: number };
      const courseId = courseIdBySkoolName.get(c.tree.course.name)!;
      const coverRel = meta.coverImage ? manifest.images[meta.coverImage] : undefined;
      const coverAssetId = coverRel ? await putAsset(coverRel, "image", path.basename(coverRel), imageType(coverRel), meta.coverImage!) : null;
      if (meta.coverImage && !coverAssetId) stats.imagesMissing.push(`cover ${meta.title}`);
      if (!CHECK) {
        await tx.insert(kbCourses).values({
          id: courseId,
          title: meta.title,
          description: meta.desc ?? "",
          coverAssetId,
          sortOrder: (ci + 1) * 10,
          // privacy 1 = "privé" in Skool → afgeschermd. Wie toegang krijgt
          // bepaalt Jarno (standaard alleen de eigenaar).
          isRestricted: meta.privacy === 1,
          allowedRoles: [],
          isPublished: c.tree.course.state === 2,
          sourceRef: `Skool › ${meta.title} (course ${c.tree.course.id})`,
          sourceUrl: `https://www.skool.com/${GROUP}/classroom/${c.tree.course.name}`,
          updatedById: ownerId,
        });
      }
      stats.courses++;

      let topPos = 0;
      for (const child of c.tree.children ?? []) {
        topPos++;
        if (child.course.unitType === "set") {
          const chapterId = crypto.randomUUID();
          const cmeta = child.course.metadata as { title: string };
          if (!CHECK) {
            await tx.insert(kbChapters).values({
              id: chapterId,
              courseId,
              title: cmeta.title,
              sortOrder: topPos * 10,
              sourceRef: `Skool › ${meta.title} › ${cmeta.title} (set ${child.course.id})`,
              updatedById: ownerId,
            });
          }
          stats.chapters++;
          if (child.course.state !== 2) stats.draftChapters++;
          let pos = 0;
          for (const mod of child.children ?? []) {
            pos++;
            // Lessen in een conceptmap blijven concept, net als in Skool.
            await insertLesson(mod, courseId, chapterId, pos * 10, `${meta.title} › ${cmeta.title}`, child.course.state !== 2);
          }
        } else if (child.course.unitType === "module") {
          await insertLesson(child, courseId, null, topPos * 10, meta.title, false);
        }
      }

      async function insertLesson(mod: SkoolNode, cId: string, chId: string | null, sortOrder: number, crumb: string, parentDraft: boolean) {
        const m = mod.course.metadata as { title: string; desc?: string; videoLink?: string; videoId?: string; resources?: string; completed?: number };
        const ids = lessonBySkoolModule.get(mod.course.id)!;
        const raw = (m.desc ?? "").replace(/^\[v2\]/, "");
        let doc: PMDoc;
        try {
          const parsed = raw ? JSON.parse(raw) : [];
          doc = Array.isArray(parsed) ? { type: "doc", content: parsed } : parsed;
        } catch {
          // Geen JSON: als platte tekst bewaren, niets weggooien.
          doc = { type: "doc", content: raw ? [{ type: "paragraph", content: [{ type: "text", text: raw }] }] : [] };
        }
        const ctx = `${crumb} › ${m.title}`;
        doc = await rewriteDoc(doc, ctx);

        const notes: string[] = [];
        let videoAssetId: string | null = null;
        if (m.videoId) {
          const v = manifest.videos[m.videoId];
          videoAssetId = v ? await putAsset(v.path, "video", v.fileName, v.contentType, `skool video ${m.videoId}`) : null;
          if (videoAssetId) stats.skoolVideos++;
          else {
            stats.skoolVideosMissing.push(ctx);
            notes.push("De video van deze les stond direct in Skool en is nog niet overgezet. Upload het originele videobestand via Bewerken.");
          }
        }
        if (m.videoLink) stats.loomVideos++;

        const resources: Array<Record<string, unknown>> = [];
        for (const r of (m.resources ? JSON.parse(m.resources) : []) as Array<{ title: string; file_id?: string; file_name?: string; file_content_type?: string; link?: string }>) {
          if (r.file_id) {
            const f = manifest.files[r.file_id];
            const id = f ? await putAsset(f.path, "file", f.fileName, f.contentType, `skool file ${r.file_id}`) : null;
            if (id) stats.files++;
            else {
              stats.filesMissing.push(`${ctx}: ${r.file_name}`);
              notes.push(`Bijlage "${r.title}" (${r.file_name}) kon nog niet uit Skool worden overgezet.`);
            }
            resources.push({ title: r.title, assetId: id, fileName: r.file_name ?? null, contentType: r.file_content_type ?? null, url: null, skoolFileId: r.file_id });
          } else if (r.link) {
            resources.push({ title: r.title, url: r.link, assetId: null });
          }
        }

        const isDraft = mod.course.state !== 2 || parentDraft;
        if (!CHECK) {
          await tx.insert(kbLessons).values({
            id: ids.lessonId,
            courseId: cId,
            chapterId: chId,
            title: m.title,
            content: doc as never,
            contentText: docToPlainText(doc),
            videoUrl: m.videoLink || null,
            videoAssetId,
            resources: resources as never,
            sortOrder,
            isPublished: !isDraft,
            sourceRef: `Skool › ${ctx} (module ${mod.course.id}${m.videoId ? `, video ${m.videoId}` : ""})`,
            sourceUrl: `https://www.skool.com/${GROUP}/classroom/${c.tree.course.name}?md=${mod.course.id}`,
            migrationNotes: notes.length ? notes.join(" ") : null,
            updatedById: ownerId,
          });
          // Voortgang: alleen de eigen voortgang van de eigenaar is betrouwbaar
          // beschikbaar uit Skool (de export is met zijn account gemaakt).
          if (ownerId && m.completed === 1) {
            await tx.insert(kbProgress).values({ userId: ownerId, lessonId: ids.lessonId, source: "skool" }).onConflictDoNothing();
            stats.progressRows++;
          }
        }
        stats.lessons++;
        if (isDraft) stats.draftLessons++;
      }
    }

    if (!CHECK) {
      await tx.insert(kbImportRuns).values({ source: SOURCE, status: "success", summary: { ...stats, exportedAt: exportData.exportedAt } as never });
    }
  });

  log("Klaar.", JSON.stringify({ ...stats, imagesMissing: stats.imagesMissing.length, filesMissing: stats.filesMissing, skoolVideosMissing: stats.skoolVideosMissing.length, internalLinksUnresolved: stats.internalLinksUnresolved }, null, 1));
}

main()
  .catch((e) => {
    console.error("[kennisbank-import] MISLUKT:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const raw = rawClient() as unknown as { end?: () => Promise<void>; close?: () => Promise<void> };
    await (raw.end?.() ?? raw.close?.());
  });

