/**
 * Klantdocumenten (Klanten Guide / Editing Guide) inlezen in de centrale bron
 * en de Klantenbibliotheek in de kennisbank daarop laten aansluiten.
 *
 * Gebruik:
 *   npx tsx scripts/klantdocumenten-sync.ts --kind klanten_guide --dir <map met PDF's> [--dry]
 *   npx tsx scripts/klantdocumenten-sync.ts --library-only [--dry]
 *
 * Idempotent: een PDF die al als geldende versie staat (zelfde sha256) wordt
 * overgeslagen; een gewijzigde PDF wordt de nieuwe versie (oude blijft historie).
 *
 * Klantenbibliotheek (kennisbankcursus "Klanten bibliotheek"):
 *  - elk klanthoofdstuk krijgt kb_chapters.client_id, zodat elke les bovenaan de
 *    twee vaste guide-knoppen toont;
 *  - bijlagen "Klantbibliotheek (PDF)" en "Editing guide (PDF)" wijzen naar de
 *    vaste link in de centrale bron (altijd nieuwste versie);
 *  - dode Skool-bijlagen (nooit overgezet, geen bestand en geen link) worden
 *    verwijderd en per les vastgelegd in migration_notes + een lesrevisie.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, rawClient } from "../src/db/client";
import { clientDocuments, clients, kbAssetParts, kbAssets, kbChapters, kbLessonRevisions, kbLessons, KB_PART_SIZE, type KbResource } from "../src/db/schema";

const COURSE_ID = "33130631-469d-400c-a9b1-12f62e2df633"; // Klanten bibliotheek
type Kind = "klanten_guide" | "editing_guide";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag("dry");

/** Klant-slug → namen waaronder hij in bestandsnamen en hoofdstukken voorkomt. */
const ALIASES: Record<string, string[]> = {
  "luxewagen": ["luxewagen", "luxe wagen"],
  "365werk": ["365werk", "365 werk"],
  "ai2": ["ai2", "agri inter incasso"],
  "ausnutria-kabrita": ["ausnutria", "kabrita", "ausnutria kabrita"],
  "auto-christiaan": ["auto christiaan", "autochristiaan"],
  "bedrijfskleding-online": ["bedrijfskleding online", "bedrijfskledingonline"],
  "benz-collector-sneek": ["benz collector museum", "benz collector", "benzcollector"],
  "cb-automobielen": ["cb automobielen"],
  "campernet": ["campernet"],
  // De Goede en De Groede zijn op verzoek één klant (De Goede).
  "de-goede-financieel": ["de goede", "de groede", "degoede", "degroede"],
  "donker-groep": ["donker groep", "donkergroep", "donkergroen"],
  "friesland-lease": ["friesland lease", "frieslandlease"],
  "hoekstra-transport": ["hoekstra transport", "hoekstra"],
  "kkfh": ["kkfh"],
  "kavel-10": ["kavel 10", "kavel10"],
  "koops-chalets": ["koops chalets", "koopschalets", "koops"],
  "makelaardij-friesland": ["makelaardij friesland", "makelaardijfriesland"],
  "marco-van-beek-premium-cars": ["marco van beek", "marcovanbeek"],
  "nahv": ["nahv belastingadviseurs", "nahv"],
  "shades-by-erik-kuster": ["shades by eric kuster", "shades"],
  "skodora": ["skodora"],
  "storage-share": ["storage share"],
  "strevon": ["strevon"],
  "studsociety": ["stud society", "studsociety"],
  "thrivv": ["thrivv"],
  "hegro": ["hegro"],
  "kubo": ["kubo"],
  "kerstbomen-thuisbezorgd": ["kerstbomen thuisbezorgd"],
};
/** Klanten met meerdere merken: per merk een eigen Klanten Guide. */
const VARIANTS: Record<string, string[]> = { "ausnutria-kabrita": ["Ausnutria", "Kabrita"] };

