import { getClientReport } from "@/server/client-report";
import { compact } from "@/lib/format";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

const NAVY = "#0B2447";
const BLUE = "#2E90FA";
const ORANGE = "#FF6A00";

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

function Metric({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
  return (
    <div style={{ border: "1px solid #e6e8ee", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8a90a2", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: NAVY, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {delta !== undefined ? (
        <div style={{ fontSize: 12, fontWeight: 700, color: delta === null ? "#aaa" : delta >= 0 ? "#2e9a6e" : "#d9483b" }}>
          {delta === null ? "—" : `${delta >= 0 ? "▲ +" : "▼ "}${Math.abs(delta)}% vs vorige periode`}
        </div>
      ) : null}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: "26px 0 12px", borderLeft: `4px solid ${ORANGE}`, paddingLeft: 10 }}>{children}</h2>;
}

export default async function RapportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ dagen?: string }> }) {
  const { slug } = await params;
  const days = Number((await searchParams).dagen) || 90;
  const r = await getClientReport(slug, days);
  const t = r.totals;
  const maxMonth = Math.max(1, ...r.months.map((m) => m.views));

  return (
    <div style={{ background: "#fff", color: "#1c2230", minHeight: "100vh" }}>
      <style>{`
        @page { size: A4; margin: 16mm; }
        @media print { .no-print { display: none !important; } .page-break { break-before: page; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>
      <PrintButton />

      <div style={{ maxWidth: 840, margin: "0 auto", padding: "0 28px 60px", fontFamily: "Inter, system-ui, sans-serif" }}>
        {/* Titelblok */}
        <div style={{ background: NAVY, color: "#fff", borderRadius: 16, padding: "34px 36px", marginTop: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 22, fontWeight: 900 }}>ShortClips</span>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Resultatenrapportage</span>
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, marginTop: 22 }}>{r.client.name}</div>
          <div style={{ fontSize: 15, color: BLUE, fontWeight: 600, marginTop: 4 }}>{fmtDate(r.period.from)} – {fmtDate(r.period.to)}</div>
        </div>

        {!r.hasData ? (
          <p style={{ marginTop: 30, color: "#8a90a2" }}>Nog geen resultaten beschikbaar voor deze periode.</p>
        ) : (
          <>
            <SectionTitle>Samenvatting</SectionTitle>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, fontSize: 14.5 }}>
              {r.observations.map((o, i) => <li key={i}>{o}</li>)}
            </ul>

            <SectionTitle>Belangrijkste cijfers</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <Metric label="Weergaven" value={compact(t.views)} delta={t.viewsGrowthPct} />
              <Metric label="Bereik" value={compact(t.reach)} delta={t.reachGrowthPct} />
              <Metric label="Gepubliceerde video's" value={String(t.posts)} />
              <Metric label="Nieuwe volgers" value={`${t.followerGrowth >= 0 ? "+" : ""}${compact(t.followerGrowth)}`} />
              <Metric label="Likes" value={compact(t.likes)} />
              <Metric label="Reacties" value={compact(t.comments)} />
              <Metric label="Shares" value={compact(t.shares)} />
              <Metric label="Saves" value={compact(t.saves)} />
              <Metric label="Engagement" value={t.engagementRate != null ? `${t.engagementRate}%` : "—"} />
            </div>

            <SectionTitle>Prestaties per platform</SectionTitle>
            {r.perPlatform.length === 0 ? <p style={{ color: "#8a90a2", fontSize: 14 }}>Geen platformgegevens.</p> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#8a90a2", fontSize: 12 }}>
                    <th style={{ padding: "6px 8px" }}>Platform</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Weergaven</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Bereik</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Volgers</th>
                  </tr>
                </thead>
                <tbody>
                  {r.perPlatform.map((p) => (
                    <tr key={p.platform} style={{ borderTop: "1px solid #eef0f4" }}>
                      <td style={{ padding: "7px 8px", fontWeight: 600, textTransform: "capitalize" }}>{p.platform}</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{compact(p.views)}</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#6b7280" }}>{compact(p.reach)}</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: p.volgers >= 0 ? "#2e9a6e" : "#d9483b" }}>{p.volgers >= 0 ? "+" : ""}{compact(p.volgers)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <SectionTitle>Ontwikkeling per maand</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {r.months.map((m) => (
                <div key={m.maand} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 70, fontSize: 12, color: "#6b7280" }}>{m.maand}</span>
                  <span style={{ flex: 1, height: 14, background: "#eef0f4", borderRadius: 7 }}>
                    <span style={{ display: "block", width: `${Math.max(3, (m.views / maxMonth) * 100)}%`, height: "100%", background: BLUE, borderRadius: 7 }} />
                  </span>
                  <span style={{ width: 70, textAlign: "right", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{compact(m.views)}</span>
                </div>
              ))}
            </div>

            {/* AI-secties: worden gevuld zodra de Anthropic-sleutel is ingesteld */}
            <SectionTitle>Analyse &amp; verbeterpunten</SectionTitle>
            <div style={{ border: "1px dashed #c9cedb", borderRadius: 12, padding: "16px 18px", color: "#6b7280", fontSize: 14, lineHeight: 1.6 }}>
              De inhoudelijke AI-analyse (wat werkte goed, wat minder, en concrete verbeterpunten voor de volgende opnames) wordt hier automatisch toegevoegd zodra de AI-koppeling is geactiveerd. Tot die tijd baseert dit rapport zich op de feitelijke cijfers hierboven.
            </div>

            <SectionTitle>Conclusie</SectionTitle>
            <p style={{ fontSize: 14.5, lineHeight: 1.7 }}>
              In deze periode behaalde {r.client.name} {compact(t.views)} weergaven{t.viewsGrowthPct !== null ? ` (${t.viewsGrowthPct >= 0 ? "+" : ""}${t.viewsGrowthPct}% t.o.v. de vorige periode)` : ""} over {t.posts} gepubliceerde video&apos;s{t.avgPerPost ? `, gemiddeld ${compact(t.avgPerPost)} per video` : ""}. {t.followerGrowth >= 0 ? `De volgersbasis groeide met +${compact(t.followerGrowth)}.` : `De volgersbasis daalde met ${compact(t.followerGrowth)}.`}
            </p>
          </>
        )}

        <div style={{ marginTop: 40, paddingTop: 14, borderTop: "1px solid #eef0f4", fontSize: 11, color: "#aab0bf" }}>
          ShortClips · automatisch gegenereerd uit Metricool-cijfers · {fmtDate(r.period.to)}
        </div>
      </div>
    </div>
  );
}
