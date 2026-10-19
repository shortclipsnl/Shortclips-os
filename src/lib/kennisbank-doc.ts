/**
 * Hulpfuncties voor lesinhoud (ProseMirror/TipTap-JSON).
 * Isomorf: gebruikt door server (zoeken, import) én client (editor).
 */

export type PMMark = { type: string; attrs?: Record<string, unknown> };
export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
};
export type PMDoc = { type: "doc"; content?: PMNode[] };

export const EMPTY_DOC: PMDoc = { type: "doc", content: [] };

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "listItem",
  "horizontalRule",
]);

/** Platte tekst, met regeleinden tussen blokken. Voor zoeken en AI. */
export function docToPlainText(doc: PMDoc | PMNode | null | undefined): string {
  const out: string[] = [];
  const walk = (n: PMNode | undefined) => {
    if (!n) return;
    if (n.type === "text" && n.text) out.push(n.text);
    else if (n.type === "hardBreak") out.push("\n");
    else if (n.type === "image") {
      const alt = typeof n.attrs?.alt === "string" ? n.attrs.alt : "";
      if (alt) out.push(`[afbeelding: ${alt}]`);
    }
    for (const c of n.content ?? []) walk(c);
    if (BLOCK_TYPES.has(n.type)) out.push("\n");
  };
  walk(doc as PMNode);
  return out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Alle afbeeldings-URL's in een document. */
export function collectImageSrcs(doc: PMDoc | PMNode): string[] {
  const out: string[] = [];
  const walk = (n: PMNode) => {
    if (n.type === "image" && typeof n.attrs?.src === "string") out.push(n.attrs.src);
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc as PMNode);
  return out;
}

/** Alle link-URL's in een document. */
export function collectLinks(doc: PMDoc | PMNode): string[] {
  const out: string[] = [];
  const walk = (n: PMNode) => {
    for (const m of n.marks ?? []) if (m.type === "link" && typeof m.attrs?.href === "string") out.push(m.attrs.href);
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc as PMNode);
  return out;
}

/** Diepe kopie waarbij `fn` elke node mag aanpassen (structuur blijft gelijk). */
export function mapDoc(doc: PMDoc, fn: (n: PMNode) => PMNode): PMDoc {
  const walk = (n: PMNode): PMNode => {
    const next = fn({ ...n, attrs: n.attrs ? { ...n.attrs } : undefined, marks: n.marks?.map((m) => ({ ...m, attrs: m.attrs ? { ...m.attrs } : undefined })) });
    if (next.content) next.content = next.content.map(walk);
    return next;
  };
  return walk(doc as PMNode) as PMDoc;
}

/**
 * Skool gebruikt een paar eigen namen (bijv. `unorderedList`). De editor kent
 * de TipTap-namen. Dit zet alleen de namen om; tekst en opmaak blijven gelijk.
 */
export function toEditorDoc(doc: PMDoc): PMDoc {
  return mapDoc(doc, (n) => {
    if (n.type === "unorderedList") return { ...n, type: "bulletList" };
    if (n.marks) {
      // videoTimestamp is in Skool een klikbaar tijdstip in een video; in de
      // editor tonen we het als gewone tekst met behoud van de tekst zelf.
      n.marks = n.marks.filter((m) => ["bold", "italic", "link", "code", "strike", "underline"].includes(m.type));
      if (n.marks.length === 0) delete n.marks;
    }
    if (n.type === "image" && n.attrs) {
      n.attrs = { src: n.attrs.src, alt: n.attrs.alt ?? null, title: n.attrs.title ?? null };
    }
    return n;
  });
}

export function isEmptyDoc(doc: PMDoc | null | undefined): boolean {
  return !doc || !doc.content || doc.content.length === 0 || docToPlainText(doc).length === 0 && collectImageSrcs(doc).length === 0;
}

/** Loom-deel-URL → embed-URL. Andere URL's ongewijzigd. */
export function videoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("loom.com")) {
      const m = u.pathname.match(/\/(?:share|embed)\/([a-zA-Z0-9]+)/);
      if (m) return `https://www.loom.com/embed/${m[1]}`;
    }
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (u.hostname === "youtu.be") return `https://www.youtube.com/embed${u.pathname}`;
    if (u.hostname.includes("vimeo.com")) {
      const m = u.pathname.match(/\/(\d+)/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
    return null;
  } catch {
    return null;
  }
}
