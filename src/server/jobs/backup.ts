import "server-only";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { drive } from "@/server/integrations/drive";

const BACKUP_FOLDER = "ShortClips OS – Database backups";
const FILE_PREFIX = "shortclips-os-backup-";
const KEEP = 14; // laatste 14 backups bewaren

function rowsOf<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[])) as T[];
}

/** Tijdstempel voor de bestandsnaam: 2026-10-19-0312. */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export type BackupResult = {
  ok: boolean;
  fileName?: string;
  fileId?: string;
  tables?: number;
  rows?: number;
  sizeBytes?: number;
  pruned?: number;
  message?: string;
};

/**
 * Volledige database-backup: alle tabellen uit het publieke schema worden als
 * JSON geëxporteerd, gzip'd en naar een eigen map in Google Drive geüpload.
 * Oude backups (ouder dan de laatste 14) worden opgeruimd.
 *
 * Vereist dat de Google-koppeling ook de drive.file-scope heeft (schrijven).
 */
export async function runDatabaseBackup(): Promise<BackupResult> {
  if (!drive.isConfigured) {
    return { ok: false, message: "Google Drive niet geconfigureerd (GOOGLE_* ontbreekt)." };
  }

  // 1. Alle tabellen ophalen.
  const tablesRes = await db.execute(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  const tableNames = rowsOf<{ table_name: string }>(tablesRes).map((t) => t.table_name);

  // 2. Elke tabel dumpen.
  const data: Record<string, unknown[]> = {};
  let totalRows = 0;
  for (const name of tableNames) {
    // Identifier komt uit information_schema (niet van gebruikers) → veilig via sql.raw.
    const res = await db.execute(sql`select * from ${sql.raw(`"${name}"`)}`);
    const rows = rowsOf(res);
    data[name] = rows;
    totalRows += rows.length;
  }

  // 3. JSON + gzip.
  const payload = {
    meta: {
      app: "shortclips-os",
      createdAt: new Date().toISOString(),
      tableCount: tableNames.length,
      rowCount: totalRows,
    },
    data,
  };
  const json = JSON.stringify(payload);
  const gz = gzipSync(Buffer.from(json, "utf8"));
  const fileName = `${FILE_PREFIX}${stamp()}.json.gz`;

  // 4. Map vinden/maken en uploaden.
  const folderId = await drive.ensureFolder(BACKUP_FOLDER);
  const uploaded = await drive.uploadBytes(fileName, "application/gzip", gz, folderId);

  // 5. Oude backups opruimen (alleen onze eigen backup-bestanden).
  let pruned = 0;
  try {
    const files = (await drive.listFolder(folderId))
      .filter((f) => f.name.startsWith(FILE_PREFIX))
      .sort((a, b) => b.name.localeCompare(a.name)); // nieuwste eerst (datum in naam)
    for (const old of files.slice(KEEP)) {
      await drive.deleteFileById(old.id);
      pruned++;
    }
  } catch {
    /* opruimen mag falen zonder de backup te laten mislukken */
  }

  return {
    ok: true,
    fileName,
    fileId: uploaded.id,
    tables: tableNames.length,
    rows: totalRows,
    sizeBytes: gz.byteLength,
    pruned,
    message: `Backup gemaakt: ${fileName} (${(gz.byteLength / 1024).toFixed(0)} KB, ${totalRows} rijen uit ${tableNames.length} tabellen).`,
  };
}
