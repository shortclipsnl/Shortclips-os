import "server-only";
import { env } from "@/lib/env";
import { apiFetch } from "./http";
import {
  IntegrationError,
  MissingCredentialsError,
  type ConnectionTest,
} from "./types";

/**
 * Frame.io — V4 API.
 *
 * Basis-URL en paden volgens de officiële V4-referentie: https://api.frame.io/v4
 * met een bearer-token. Voor productie is een server-to-server OAuth-app de
 * aanbevolen route; het token daaruit zet je in FRAMEIO_TOKEN. De adapter maakt
 * geen onderscheid: hij gebruikt wat er in de omgeving staat.
 */
const BASE = "https://api.frame.io/v4";

export type FrameProject = {
  id: string;
  name: string;
  root_folder_id?: string;
  workspace_id?: string;
  created_at?: string;
  updated_at?: string;
};

export type FrameFile = {
  id: string;
  name: string;
  type?: string;
  status?: string;
  media_type?: string;
  parent_id?: string;
  project_id?: string;
  view_url?: string;
  created_at?: string;
  updated_at?: string;
};

export type FrameComment = {
  id: string;
  text?: string;
  timestamp?: number;
  file_id?: string;
  owner_id?: string;
  completed?: boolean;
  created_at?: string;
  updated_at?: string;
};

type Page<T> = { data?: T[]; total?: number; next_cursor?: string } | T[];

function unwrap<T>(payload: Page<T>): T[] {
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}

export class FrameService {
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(
    private legacyToken = env.FRAMEIO_TOKEN,
    private accountId = env.FRAMEIO_ACCOUNT_ID,
    private clientId = env.FRAMEIO_CLIENT_ID,
    private clientSecret = env.FRAMEIO_CLIENT_SECRET,
    private refreshToken = env.FRAMEIO_REFRESH_TOKEN,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.legacyToken || (this.clientId && this.clientSecret));
  }

  /** Legacy developer tokens vragen om een extra header. */
  private get legacyHeaders(): Record<string, string> {
    return this.legacyToken ? { "x-frameio-legacy-token-auth": "true" } : {};
  }

  /**
   * Bepaalt het Bearer-token via Adobe IMS. Drie routes, in volgorde:
   *   1. legacy developer token → direct gebruiken;
   *   2. Web App: refresh-token omwisselen voor een access-token (deze opzet);
   *   3. Server-to-Server: client-credentials (voor accounts die dat bieden).
   * Access-tokens worden met een minuut marge in het geheugen gecachet.
   */
  private async token(): Promise<string> {
    if (this.legacyToken) return this.legacyToken;
    if (!this.clientId || !this.clientSecret) {
      throw new MissingCredentialsError("frameio", [
        "FRAMEIO_CLIENT_ID",
        "FRAMEIO_CLIENT_SECRET",
      ]);
    }
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) {
      return this.accessToken;
    }

    const body = this.refreshToken
      ? new URLSearchParams({
          grant_type: "refresh_token",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: this.refreshToken,
        })
      : new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: "openid,AdobeID,frame.s2s.all",
        });

    const response = await fetch(env.FRAMEIO_IMS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new IntegrationError(
        "frameio",
        `Access-token ophalen bij Adobe mislukt (HTTP ${response.status})`,
        response.status,
        response.status >= 500,
      );
    }
    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private requireAccount(): string {
    if (!this.accountId) {
      throw new MissingCredentialsError("frameio", ["FRAMEIO_ACCOUNT_ID"]);
    }
    return this.accountId;
  }

  private async request<T>(path: string, options: Parameters<typeof apiFetch>[2] = {}): Promise<T> {
    const token = await this.token();
    return apiFetch<T>("frameio", `${BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...this.legacyHeaders,
        ...(options.headers ?? {}),
      },
    });
  }

  async testConnection(): Promise<ConnectionTest> {
    if (!this.isConfigured) {
      return {
        ok: false,
        message:
          "Nog niet ingesteld: Frame.io client-id + secret (Server-to-Server) of een legacy token ontbreekt.",
      };
    }
    if (!this.accountId) {
      return {
        ok: false,
        message: "FRAMEIO_ACCOUNT_ID ontbreekt. Die is nodig om projecten op te halen.",
      };
    }
    try {
      const workspaces = await this.listWorkspaces();
      return {
        ok: true,
        message: `Verbonden. ${workspaces.length} workspace(s) gevonden.`,
        detail: { workspaces: workspaces.length },
      };
    } catch (error) {
      const err = error as IntegrationError;
      return { ok: false, message: err.userMessage ?? "Verbinding mislukt.", detail: { error: err.message } };
    }
  }

  async listWorkspaces(): Promise<Array<{ id: string; name: string }>> {
    const result = await this.request<Page<{ id: string; name: string }>>(
      `/accounts/${this.requireAccount()}/workspaces`,
    );
    return unwrap(result);
  }

  async listProjects(): Promise<FrameProject[]> {
    const result = await this.request<Page<FrameProject>>(
      `/accounts/${this.requireAccount()}/projects`,
    );
    return unwrap(result);
  }

  async getProject(projectId: string): Promise<FrameProject> {
    return this.request<FrameProject>(`/accounts/${this.requireAccount()}/projects/${projectId}`);
  }

  async listFolderChildren(folderId: string): Promise<FrameFile[]> {
    const result = await this.request<Page<FrameFile>>(
      `/accounts/${this.requireAccount()}/folders/${folderId}/children`,
    );
    return unwrap(result);
  }

  async getFile(fileId: string): Promise<FrameFile> {
    return this.request<FrameFile>(`/accounts/${this.requireAccount()}/files/${fileId}`);
  }

  async listComments(fileId: string): Promise<FrameComment[]> {
    const result = await this.request<Page<FrameComment>>(
      `/accounts/${this.requireAccount()}/files/${fileId}/comments`,
    );
    return unwrap(result);
  }

  async listWebhooks(): Promise<Array<{ id: string; url: string; events: string[] }>> {
    const result = await this.request<Page<{ id: string; url: string; events: string[] }>>(
      `/accounts/${this.requireAccount()}/webhooks`,
    );
    return unwrap(result);
  }

  async createWebhook(
    workspaceId: string,
    url: string,
    events: string[],
  ): Promise<{ id: string; secret?: string }> {
    return this.request(`/accounts/${this.requireAccount()}/webhooks`, {
      method: "POST",
      body: { data: { name: "ShortClips OS", url, events, workspace_id: workspaceId } },
    });
  }
}

export const frameio = new FrameService();
