import "server-only";
import { env } from "@/lib/env";
import { apiFetch } from "./http";
import type { MetricoolPostBody } from "@/lib/metricool-payload";

/**
 * Metricool-planner (schrijfkant). Bewust los van de statistiekenkoppeling.
 *
 * Veiligheid:
 *  - Zonder METRICOOL_PUBLISHING_ENABLED=true doet deze klasse GEEN enkele
 *    schrijvende aanroep; elke actie geeft dan alleen terug wat er verstuurd
 *    zou worden (proefmodus).
 *  - Aanmaken wordt nooit automatisch herhaald (retries: 0). Een time-out na
 *    het versturen kan betekenen dat de post tóch bestaat; dat lost de
 *    aanroeper op door eerst te zoeken (findOwn) voordat hij opnieuw maakt.
 *  - Er is geen functie om posts te wijzigen of verwijderen zonder UUID: we
 *    raken alleen onze eigen posts aan.
 */
const BASE = "https://app.metricool.com/api/v2/scheduler/posts";

export type ScheduledPost = {
  id: string;
  uuid: string;
  text: string;
  at: string; // "YYYY-MM-DDTHH:mm:ss" in de tijdzone van de post
  networks: string[];
  draft: boolean;
};

export type WriteResult =
  | { dryRun: true; method: string; url: string; body?: MetricoolPostBody }
  | { dryRun: false; post: ScheduledPost | null };

function toPost(r: Record<string, unknown>): ScheduledPost | null {
  if (!r || r.id == null) return null;
  const pd = r.publicationDate as { dateTime?: string } | undefined;
  const providers = (r.providers as Array<{ network?: string }> | undefined) ?? [];
  return {
    id: String(r.id),
    uuid: String(r.uuid ?? ""),
    text: String(r.text ?? ""),
    at: pd?.dateTime ?? "",
    networks: providers.map((p) => String(p.network ?? "")).filter(Boolean),
    draft: Boolean(r.draft),
  };
}

export class MetricoolScheduler {
  constructor(
    private token = env.METRICOOL_USER_TOKEN,
    private enabled = env.METRICOOL_PUBLISHING_ENABLED === "true",
  ) {}

  get isLive(): boolean {
    return this.enabled && Boolean(this.token);
  }

  private headers(): Record<string, string> {
    return { "X-Mc-Auth": this.token ?? "", Accept: "application/json", "Content-Type": "application/json" };
  }

  /** Lezen mag altijd (ook in proefmodus): nodig om te controleren. */
  async list(blogId: string, userId: string, fromLocal: string, toLocal: string): Promise<ScheduledPost[]> {
    const res = await apiFetch<{ data?: Array<Record<string, unknown>> }>("metricool", BASE, {
      headers: this.headers(),
      query: { blogId, userId, start: fromLocal, end: toLocal, timezone: "Europe/Amsterdam", extendedRange: true },
    });
    return (res.data ?? []).map(toPost).filter((p): p is ScheduledPost => p !== null);
  }

  async get(blogId: string, userId: string, id: string): Promise<ScheduledPost | null> {
    const res = await apiFetch<{ data?: Record<string, unknown> }>("metricool", `${BASE}/${encodeURIComponent(id)}`, {
      headers: this.headers(),
      query: { blogId, userId },
    });
    return res.data ? toPost(res.data) : null;
  }

  async create(blogId: string, userId: string, body: MetricoolPostBody): Promise<WriteResult> {
    if (!this.isLive) return { dryRun: true, method: "POST", url: BASE, body };
    const res = await apiFetch<{ data?: Record<string, unknown> }>("metricool", BASE, {
      method: "POST", headers: this.headers(), query: { blogId, userId }, body, retries: 0,
    });
    return { dryRun: false, post: res.data ? toPost(res.data) : null };
  }

  /** Volledige vervanging van een EIGEN post. Het id wijzigt, de UUID blijft. */
  async update(blogId: string, userId: string, id: string, uuid: string, body: MetricoolPostBody): Promise<WriteResult> {
    if (!uuid) throw new Error("Weigering: geen UUID, dit is geen post van Shortclips.");
    if (!this.isLive) return { dryRun: true, method: "PUT", url: `${BASE}/${id}`, body };
    const res = await apiFetch<{ data?: Record<string, unknown> }>("metricool", `${BASE}/${encodeURIComponent(id)}`, {
      method: "PUT", headers: this.headers(), query: { blogId, userId }, body: { ...body, id, uuid }, retries: 0,
    });
    return { dryRun: false, post: res.data ? toPost(res.data) : null };
  }

  /** In de wacht: dezelfde post als concept, zodat hij niet online gaat. */
  async hold(blogId: string, userId: string, id: string, uuid: string, body: MetricoolPostBody): Promise<WriteResult> {
    return this.update(blogId, userId, id, uuid, { ...body, draft: true });
  }

  async remove(blogId: string, userId: string, id: string, uuid: string): Promise<WriteResult> {
    if (!uuid) throw new Error("Weigering: geen UUID, dit is geen post van Shortclips.");
    if (!this.isLive) return { dryRun: true, method: "DELETE", url: `${BASE}/${id}` };
    await apiFetch("metricool", `${BASE}/${encodeURIComponent(id)}`, {
      method: "DELETE", headers: this.headers(), query: { blogId, userId }, retries: 0,
    });
    return { dryRun: false, post: null };
  }
}

/**
 * Na een time-out bij aanmaken: staat onze post er tóch? We zoeken op exact
 * hetzelfde kanaal, tijdstip en dezelfde tekst. Gevonden = opslaan, niet
 * opnieuw aanmaken. Zo ontstaat er nooit een tweede post.
 */
export function findOwn(posts: ScheduledPost[], body: MetricoolPostBody): ScheduledPost | null {
  const net = body.providers[0]?.network;
  const hits = posts.filter(
    (p) => p.at.slice(0, 16) === body.publicationDate.dateTime.slice(0, 16) && p.networks.length === 1 && p.networks[0] === net && p.text.trim() === body.text.trim(),
  );
  return hits.length === 1 ? hits[0]! : null;
}

export const metricoolScheduler = new MetricoolScheduler();
