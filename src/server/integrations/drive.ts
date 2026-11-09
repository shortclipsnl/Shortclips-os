import "server-only";
import { apiFetch } from "./http";
import { googleAuth, googleFetch, type GoogleAuth } from "./google-auth";
import {
  IntegrationError,
  type ConnectionTest,
} from "./types";

/**
 * Google Drive — API v3. Authenticatie loopt via het centrale tokenbeheer
 * (google-auth.ts), gedeeld met Agenda en Gmail.
 */
const API = "https://www.googleapis.com/drive/v3";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  trashed?: boolean;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

export class DriveService {
  constructor(private auth: GoogleAuth = googleAuth) {}

  get isConfigured(): boolean {
    return this.auth.isConfigured;
  }

  private token(): Promise<string> {
    return this.auth.getAccessToken("google_drive");
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const token = await this.token();
    return apiFetch<T>("google_drive", `${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      // Drive-limieten (429 en 403 rateLimitExceeded) met backoff opvangen.
      retries: 4,
      timeoutMs: 30_000,
      onUnauthorized: async () => {
        this.auth.invalidate();
        return { Authorization: `Bearer ${await this.token()}` };
      },
      query: {
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        ...query,
      },
    });
  }

  /** Ruwe aanroep (download/upload) met token, 401-herstel en backoff. */
  private raw(url: string, init: RequestInit = {}): Promise<Response> {
    return googleFetch("google_drive", url, init, { auth: this.auth });
  }

  /** Welk Google-account is gekoppeld? */
  async about(): Promise<{ emailAddress: string; displayName: string }> {
    const r = await this.request<{ user: { emailAddress: string; displayName: string } }>("/about", {
      fields: "user(displayName,emailAddress)",
    });
    return r.user;
  }

  async testConnection(): Promise<ConnectionTest> {
    if (!this.isConfigured) {
      return {
        ok: false,
        message:
          "Nog niet ingesteld: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en GOOGLE_REFRESH_TOKEN ontbreken.",
      };
    }
    try {
      const about = await this.request<{ user: { emailAddress: string; displayName: string } }>(
        "/about",
        { fields: "user(displayName,emailAddress)" },
      );
      return {
        ok: true,
        message: `Verbonden als ${about.user.displayName} (${about.user.emailAddress}).`,
        detail: { user: about.user },
      };
    } catch (error) {
      const err = error as IntegrationError;
      return { ok: false, message: err.userMessage ?? "Verbinding mislukt.", detail: { error: err.message } };
    }
  }

  /** Inhoud van één map. Mappen komen eerst, daarna bestanden op naam. */
  async listFolder(folderId: string, pageSize = 200): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
      const page = await this.request<{ files: DriveFile[]; nextPageToken?: string }>("/files", {
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          "nextPageToken, files(id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed)",
        orderBy: "folder,name",
        pageSize,
        pageToken,
      });
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && files.length < 2000);

    return files;
  }

  /** Map en alle submappen doorlopen — voor de eerste import van een klantmap. */
  async walkFolder(
    folderId: string,
    maxDepth = 3,
  ): Promise<Array<DriveFile & { depth: number; path: string }>> {
    const out: Array<DriveFile & { depth: number; path: string }> = [];
    const queue: Array<{ id: string; depth: number; path: string }> = [
      { id: folderId, depth: 0, path: "" },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > maxDepth) continue;

      const children = await this.listFolder(current.id);
      for (const child of children) {
        const path = `${current.path}/${child.name}`;
        out.push({ ...child, depth: current.depth, path });
        if (child.mimeType === FOLDER_MIME && current.depth < maxDepth) {
          queue.push({ id: child.id, depth: current.depth + 1, path });
        }
      }
    }

    return out;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    return this.request<DriveFile>(`/files/${fileId}`, {
      fields: "id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed",
    });
  }

  /**
   * Startpunt voor incrementele synchronisatie. Met dit token vraag je later
   * alleen de wijzigingen op in plaats van de hele map opnieuw.
   */
  async startPageToken(): Promise<string> {
    const result = await this.request<{ startPageToken: string }>("/changes/startPageToken");
    return result.startPageToken;
  }

  async changes(pageToken: string): Promise<{
    changes: Array<{ fileId: string; removed: boolean; file?: DriveFile }>;
    newStartPageToken?: string;
    nextPageToken?: string;
  }> {
    return this.request("/changes", {
      pageToken,
      fields:
        "newStartPageToken,nextPageToken,changes(fileId,removed,changeType,file(id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed))",
      pageSize: 500,
      spaces: "drive",
      includeRemoved: true,
    });
  }

  static isFolder(file: DriveFile): boolean {
    return file.mimeType === FOLDER_MIME;
  }

  /* --- Schrijven (voor database-backups). Vereist de drive.file-scope. --- */

  /** Vind of maak een map met deze naam (in My Drive). Met de drive.file-scope
   *  ziet de app alleen de mappen die ze zelf heeft aangemaakt — precies goed
   *  voor een eigen backup-map. */
  async ensureFolder(name: string): Promise<string> {
    const safe = name.replace(/'/g, "\\'");
    const res = await this.request<{ files: { id: string }[] }>("/files", {
      q: `mimeType = '${FOLDER_MIME}' and name = '${safe}' and trashed = false`,
      fields: "files(id,name)",
      pageSize: 1,
    });
    if (res.files?.[0]?.id) return res.files[0].id;

    const r = await this.raw(`${API}/files?fields=id&supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    });
    if (!r.ok) {
      throw new IntegrationError("google_drive", `Map aanmaken mislukt (HTTP ${r.status})`, r.status, r.status >= 500);
    }
    return ((await r.json()) as { id: string }).id;
  }

  /** Vind-of-maak een submap met deze naam ONDER een bepaalde map. */
  async ensureFolderUnder(name: string, parentId: string): Promise<string> {
    const safe = name.replace(/'/g, "\\'");
    const res = await this.request<{ files: { id: string }[] }>("/files", {
      q: `mimeType = '${FOLDER_MIME}' and name = '${safe}' and '${parentId}' in parents and trashed = false`,
      fields: "files(id)",
      pageSize: 1,
    });
    if (res.files?.[0]?.id) return res.files[0].id;

    const r = await this.raw(`${API}/files?fields=id&supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!r.ok) {
      throw new IntegrationError("google_drive", `Submap aanmaken mislukt (HTTP ${r.status})`, r.status, r.status >= 500);
    }
    return ((await r.json()) as { id: string }).id;
  }

  /** Download de ruwe inhoud (bytes) van één bestand uit Drive. */
  async downloadBytes(fileId: string): Promise<Uint8Array> {
    const url = `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    const res = await this.raw(url);
    if (!res.ok) {
      throw new IntegrationError("google_drive", `Bestand downloaden mislukt (HTTP ${res.status})`, res.status, res.status >= 500);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * Download een (groot) bestand rechtstreeks naar schijf, gestreamd, zonder
   * het in het geheugen te laden. Gebruikt door de AI Editor voor ruwe
   * camerabestanden van meerdere GB.
   */
  async downloadToFile(fileId: string, destPath: string): Promise<number> {
    const { createWriteStream } = await import("node:fs");
    const { mkdir, stat } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const { Readable } = await import("node:stream");
    const { pipeline } = await import("node:stream/promises");
    const url = `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;
    const res = await this.raw(url);
    if (!res.ok || !res.body) {
      throw new IntegrationError("google_drive", `Bestand downloaden mislukt (HTTP ${res.status})`, res.status, res.status >= 500);
    }
    await mkdir(dirname(destPath), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream), createWriteStream(destPath));
    return (await stat(destPath)).size;
  }

  /** Exporteert een Google-document (Docs) als platte tekst. Alleen voor
   *  Google-native bestanden; gewone bestanden gaan via downloadBytes. */
  async exportText(fileId: string): Promise<string> {
    const url = `${API}/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain&supportsAllDrives=true`;
    const res = await this.raw(url);
    if (!res.ok) {
      throw new IntegrationError("google_drive", `Document exporteren mislukt (HTTP ${res.status})`, res.status, res.status >= 500);
    }
    return res.text();
  }

  /** Upload een bestand (bytes) naar een map. Multipart upload in één request. */
  async uploadBytes(name: string, mimeType: string, bytes: Uint8Array, parentId: string): Promise<{ id: string }> {
    const boundary = "scbackup_" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, parents: [parentId] });
    const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const post = `\r\n--${boundary}--`;
    const body = Buffer.concat([Buffer.from(pre, "utf8"), Buffer.from(bytes), Buffer.from(post, "utf8")]);

    const r = await this.raw(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new IntegrationError("google_drive", `Upload mislukt (HTTP ${r.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`, r.status, r.status >= 500);
    }
    return (await r.json()) as { id: string };
  }

  /** Een bestand verwijderen (voor het opruimen van oude backups). */
  async deleteFileById(id: string): Promise<void> {
    const r = await this.raw(`${API}/files/${id}?supportsAllDrives=true`, { method: "DELETE" });
    if (!r.ok && r.status !== 404) {
      throw new IntegrationError("google_drive", `Verwijderen mislukt (HTTP ${r.status})`, r.status, r.status >= 500);
    }
  }
}

export const drive = new DriveService();
