import { getScreenData } from "@/server/screen";
import { compact } from "@/lib/format";
import { AutoRefresh } from "./refresh";

export const dynamic = "force-dynamic";

const BLUE = "#2E90FA";
const ORANGE = "#FF6A00";

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ color: "rgba(255,255,255,0.5)" }}>—</span>;
  const up = pct >= 0;
  return (
    <span style={{ color: up ? "#56e39f" : "#ff6b6b", fontWeight: 700 }}>
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function Big({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 18, padding: "22px 26px", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div style={{ fontSize: 15, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 54, fontWeight: 800, lineHeight: 1.05, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub ? <div style={{ marginTop: 6, fontSize: 18 }}>{sub}</div> : null}
    </div>
  );
}

export default async function ScreenPage({ searchParams }: { searchParams: Promise<{ dagen?: string }> }) {
  const days = Number((await searchParams).dagen) || 30;
  const d = await getScreenData(days);
  const maxTrend = Math.max(1, ...d.trend.map((x) => x.views));
  const maxClient = Math.max(1, ...d.topByViews.map((c) => c.views));

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", padding: "32px 40px" }}>
      <AutoRefresh seconds={90} />

      {/* Kop */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: "-0.02em" }}>ShortClips</span>
          <span style={{ fontSize: 20, color: BLUE, fontWeight: 700 }}>Resultaten</span>
        </div>
        <div style={{ fontSize: 16, color: "rgba(255,255,255,0.6)" }}>
          Laatste {days} dagen · {d.clientCount} klanten · {new Date().toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>

      {/* Kern-KPI's */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 24 }}>
        <Big label="Totaal weergaven" value={compact(d.totals.views)} sub={<Delta pct={d.totals.viewsGrowthPct} />} />
        <Big label="Totaal bereik" value={compact(d.totals.reach)} sub={<Delta pct={d.totals.reachGrowthPct} />} />
        <Big label="Gepubliceerde shorts" value={compact(d.totals.posts)} />
        <Big label="Volgersgroei" value={`${d.totals.followerGrowth >= 0 ? "+" : ""}${compact(d.totals.followerGrowth)}`} sub={<span style={{ fontSize: 15, color: "rgba(255,255,255,0.6)" }}>nieuwe volgers</span>} />
      </div>

      {/* Trend + top klanten */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginTop: 20 }}>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 18, padding: "20px 24px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.75)", marginBottom: 14 }}>Weergaven per dag</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 160 }}>
            {d.trend.map((x) => (
              <div key={x.d} title={`${x.d}: ${compact(x.views)}`}
                style={{ flex: 1, height: `${Math.max(2, (x.views / maxTrend) * 100)}%`, background: `linear-gradient(180deg,${BLUE},${BLUE}55)`, borderRadius: 3 }} />
            ))}
          </div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 18, padding: "20px 24px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.75)", marginBottom: 14 }}>Meeste weergaven</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {d.topByViews.map((c) => (
              <div key={c.slug}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{compact(c.views)}</span>
                </div>
                <div style={{ height: 8, borderRadius: 6, background: "rgba(255,255,255,0.08)" }}>
                  <div style={{ width: `${Math.max(4, (c.views / maxClient) * 100)}%`, height: "100%", borderRadius: 6, background: ORANGE }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sterkste groei / achterblijvend */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
        <div style={{ background: "rgba(86,227,159,0.08)", borderRadius: 18, padding: "20px 24px", border: "1px solid rgba(86,227,159,0.2)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#56e39f", marginBottom: 12 }}>Sterkste groei</div>
          {d.risers.length === 0 ? <div style={{ color: "rgba(255,255,255,0.5)" }}>Nog niet genoeg data</div> : d.risers.map((c) => (
            <div key={c.slug} style={{ display: "flex", justifyContent: "space-between", fontSize: 18, padding: "6px 0" }}>
              <span>{c.name}</span><Delta pct={c.growthPct} />
            </div>
          ))}
        </div>
        <div style={{ background: "rgba(255,107,107,0.07)", borderRadius: 18, padding: "20px 24px", border: "1px solid rgba(255,107,107,0.2)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#ff8f8f", marginBottom: 12 }}>Blijft achter</div>
          {d.laggards.length === 0 ? <div style={{ color: "rgba(255,255,255,0.5)" }}>Geen dalers — mooi.</div> : d.laggards.map((c) => (
            <div key={c.slug} style={{ display: "flex", justifyContent: "space-between", fontSize: 18, padding: "6px 0" }}>
              <span>{c.name}</span><Delta pct={c.growthPct} />
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18, fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
        Automatisch bijgewerkt · cijfers uit Metricool · geen financiële gegevens getoond
      </div>
    </div>
  );
}
