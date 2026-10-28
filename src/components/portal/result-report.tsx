import { Logo } from "@/components/logo";
import { PrintButton } from "@/components/portal/print-button";
import { compact, formatDate, num } from "@/lib/format";
import type { PortalResults } from "@/server/portal";

const NAVY = "#00003b";
const BLUE = "#2E90FA";

const PLATFORM_LABELS: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook", linkedin: "LinkedIn" };
const platLabel = (p: string) => PLATFORM_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);

function periodLabelOf(r: PortalResults): string {
  if (r.periodKey === "custom") return `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`;
  return { "30": "Afgelopen 30 dagen", "90": "Afgelopen 3 maanden", "180": "Afgelopen 6 maanden", "365": "Afgelopen 12 maanden" }[r.periodKey] ?? `Afgelopen ${r.days} dagen`;
}

function deltaText(pct: number | null): { t: string; c: string } {
  if (pct === null) return { t: "—", c: "#6b7280" };
  if (pct === 0) return { t: "gelijk", c: "#6b7280" };
  return { t: `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`, c: pct > 0 ? "#15803d" : "#b45309" };
}

/** Eenvoudige lijn (weergaven) voor in het rapport. */
function Spark({ r }: { r: PortalResults }) {
  const vals = r.series.map((s) => s.views);
  if (vals.length < 2) return null;
  const W = 760, H = 120, P = 6;
  const max = Math.max(1, ...vals);
  const x = (i: number) => P + (i / (vals.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (H - 2 * P) - (v / max) * (H - 2 * P);
  const line = vals.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(vals.length - 1).toFixed(1)} ${H - P} L ${x(0).toFixed(1)} ${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="rfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BLUE} stopOpacity="0.22" />
          <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rfill)" />
      <path d={line} fill="none" stroke={BLUE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Stat({ label, value, prefix = "", pct }: { label: string; value: number; prefix?: string; pct?: number | null }) {
  const d = pct !== undefined ? deltaText(pct) : null;
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: "14px 16px", flex: "1 1 0", minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#6b7280" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: NAVY, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{prefix}{num(value)}</div>
      {d ? <div style={{ fontSize: 11.5, fontWeight: 600, color: d.c, marginTop: 2 }}>{d.t} <span style={{ color: "#9ca3af", fontWeight: 400 }}>vs. vorige</span></div> : null}
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 15, fontWeight: 700, color: NAVY, margin: "0 0 10px" }}>{children}</h2>;
}

/**
 * Printbaar resultatenrapport (A4) in de ShortClips-huisstijl. Dezelfde cijfers
 * als het dashboard; gevoed door exact dezelfde PortalResults (één bron).
 */
export function ResultReport({ r, clientName, clientLogoUrl }: { r: PortalResults; clientName: string; clientLogoUrl: string | null }) {
  const period = periodLabelOf(r);
  const compareRows: Array<{ k: "views" | "reach" | "followerGrowth" | "publishedVideos"; label: string }> = [
    { k: "views", label: "Weergaven" },
    { k: "reach", label: "Bereik" },
    { k: "followerGrowth", label: "Nieuwe volgers" },
    { k: "publishedVideos", label: "Gepubliceerde video's" },
  ];

  return (
    <>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print { .no-print { display: none !important; } .report { box-shadow: none !important; margin: 0 !important; } }
        .report table { border-collapse: collapse; width: 100%; }
        .report th, .report td { padding: 7px 10px; font-size: 12.5px; }
        .report thead th { text-align: left; color: #6b7280; font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: .4px; border-bottom: 1px solid #e5e7eb; }
        .report tbody tr + tr td { border-top: 1px solid #f0f0f3; }
      `}</style>

      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 10 }} className="no-print">
        <PrintButton />
      </div>

      <div
        className="report"
        style={{
          maxWidth: 820,
          margin: "24px auto",
          background: "#fff",
          color: "#1f2430",
          borderRadius: 16,
          padding: "32px 36px",
          boxShadow: "0 10px 40px rgba(0,0,0,.08)",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Kop */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderBottom: `2px solid ${NAVY}`, paddingBottom: 18 }}>
          <Logo size={30} />
          {clientLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clientLogoUrl} alt={clientName} style={{ height: 40, maxWidth: 180, objectFit: "contain" }} />
          ) : (
            <span style={{ fontSize: 18, fontWeight: 700, color: NAVY }}>{clientName}</span>
          )}
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: BLUE }}>Resultatenrapport</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: NAVY, margin: "4px 0 2px" }}>{clientName}</h1>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            {period}
            {r.lastUpdated ? ` · cijfers bijgewerkt op ${formatDate(r.lastUpdated)}` : ""}
          </div>
        </div>

        {!r.hasData ? (
          <p style={{ marginTop: 24, fontSize: 13, color: "#6b7280" }}>Voor deze periode zijn er nog geen resultaten beschikbaar.</p>
        ) : (
          <>
            {/* Kerncijfers */}
            <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
              <Stat label="Weergaven" value={r.metrics.views} pct={r.deltas.views} />
              <Stat label="Bereik" value={r.metrics.reach} pct={r.deltas.reach} />
              <Stat label="Nieuwe volgers" value={r.metrics.followerGrowth} prefix={r.metrics.followerGrowth >= 0 ? "+" : ""} pct={r.deltas.followerGrowth} />
              <Stat label="Gepubliceerde video's" value={r.metrics.publishedVideos} pct={r.deltas.publishedVideos} />
            </div>

            {/* Ontwikkeling */}
            {r.series.length >= 2 ? (
              <div style={{ marginTop: 26 }}>
                <H2>Ontwikkeling van de weergaven</H2>
                <Spark r={r} />
              </div>
            ) : null}

            {/* Per platform */}
            {r.byPlatform.length > 0 ? (
              <div style={{ marginTop: 26 }}>
                <H2>Per platform</H2>
                <table>
                  <thead>
                    <tr><th>Platform</th><th style={{ textAlign: "right" }}>Weergaven</th><th style={{ textAlign: "right" }}>Bereik</th><th style={{ textAlign: "right" }}>Engagement</th><th style={{ textAlign: "right" }}>Volgers</th><th style={{ textAlign: "right" }}>Video's</th></tr>
                  </thead>
                  <tbody>
                    {r.byPlatform.map((p) => (
                      <tr key={p.platform}>
                        <td style={{ fontWeight: 600, color: NAVY }}>{platLabel(p.platform)}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(p.views)}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(p.reach)}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(p.engagements)}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.followerGrowth >= 0 ? "+" : ""}{num(p.followerGrowth)}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{p.videoCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Vergelijking */}
            <div style={{ marginTop: 26 }}>
              <H2>Vergeleken met de vorige periode</H2>
              <table>
                <thead>
                  <tr><th>Statistiek</th><th style={{ textAlign: "right" }}>Vorige periode</th><th style={{ textAlign: "right" }}>Deze periode</th><th style={{ textAlign: "right" }}>Verschil</th></tr>
                </thead>
                <tbody>
                  {compareRows.map((row) => {
                    const d = deltaText(r.deltas[row.k]);
                    return (
                      <tr key={row.k}>
                        <td style={{ fontWeight: 600 }}>{row.label}</td>
                        <td style={{ textAlign: "right", color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>{num(r.prev[row.k])}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: NAVY, fontVariantNumeric: "tabular-nums" }}>{num(r.metrics[row.k])}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: d.c }}>{d.t}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Best presterende video's */}
            {r.topVideos.length > 0 ? (
              <div style={{ marginTop: 26 }}>
                <H2>Best presterende video's</H2>
                <table>
                  <thead>
                    <tr><th>#</th><th>Video</th><th>Platform</th><th style={{ textAlign: "right" }}>Weergaven</th><th style={{ textAlign: "right" }}>Likes</th></tr>
                  </thead>
                  <tbody>
                    {r.topVideos.map((v, i) => (
                      <tr key={v.id}>
                        <td style={{ color: "#9ca3af", fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ fontWeight: 600, color: NAVY }}>{v.title}</td>
                        <td>{platLabel(v.platform)}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{num(v.views)}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v.likes > 0 ? num(v.likes) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* Wat valt op */}
            {r.insights.length > 0 ? (
              <div style={{ marginTop: 26 }}>
                <H2>Wat valt op?</H2>
                <ul style={{ margin: 0, paddingLeft: 18, color: "#374151", fontSize: 13, lineHeight: 1.6 }}>
                  {r.insights.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            ) : null}
          </>
        )}

        <div style={{ marginTop: 30, paddingTop: 14, borderTop: "1px solid #e5e7eb", fontSize: 11, color: "#9ca3af" }}>
          Gemaakt door Shortclips · Cijfers automatisch uit de gekoppelde kanalen · {compact(r.milestone?.lifetimeViews ?? 0)} weergaven totaal sinds de start.
        </div>
      </div>
    </>
  );
}
