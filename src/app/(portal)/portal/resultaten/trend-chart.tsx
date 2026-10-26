"use client";

import { useMemo, useState } from "react";
import type { PortalSeriesPoint } from "@/server/portal";
import { compact } from "@/lib/format";

type MetricKey = "views" | "reach" | "engagements" | "followers";

const METRICS: Array<{ key: MetricKey; label: string }> = [
  { key: "views", label: "Weergaven" },
  { key: "reach", label: "Bereik" },
  { key: "followers", label: "Volgersgroei" },
  { key: "engagements", label: "Engagement" },
];

const W = 720;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

export function TrendChart({ series }: { series: PortalSeriesPoint[] }) {
  const [metric, setMetric] = useState<MetricKey>("views");

  const values = useMemo(() => {
    if (metric === "followers") {
      // Volgersgroei cumulatief binnen de periode (loopt netjes op/af).
      let run = 0;
      return series.map((s) => (run += s.followers));
    }
    return series.map((s) => s[metric]);
  }, [series, metric]);

  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min || 1)) * innerH;

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(values.length - 1).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`;

  // Drie y-ticks + begin/midden/eind-datumlabels.
  const ticks = [min, min + (max - min) / 2, max];
  const fmtDate = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    return `${d.getDate()} ${d.toLocaleDateString("nl-NL", { month: "short" })}`;
  };
  const labelIdx = series.length <= 1 ? [0] : [0, Math.floor((series.length - 1) / 2), series.length - 1];

  return (
    <section className="sc-glass p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Ontwikkeling</h2>
        <div className="inline-flex flex-wrap gap-1 rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] p-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${metric === m.key ? "bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {series.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--color-ink-muted)]">Nog geen dagcijfers voor deze periode.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" style={{ height: "auto" }} role="img" aria-label={`Ontwikkeling van ${METRICS.find((m) => m.key === metric)!.label.toLowerCase()}`}>
          <defs>
            <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#19a8ff" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#19a8ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} y1={y(t)} x2={W - PAD.right} y2={y(t)} stroke="var(--sc-line)" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-faint)">{compact(Math.round(t))}</text>
            </g>
          ))}
          <path d={area} fill="url(#trend-fill)" />
          <path d={line} fill="none" stroke="var(--sc-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {series.length <= 31
            ? values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="var(--sc-accent)" />)
            : null}
          {labelIdx.map((i) => (
            <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--color-ink-faint)">
              {fmtDate(series[i]!.date)}
            </text>
          ))}
        </svg>
      )}
    </section>
  );
}
