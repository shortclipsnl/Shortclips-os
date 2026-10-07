import "server-only";
import { env } from "@/lib/env";
import { apiFetch } from "./http";

/**
 * Metricool — v2 API.
 *
 * Eén user-token (header `X-Mc-Auth`) geeft toegang tot alle merken van het
 * account. De user-id en merk-id's (blogId) halen we uit /settings/brands.
 * Statistieken komen uit /analytics/timelines als dagreeksen per metric.
 */
const BASE = "https://app.metricool.com/api/v2";

export type MetricoolBrand = { id: number; label: string; userId: number };
export type DailyPoint = { date: string; value: number };

/** De netwerken die we meenemen in de gecombineerde cijfers. */
export const METRICOOL_NETWORKS = ["Instagram", "Tiktok", "Facebook"] as const;

export class MetricoolService {
  constructor(private token = env.METRICOOL_USER_TOKEN) {}

  get isConfigured(): boolean {
    return Boolean(this.token);
  }

  private get headers(): Record<string, string> {
    return { "X-Mc-Auth": this.token ?? "", Accept: "application/json" };
  }

  /** Alle merken van het account (merk-id + label + user-id). */
  async listBrands(): Promise<MetricoolBrand[]> {
    const res = await apiFetch<{ data?: Array<{ id: number; label: string; userId: number }> }>(
      "metricool",
      `${BASE}/settings/brands`,
      { headers: this.headers },
    );
    return (res.data ?? [])
      .filter((b) => b.id && b.label && b.label !== "undefined")
      .map((b) => ({ id: b.id, label: b.label, userId: b.userId }));
  }

  /**
   * Dagwaarden van één metric voor een merk op één netwerk/subject (account,
   * reels, posts…). Geeft een lege reeks terug wanneer het netwerk/metric voor
   * dit merk niet beschikbaar is — zodat één netwerk de rest niet blokkeert.
   */
  async timeline(
    blogId: number,
    userId: number,
    network: string,
    subject: string,
    metric: string,
    fromISO: string,
    toISO: string,
  ): Promise<DailyPoint[]> {
    try {
      const res = await apiFetch<{ data?: Array<{ values?: Array<{ dateTime: string; value: number }> }> }>(
        "metricool",
        `${BASE}/analytics/timelines`,
        {
          headers: this.headers,
          retries: 0,
          query: { from: fromISO, to: toISO, network, subject, metric, blogId, userId },
        },
      );
      const values = res.data?.[0]?.values ?? [];
      return values.map((v) => ({ date: String(v.dateTime).slice(0, 10), value: Number(v.value) || 0 }));
    } catch {
      return [];
    }
  }
}

export const metricool = new MetricoolService();

/** ISO-datumtijd zoals Metricool die eist: yyyy-MM-ddTHH:mm:ss (geen zone). */
export function metricoolDate(d: Date, endOfDay = false): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const t = endOfDay ? "23:59:59" : "00:00:00";
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${t}`;
}
