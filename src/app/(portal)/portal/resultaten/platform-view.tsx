"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { PortalPlatformResult } from "@/server/portal";
import { compact } from "@/lib/format";
import { PLATFORM } from "@/lib/statuses";

function Stat({ label, value, prefix = "" }: { label: string; value: number; prefix?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{prefix}{compact(value)}</div>
    </div>
  );
}

function PlatformDot({ platform }: { platform: string }) {
  return <span className="size-2.5 shrink-0 rounded-full ring-1 ring-white/40" style={{ background: PLATFORM[platform]?.color ?? "#888" }} />;
}

export function PlatformView({ platforms }: { platforms: PortalPlatformResult[] }) {
  const [active, setActive] = useState<string>("all");
  const current = platforms.find((p) => p.platform === active) ?? null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Per platform</h2>
        <div className="inline-flex flex-wrap gap-1 rounded-full border border-[var(--sc-line)] bg-[var(--sc-fill)] p-1">
          <button
            type="button"
            onClick={() => setActive("all")}
            className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${active === "all" ? "bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
          >
            Totaal
          </button>
          {platforms.map((p) => (
            <button
              key={p.platform}
              type="button"
              onClick={() => setActive(p.platform)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${active === p.platform ? "bg-gradient-to-br from-[#19a8ff] to-[#1b5fe0] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
            >
              <PlatformDot platform={p.platform} /> {PLATFORM[p.platform]?.label ?? p.platform}
            </button>
          ))}
        </div>
      </div>

      {current ? (
        <div className="sc-glass p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <PlatformDot platform={current.platform} />
            <span className="text-[15px] font-semibold">{PLATFORM[current.platform]?.label ?? current.platform}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Weergaven" value={current.views} />
            <Stat label="Bereik" value={current.reach} />
            <Stat label="Engagement" value={current.engagements} />
            <Stat label="Volgersgroei" value={current.followerGrowth} prefix={current.followerGrowth >= 0 ? "+" : ""} />
            <Stat label="Video's" value={current.videoCount} />
          </div>
          {current.bestVideo ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--sc-line)] pt-4 text-[13px]">
              <span className="text-[var(--color-ink-muted)]">Best presterende video: <span className="font-semibold text-[var(--color-ink)]">{current.bestVideo.title}</span> · {compact(current.bestVideo.views)} weergaven</span>
              {current.bestVideo.url ? <a href={current.bestVideo.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--sc-accent)] hover:underline">Bekijken <ExternalLink className="size-3.5" /></a> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((p) => (
            <button key={p.platform} type="button" onClick={() => setActive(p.platform)} className="sc-glass p-4 text-left transition-colors hover:border-white/20">
              <div className="flex items-center gap-2">
                <PlatformDot platform={p.platform} />
                <span className="text-sm font-semibold">{PLATFORM[p.platform]?.label ?? p.platform}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Stat label="Weergaven" value={p.views} />
                <Stat label="Bereik" value={p.reach} />
                <Stat label="Engagement" value={p.engagements} />
                <Stat label="Volgersgroei" value={p.followerGrowth} prefix={p.followerGrowth >= 0 ? "+" : ""} />
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
