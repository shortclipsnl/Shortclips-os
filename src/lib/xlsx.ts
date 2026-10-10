import "server-only";
import { inflateRawSync } from "node:zlib";

/**
 * Minimale, afhankelijkheidsvrije .xlsx-lezer. Een xlsx is een zip met XML:
 * we pakken de nodige delen uit met Node's zlib en lezen de cellen met een
 * eenvoudige XML-scan. Genoeg om Digiboox-exports (platte tabellen) te lezen —
 * geen formules, stijlen of datums-als-getal nodig.
 */

export type XlsxSheet = { name: string; rows: string[][] };

/* ---- zip uitpakken (alleen 'stored' en 'deflate') ---- */

function findEOCD(buf: Buffer): number {
  // End Of Central Directory signature 0x06054b50, scan vanaf achteren.
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error("Geen geldig zip/xlsx-bestand (EOCD ontbreekt).");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // begin central directory

  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // Lokaal record: eigen naam-/extra-lengtes bepalen waar de data begint.
    if (buf.readUInt32LE(localOff) === 0x04034b50) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      let content: Buffer;
      if (method === 0) content = Buffer.from(raw);
      else if (method === 8) content = inflateRawSync(raw);
      else throw new Error(`Niet-ondersteunde compressie (${method}) in xlsx.`);
      files.set(name, content);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/* ---- XML-helpers ---- */

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const inner = m[1]!;
    let text = "";
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(inner))) text += t[1]!;
    out.push(decodeEntities(text));
  }
  return out;
}

function colToIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let c = 0;
  for (const ch of letters) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const rowIdx = parseInt(rm[1]!, 10) - 1;
    const body = rm[2]!;
    const cells: string[] = [];
    const cRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cRe.exec(body))) {
      const attrs = cm[1]!;
      const content = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const colIdx = ref ? colToIndex(ref) : cells.length;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let value = "";
      if (type === "inlineStr") {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t: RegExpExecArray | null;
        while ((t = tRe.exec(content))) value += t[1]!;
        value = decodeEntities(value);
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(content)?.[1];
        if (v != null) {
          if (type === "s") value = shared[parseInt(v, 10)] ?? "";
          else value = decodeEntities(v);
        }
      }
      cells[colIdx] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    rows[rowIdx] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/** Leest alle werkbladen uit een .xlsx-buffer als tekstrasters. */
export function readXlsx(buf: Buffer): XlsxSheet[] {
  const files = unzip(buf);
  const ssFile = files.get("xl/sharedStrings.xml");
  const shared = ssFile ? parseSharedStrings(ssFile.toString("utf8")) : [];

  // Werkbladnamen + volgorde uit workbook.xml / relaties halen is extra werk;
  // voor platte exports volstaat de bestandsvolgorde met een generieke naam.
  const sheetNames = [...files.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(/sheet(\d+)/.exec(a)![1]!, 10);
      const nb = parseInt(/sheet(\d+)/.exec(b)![1]!, 10);
      return na - nb;
    });

  return sheetNames.map((name, i) => ({
    name: `sheet${i + 1}`,
    rows: parseSheet(files.get(name)!.toString("utf8"), shared),
  }));
}
