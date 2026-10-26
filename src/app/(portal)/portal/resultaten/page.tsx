import type { Metadata } from "next";
import { ArrowUpRight, Check, Sparkles, Target, ThumbsUp, TrendingUp, Wand2 } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalResults } from "@/server/portal";
import { getApprovedImprovementForClient, type ImprovementContent } from "@/server/improvements";
import { PortalResultsView } from "./results-view";

export const metadata: Metadata = { title: "Resultaten" };
export const dynamic = "force-dynamic";

const SECTIONS: Array<{ k: keyof ImprovementContent; label: string; icon: typeof ThumbsUp; color: string }> = [
  { k: "watWerkt", label: "Wat goed werkte", icon: ThumbsUp, color: "#2fd27a" },
  { k: "watMinder", label: "Wat minder presteerde", icon: TrendingUp, color: "#ffb020" },
  { k: "volgendeWeek", label: "Volgende week pakken we dit anders aan", icon: ArrowUpRight, color: "#4bc4ff" },
  { k: "volgendeMaand", label: "Volgende maand testen we", icon: Target, color: "#4bc4ff" },
  { k: "formats", label: "Formats die we vaker inzetten", icon: Wand2, color: "#9fdcff" },
  { k: "optimalisaties", label: "Concrete optimalisaties", icon: Check, color: "#2fd27a" },
];

export default async function PortalResultatenPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const viewer = await requirePortal();
  const { periode } = await searchParams;
  const days = periode === "90" ? 90 : 30;
  const [r, improvement] = await Promise.all([getPortalResults(viewer, days), getApprovedImprovementForClient(viewer)]);

  const visible = improvement ? SECTIONS.filter((s) => improvement.content[s.k].length > 0) : [];

  return (
    <div className="flex flex-col gap-7">
      <PortalResultsView r={r} days={days} hrefForDays={(d) => `/portal/resultaten?periode=${d}`} />

      {visible.length > 0 ? (
        <section className="sc-glass p-6 sm:p-7" style={{ background: "linear-gradient(180deg, rgba(25,168,255,0.07), rgba(255,255,255,0.02))" }}>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-[rgba(25,168,255,0.14)] text-[#4bc4ff]"><Sparkles className="size-4" /></span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4bc4ff]">Van jouw team</span>
          </div>
          <h2 className="mt-2 text-[22px] font-bold tracking-tight">Wat gaan we verbeteren?</h2>
          <p className="mt-1.5 max-w-2xl text-[13.5px] text-[var(--color-ink-muted)]">
            Op basis van je resultaten — wat werkte, wat beter kan en wat we concreet voor je oppakken.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {visible.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.k} className="rounded-[14px] border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-[14px] font-semibold">
                    <Icon className="size-4 shrink-0" style={{ color: s.color }} /> {s.label}
                  </div>
                  <ul className="mt-2.5 flex flex-col gap-1.5">
                    {improvement!.content[s.k].map((item, i) => (
                      <li key={i} className="flex gap-2 text-[13.5px] text-[var(--color-ink-muted)]">
                        <span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: s.color }} /> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
