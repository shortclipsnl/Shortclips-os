import "server-only";
import { env } from "@/lib/env";
import { apiFetch } from "./http";
import { IntegrationError, MissingCredentialsError, type ConnectionTest } from "./types";

/**
 * Gmail — API v1 (alleen-lezen). Zelfde refresh-token-flow als Google Drive en
 * Agenda: de refresh-token in de omgeving wordt omgewisseld voor een kortlevend
 * access-token. Gebruikt om het label "Leads - Shortclips" uit te lezen en
 * contactformulier-mails als leads te importeren. Vereist dat de bestaande
 * GOOGLE_REFRESH_TOKEN ook de scope gmail.readonly heeft.
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailMessage = {
  id: string;
  messageId: string; // RFC822 Message-ID (stabiele dedup-sleutel)
  from: string | null;
  fromName: string | null;
  subject: string | null;
  date: Date | null;
  body: string;
};

type RawHeader = { name: string; value: string };
type RawPart = { mimeType?: string; filename?: string; body?: { data?: string }; parts?: RawPart[] };
type RawMessage = { id: string; internalDate?: string; payload?: { headers?: RawHeader[]; mimeType?: string; body?: { data?: string }; parts?: RawPart[] } };

function decodeB64Url(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** Platte tekst uit een Gmail-payload halen (voorkeur text/plain, anders HTML ontdaan van tags). */
function extractBody(payload: RawMessage["payload"]): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: RawPart) => {
    if (p.parts?.length) { p.parts.forEach(walk); return; }
    const data = p.body?.data;
    if (!data) return;
    if (p.mimeType === "text/plain") plain.push(decodeB64Url(data));
    else if (p.mimeType === "text/html") html.push(decodeB64Url(data));
  };
  if (payload.parts?.length) payload.parts.forEach(walk);
  else if (payload.body?.data) {
    if (payload.mimeType === "text/html") html.push(decodeB64Url(payload.body.data));
    else plain.push(decodeB64Url(payload.body.data));
  }
  const text = plain.join("\n").trim() || html.join("\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
  return text;
}

function header(headers: RawHeader[] | undefined, name: string): string | null {
  const h = headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

export class GmailService {
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
      throw new MissingCredentialsError("gmail", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]);
    }
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const body = new URLSearchParams({
      client_id: this.clientId!, client_secret: this.clientSecret!, refresh_token: this.refreshToken!, grant_type: "refresh_token",
    });
    const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
    if (!response.ok) {
      throw new IntegrationError("gmail", `Token vernieuwen mislukt (HTTP ${response.status})`, response.status, response.status >= 500);
    }
    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async request<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const token = await this.token();
    return apiFetch<T>("gmail", `${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, query });
  }

  /** De label-id opzoeken op naam (hoofdletterongevoelig). */
  async findLabelId(name: string): Promise<string | null> {
    const res = await this.request<{ labels?: Array<{ id: string; name: string }> }>("/labels");
    const target = name.trim().toLowerCase();
    const match = (res.labels ?? []).find((l) => l.name.toLowerCase() === target);
    return match?.id ?? null;
  }

  /**
   * Haalt de recente berichten uit een label op (nieuwste eerst), met headers en
   * platte tekst. `max` begrenst het aantal (eerste koppeling mag meer importeren).
   */
  async fetchLabelMessages(labelName: string, max = 50): Promise<GmailMessage[]> {
    const labelId = await this.findLabelId(labelName);
    if (!labelId) throw new IntegrationError("gmail", `Label "${labelName}" niet gevonden in de mailbox.`, 404, false);

    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < max) {
      const page = await this.request<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
        "/messages",
        { labelIds: labelId, maxResults: Math.min(100, max - ids.length), ...(pageToken ? { pageToken } : {}) },
      );
      for (const m of page.messages ?? []) ids.push(m.id);
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }

    const out: GmailMessage[] = [];
    for (const id of ids) {
      const msg = await this.request<RawMessage>(`/messages/${id}`, { format: "full" });
      const headers = msg.payload?.headers;
      const from = header(headers, "From");
      const nameMatch = from?.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/);
      const dateHeader = header(headers, "Date");
      const internal = msg.internalDate ? new Date(Number(msg.internalDate)) : null;
      out.push({
        id: msg.id,
        messageId: (header(headers, "Message-ID") ?? `gmail:${msg.id}`).trim(),
        from,
        fromName: nameMatch ? nameMatch[1]!.trim() : null,
        subject: header(headers, "Subject"),
        date: dateHeader ? new Date(dateHeader) : internal,
        body: extractBody(msg.payload),
      });
    }
    return out;
  }

  async testConnection(): Promise<ConnectionTest> {
    if (!this.isConfigured) {
      return { ok: false, message: "Nog niet ingesteld: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET en GOOGLE_REFRESH_TOKEN ontbreken." };
    }
    try {
      const profile = await this.request<{ emailAddress?: string }>("/profile");
      const label = env.GMAIL_LEADS_LABEL || "Leads - Shortclips";
      const labelId = await this.findLabelId(label);
      if (!labelId) {
        return { ok: false, message: `Verbonden met ${profile.emailAddress ?? "mailbox"}, maar label "${label}" niet gevonden. Controleer de labelnaam of GMAIL_LEADS_LABEL.` };
      }
      return { ok: true, message: `Verbonden met ${profile.emailAddress ?? "de mailbox"} · label "${label}" gevonden.` };
    } catch (e) {
      const msg = e instanceof IntegrationError ? e.userMessage : "Verbinden met Gmail mislukt. Controleer of de refresh-token de scope gmail.readonly heeft.";
      return { ok: false, message: msg };
    }
  }
}

export const gmail = new GmailService();
