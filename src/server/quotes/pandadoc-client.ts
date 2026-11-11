import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Dunne client voor de officiële PandaDoc-API (api.pandadoc.com). Alleen de
 * endpoints die de koppeling echt gebruikt. Fouten worden vertaald naar een
 * duidelijke Nederlandse melding, zodat die op de Offertepagina te tonen is.
 */

const BASE = "https://api.pandadoc.com";

export class PandaDocError extends Error {
  constructor(public status: number, public userMessage: string) {
    super(userMessage);
  }
}

export function pandadocConfigured(): boolean {
  return !!env.PANDADOC_API_KEY;
}

function explain(status: number, path: string): string {
  if (status === 401) return "PandaDoc weigert de API-sleutel. Controleer PANDADOC_API_KEY (Settings → Integrations → API).";
  if (status === 403) return path.includes("audit-trail")
    ? "De API-sleutel hoort niet bij een workspace-beheerder; de activiteit (openingen) kan niet worden opgehaald."
    : "De API-sleutel heeft geen toegang tot dit document.";
  if (status === 404) return "Document niet (meer) gevonden in PandaDoc.";
  if (status === 429) return "PandaDoc beperkt tijdelijk het aantal verzoeken. De volgende synchronisatie pakt het op.";
  if (status >= 500) return "PandaDoc is tijdelijk niet bereikbaar.";
  return `PandaDoc gaf een onverwachte fout (${status}).`;
}

async function request(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  if (!env.PANDADOC_API_KEY) throw new PandaDocError(0, "PandaDoc is nog niet gekoppeld: PANDADOC_API_KEY ontbreekt.");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `API-Key ${env.PANDADOC_API_KEY}`, Accept: "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  // Bij rate limiting één keer kort wachten en opnieuw proberen.
  if (res.status === 429 && attempt < 2) {
    const wait = Math.min(Number(res.headers.get("retry-after") ?? "2") * 1000, 8000);
    await new Promise((r) => setTimeout(r, wait));
    return request(path, init, attempt + 1);
  }
  if (!res.ok) throw new PandaDocError(res.status, explain(res.status, path));
  return res;
}

async function getJson<T>(path: string): Promise<T> {
  return (await (await request(path)).json()) as T;
}

export type PdListItem = {
  id: string;
  name?: string;
  status?: string;
  date_created?: string;
  date_modified?: string;
  date_completed?: string | null;
  expiration_date?: string | null;
};

export type PdRecipient = {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  recipient_type?: string | null;
  has_completed?: boolean;
  signature_date?: string | null;
};

export type PdDetails = PdListItem & {
  date_sent?: string | null;
  ref_number?: string | null;
  created_by?: { email?: string; first_name?: string; last_name?: string } | null;
  sent_by?: { email?: string; first_name?: string; last_name?: string } | null;
  recipients?: PdRecipient[];
  grand_total?: { amount?: string; currency?: string } | null;
  metadata?: Record<string, unknown> | null;
};

export type PdAuditEntry = {
  id: string;
  user?: { id?: string; email?: string } | null;
  action: number;
  date_created: string;
};

/** Eén pagina documenten, nieuwste wijziging eerst. */
export async function listDocuments(opts: { page?: number; count?: number; modifiedFrom?: Date } = {}): Promise<PdListItem[]> {
  const q = new URLSearchParams({ count: String(opts.count ?? 100), page: String(opts.page ?? 1), order_by: "-date_modified" });
  if (opts.modifiedFrom) q.set("modified_from", opts.modifiedFrom.toISOString());
  const data = await getJson<{ results?: PdListItem[] }>(`/public/v1/documents?${q}`);
  return data.results ?? [];
}

export const getDocumentDetails = (id: string) => getJson<PdDetails>(`/public/v1/documents/${encodeURIComponent(id)}/details`);

/** Volledige audittrail (bekeken, verzonden, ondertekend), alle pagina's. */
export async function getAuditTrail(id: string): Promise<PdAuditEntry[]> {
  const out: PdAuditEntry[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await getJson<{ count?: number; results?: PdAuditEntry[] }>(
      `/public/v2/documents/${encodeURIComponent(id)}/audit-trail?limit=100&offset=${offset}`,
    );
    const rows = page.results ?? [];
    out.push(...rows);
    if (rows.length < 100 || out.length >= (page.count ?? 0)) break;
  }
  return out;
}

/** PDF van het document. Afgeronde documenten via download-protected (met certificaat). */
export async function downloadDocumentPdf(id: string, completed: boolean): Promise<Uint8Array> {
  const path = `/public/v1/documents/${encodeURIComponent(id)}/${completed ? "download-protected" : "download"}`;
  try {
    return new Uint8Array(await (await request(path, { headers: { Accept: "application/pdf" } })).arrayBuffer());
  } catch (e) {
    // download-protected vraagt een productiesleutel; val terug op de gewone download.
    if (completed && e instanceof PandaDocError && (e.status === 403 || e.status === 400 || e.status === 409)) {
      return downloadDocumentPdf(id, false);
    }
    throw e;
  }
}

/** Handmatige statuswijziging (alleen 2 = Completed, 11 = Expired, 12 = Declined). */
export async function changeDocumentStatus(id: string, code: 2 | 11 | 12, note?: string): Promise<void> {
  await request(`/public/v1/documents/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: code, note: note ?? "Gewijzigd vanuit het Shortclips-portaal", notify_recipients: false }),
  });
}

/**
 * Controleert de webhookhandtekening: HMAC-SHA256 van de ruwe body met de
 * gedeelde sleutel. PandaDoc stuurt die als `?signature=` of als header
 * `x-pd-signature`; beide worden geaccepteerd.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null, key: string | undefined): boolean {
  if (!key || !signature) return false;
  const expected = createHmac("sha256", key).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}
