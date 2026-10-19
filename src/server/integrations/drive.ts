import "server-only";
import { env } from "@/lib/env";
import { apiFetch } from "./http";
import {
  IntegrationError,
  MissingCredentialsError,
  type ConnectionTest,
} from "./types";

/**
 * Google Drive — API v3.
 *
 * We gebruiken een refresh-token flow: de refresh-token staat in de omgeving en
 * wordt omgewisseld voor een kortlevend access-token. Het access-token wordt in
 * het geheugen bewaard tot vlak voor het verloopt, zodat niet elke aanroep een
 * extra rondje naar Google kost.
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
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
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(
    private clientId = env.GOOGLE_CLIENT_ID,
    private clientSecret = env.GOOGLE_CLIENT_SECRET,
    private refreshToken = env.GOOGLE_REFRESH_TOKEN,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.refreshToken);
  }

  private async token(): Promise<string> {
    if (!this.isConfigured) {
      throw new MissingCredentialsError("google_drive", [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GOOGLE_REFRESH_TOKEN",
      ]);
    }
    // Een minuut marge, zodat een token nooit halverwege een verzoek verloopt.
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      refresh_token: this.refreshToken!,
      grant_type: "refresh_token",
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new IntegrationError(
        "google_drive",
        `Token vernieuwen mislukt (HTTP ${response.status})`,
        response.status,
        response.status >= 500,
      );
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const token = await this.token();
    return apiFetch<T>("google_drive", `${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      query: {
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        ...query,
      },
    });
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
        "newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed))",
      pageSize: 200,
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

    const token = await this.token();
    const r = await fetch(`${API}/files?fields=id&supportsAllDrives=true`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    });
    if (!r.ok) {
      throw new IntegrationError("google_drive", `Map aanmaken mislukt (HTTP ${r.status})`, r.status, r.status >= 500);
    }
    return ((await r.json()) as { id: string }).id;
  }

  /** Upload een bestand (bytes) naar een map. Multipart upload in één request. */
  async uploadBytes(name: string, mimeType: string, bytes: Uint8Array, parentId: string): Promise<{ id: string }> {
    const token = await this.token();
    const boundary = "scbackup_" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, parents: [parentId] });
    const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const post = `\r\n--${boundary}--`;
    const body = Buffer.concat([Buffer.from(pre, "utf8"), Buffer.from(bytes), Buffer.from(post, "utf8")]);

    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
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
    const token = await this.token();
    const r = await fetch(`${API}/files/${id}?supportsAllDrives=true`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok && r.status !== 404) {
      throw new IntegrationError("google_drive", `Verwijderen mislukt (HTTP ${r.status})`, r.status, r.status >= 500);
    }
  }
}

export const drive = new DriveService();
