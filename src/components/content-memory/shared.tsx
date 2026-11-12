import { Play } from "lucide-react";
import { Badge } from "@/components/ui";
import { EVIDENCE_LABEL, type Evidence, type MemoryVideo } from "@/server/content-memory/analyze";

export const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube Shorts", linkedin: "LinkedIn" };
export const plat = (p: string) => PLATFORM_LABEL[p] ?? p;
export const nf = (n: number) => n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(".", ",")}k` : Math.round(n).toLocaleString("nl-NL");
export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d).replace(".", ",")}%`;
export const xf = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;
export const dateNl = (d: string | null) => d ? new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" }) : "";

const TONE: Record<Evidence, "good" | "info" | "neutral" | "warn"> = { sterk: "good", aannemelijk: "info", gemengd: "neutral", verkennend: "neutral", een_video: "warn" };
export function EvidenceBadge({ e }: { e: Evidence }) {
  return <Badge tone={TONE[e]}>{EVIDENCE_LABEL[e]}</Badge>;
}

/** Prestatie t.o.v. normaal als duidelijke chip. */
export function PerfChip({ perf, className = "" }: { perf: number; className?: string }) {
  const tone = perf >= 1.2 ? "text-[#1d6b4c] bg-[var(--color-good-soft)]" : perf <= 0.8 ? "text-[#a3271c] bg-[var(--color-bad-soft)]" : "text-[var(--color-ink-muted)] bg-[var(--color-neutral-soft)]";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone} ${className}`}>{xf(perf)} normaal</span>;
}

export function Thumb({ v, size = "md" }: { v: MemoryVideo; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "h-16 w-9" : "h-[132px] w-[74px]";
  const inner = (
    <div className={`relative ${cls} shrink-0 overflow-hidden rounded-lg bg-[var(--color-indigo-ink)]`}>
      {v.thumbnail ? <img src={v.thumbnail} alt="" className="size-full object-cover" /> : null}
      <span className="absolute inset-0 grid place-items-center"><span className="grid size-7 place-items-center rounded-full bg-black/45 text-white"><Play className="size-3.5 translate-x-[1px]" fill="currentColor" /></span></span>
    </div>
  );
  return v.externalUrl ? <a href={v.externalUrl} target="_blank" rel="noreferrer" aria-label="Bekijk video">{inner}</a> : inner;
}