const norm = (s: string) =>
  s.toLowerCase()
    .replace(/\.pdf$/, "")
    .replace(/^[0-9a-f]{8}-/, "")
    .replace(/[_\-]+/g, " ")
    .replace(/klantenbibliotheek|klantbibliotheek|editing style guide|editing guide|style guide|shortclips/g, " ")
    .replace(/^\s*\d+\.\s*/, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Langste alias die past wint (zodat "marco van beek" boven "marco" gaat). */
function matchSlug(text: string): string | null {
  const t = ` ${norm(text)} `;
  const tc = t.replace(/ /g, "");
  let best: { slug: string; len: number } | null = null;
  for (const [slug, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const hit = t.includes(` ${a} `) || tc.includes(a.replace(/ /g, ""));
      if (hit && (!best || a.length > best.len)) best = { slug, len: a.length };
    }
  }
  return best?.slug ?? null;
}
function variantFor(slug: string, text: string, kind: Kind): string {
  if (kind !== "klanten_guide") return "";
  const v = VARIANTS[slug];
  if (!v) return "";
  const t = norm(text);
  return v.find((x) => t.includes(x.toLowerCase())) ?? "";
}
const docUrl = (clientId: string, kind: Kind, variant = "") =>
  `/api/klantdocumenten/${clientId}/${kind}${variant ? `?v=${encodeURIComponent(variant)}` : ""}`;

async function storeAsset(fileName: string, data: Buffer, sourceRef: string): Promise<string> {
  const sha256 = crypto.createHash("sha256").update(data).digest("hex");
  const [asset] = await db.insert(kbAssets).values({ kind: "file", fileName: fileName.slice(0, 400), contentType: "application/pdf", byteSize: data.length, sha256, isComplete: false, sourceRef }).returning({ id: kbAssets.id });
  for (let off = 0, part = 0; off < data.length; off += KB_PART_SIZE, part++) {
    await db.insert(kbAssetParts).values({ assetId: asset!.id, partNo: part, byteSize: Math.min(KB_PART_SIZE, data.length - off), data: Buffer.from(data.subarray(off, off + KB_PART_SIZE)) });
  }
  await db.update(kbAssets).set({ isComplete: true }).where(eq(kbAssets.id, asset!.id));
  return asset!.id;
}

async function importPdfs(kind: Kind, dir: string, bySlug: Map<string, { id: string; name: string }>) {
  const files = fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort();
  console.log(`\n== ${kind}: ${files.length} PDF's uit ${dir}`);
  const unmatched: string[] = [];
  const seenTarget = new Map<string, string>();
  for (const f of files) {
    const slug = matchSlug(f);
    const client = slug ? bySlug.get(slug) : undefined;
    if (!slug || !client) { unmatched.push(f); continue; }
    const variant = variantFor(slug, f, kind);
    const key = `${client.id}|${variant}`;
    if (seenTarget.has(key)) { console.log(`  ! DUBBEL: ${f} en ${seenTarget.get(key)} → zelfde klant (${client.name}${variant ? ` · ${variant}` : ""}). Overgeslagen.`); continue; }
    seenTarget.set(key, f);

    const data = fs.readFileSync(path.join(dir, f));
    const sha = crypto.createHash("sha256").update(data).digest("hex");
    const niceName = f.replace(/^[0-9a-f]{8}-/, "").replace(/_/g, " ");
    const [cur] = await db
      .select({ id: clientDocuments.id, sha: kbAssets.sha256 })
      .from(clientDocuments)
      .innerJoin(kbAssets, eq(kbAssets.id, clientDocuments.assetId))
      .where(and(eq(clientDocuments.clientId, client.id), eq(clientDocuments.kind, kind), eq(clientDocuments.variant, variant), isNull(clientDocuments.deletedAt)))
      .orderBy(desc(clientDocuments.createdAt))
      .limit(1);
    if (cur?.sha === sha) { console.log(`  = ${client.name}${variant ? ` · ${variant}` : ""}: al actueel`); continue; }
    console.log(`  ${cur ? "↻ vervangen" : "+ nieuw"}: ${niceName} → ${client.name}${variant ? ` · ${variant}` : ""} (${(data.length / 1024).toFixed(0)} KB)`);
    if (DRY) continue;
    const assetId = await storeAsset(niceName, data, `klantdocument:${client.id}:${kind}`);
    await db.insert(clientDocuments).values({ clientId: client.id, kind, variant, assetId, fileName: niceName, sizeBytes: data.length });
  }
  if (unmatched.length) console.log(`  ! Niet te koppelen (geen klant gevonden): ${unmatched.join(", ")}`);
}

async function syncLibrary(bySlug: Map<string, { id: string; name: string }>) {
  console.log(`\n== Klantenbibliotheek (kennisbank)`);
  const chapters = await db.select({ id: kbChapters.id, title: kbChapters.title, clientId: kbChapters.clientId }).from(kbChapters).where(and(eq(kbChapters.courseId, COURSE_ID), isNull(kbChapters.deletedAt)));
  const chClient = new Map<string, string>();
  for (const ch of chapters) {
    if (/^0\./.test(ch.title)) continue; // "0. Start hier"
    const slug = matchSlug(ch.title);
    const client = slug ? bySlug.get(slug) : undefined;
    if (!client) { console.log(`  ! Hoofdstuk zonder klant in het portaal: ${ch.title}`); continue; }
    chClient.set(ch.id, client.id);
    if (ch.clientId !== client.id) {
      console.log(`  ↔ ${ch.title} → ${client.name}`);
      if (!DRY) await db.update(kbChapters).set({ clientId: client.id, updatedAt: sql`now()` }).where(eq(kbChapters.id, ch.id));
    }
  }
  const lessons = await db.select().from(kbLessons).where(and(eq(kbLessons.courseId, COURSE_ID), isNull(kbLessons.deletedAt)));
  for (const l of lessons) {
    const clientId = l.chapterId ? chClient.get(l.chapterId) : undefined;
    if (!clientId) continue;
    const before = (l.resources ?? []) as KbResource[];
    const after: KbResource[] = [];
    const removed: string[] = [];
    for (const r of before) {
      if (r.assetId || (r.url && !r.url.startsWith("/api/klantdocumenten/"))) { after.push(r); continue; }
      if (/klant(en)?bibliotheek|klanten guide/i.test(r.title)) {
        const v = VARIANTS[[...bySlug.entries()].find(([, c]) => c.id === clientId)?.[0] ?? ""]?.find((x) => new RegExp(x, "i").test(r.title)) ?? "";
        after.push({ title: v ? `Klanten Guide ${v} (PDF)` : "Klanten Guide (PDF)", url: docUrl(clientId, "klanten_guide", v), assetId: null, fileName: null, contentType: "application/pdf" });
      } else if (/editing/i.test(r.title)) {
        after.push({ title: "Editing Guide (PDF)", url: docUrl(clientId, "editing_guide"), assetId: null, fileName: null, contentType: "application/pdf" });
      } else {
        removed.push(`${r.title}${r.fileName ? ` (${r.fileName})` : ""}`);
      }
    }
    // Lessen die over een guide gaan, krijgen die guide onderaan als bijlage.
    if (/wie is/i.test(l.title) && !after.some((r) => r.url?.includes("/klanten_guide"))) after.push({ title: "Klanten Guide (PDF)", url: docUrl(clientId, "klanten_guide"), assetId: null, fileName: null, contentType: "application/pdf" });
    if (/editing guide/i.test(l.title) && !after.some((r) => r.url?.includes("/editing_guide"))) after.push({ title: "Editing Guide (PDF)", url: docUrl(clientId, "editing_guide"), assetId: null, fileName: null, contentType: "application/pdf" });
    // Dubbele koppelingen eruit.
    const seen = new Set<string>();
    const dedup = after.filter((r) => { const k = r.assetId ?? r.url ?? r.title; if (seen.has(k)) return false; seen.add(k); return true; });

    // Postgres (jsonb) sorteert sleutels anders, dus vergelijken op inhoud.
    const canon = (rs: KbResource[]) => JSON.stringify(rs.map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null).sort(([a], [b]) => a.localeCompare(b)))));
    // Oude Skool-migratiemeldingen ("kon nog niet worden overgezet") zijn
    // achterhaald: guides komen uit de centrale bron, dode bijlagen zijn hieronder
    // met een eigen notitie verwijderd.
    const cleanedNotes = (l.migrationNotes ?? "").replace(/Bijlage "[^"]*"(?: \([^)]*\))? kon nog niet uit Skool worden overgezet\.\s*/g, "").trim() || null;
    if (canon(dedup) === canon(before)) {
      if (cleanedNotes !== (l.migrationNotes ?? null)) {
        console.log(`  ✎ ${l.title}: achterhaalde migratiemelding opgeschoond`);
        if (!DRY) await db.update(kbLessons).set({ migrationNotes: cleanedNotes, updatedAt: sql`now()` }).where(eq(kbLessons.id, l.id));
      }
      continue;
    }
    console.log(`  ✎ ${l.title}: ${before.length} → ${dedup.length} bijlage(n)${removed.length ? ` · dood verwijderd: ${removed.join("; ")}` : ""}`);
    if (DRY) continue;
    const note = removed.length
      ? `Nov 2026: bijlage(n) zonder bestand verwijderd (nooit uit Skool overgezet): ${removed.join("; ")}. Upload het bestand opnieuw via Bewerken als het nog nodig is.`
      : null;
    await db.insert(kbLessonRevisions).values({ lessonId: l.id, title: l.title, content: l.content, videoUrl: l.videoUrl, resources: before, note: "Voor klantdocumenten-sync (nov 2026)" });
    await db.update(kbLessons).set({
      resources: dedup,
      migrationNotes: [cleanedNotes, note].filter(Boolean).join(" ") || null,
      updatedAt: sql`now()`,
    }).where(eq(kbLessons.id, l.id));
  }
}

async function main() {
  console.log(DRY ? "DRY RUN: er wordt niets opgeslagen." : "LIVE: wijzigingen worden opgeslagen.");
  const cl = await db.select({ id: clients.id, slug: clients.slug, name: clients.name }).from(clients).where(isNull(clients.deletedAt));
  const bySlug = new Map(cl.map((c) => [c.slug, { id: c.id, name: c.name }]));
  for (const slug of Object.keys(ALIASES)) if (!bySlug.has(slug)) console.log(`  ! Alias-slug bestaat niet in het portaal: ${slug}`);

  const kind = opt("kind") as Kind | undefined;
  const dir = opt("dir");
  if (kind && dir && !flag("library-only")) await importPdfs(kind, dir, bySlug);
  await syncLibrary(bySlug);

  const raw = rawClient();
  if ("end" in raw && typeof raw.end === "function") await raw.end();
  else if ("close" in raw && typeof raw.close === "function") await raw.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
