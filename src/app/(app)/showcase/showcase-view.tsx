"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Volume2, VolumeX } from "lucide-react";
import { AWARD_TIERS } from "@/server/awards/config";
import type { ShowcaseData } from "@/server/awards/service";
import { setAwardSound } from "@/server/actions/awards";
import { AwardBadge } from "./award-badge";
import { Celebration } from "./celebration";

const HEX = "50,1 99,25 99,75 50,99 1,75 1,25";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

export function ShowcaseView({
  data,
  ownView,
  editors,
  selectedEditorId,
}: {
  data: ShowcaseData;
  ownView: boolean;
  editors: { id: string; name: string }[];
  selectedEditorId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sound, setSound] = useState(data.awardSound);
  const [replayKey, setReplayKey] = useState<string | null>(null);

  const earnedMap = new Map(data.earned.map((e) => [e.awardKey, e.achievedAt]));
  const count = data.count;
  const nextTier = AWARD_TIERS.find((t) => count < t.threshold) ?? null;
  const prevThreshold = [...AWARD_TIERS].reverse().find((t) => count >= t.threshold)?.threshold ?? 0;
  const pct = nextTier ? Math.min(100, Math.max(0, ((count - prevThreshold) / (nextTier.threshold - prevThreshold)) * 100)) : 100;
  const timeline = [...data.earned].sort((a, b) => b.achievedAt.localeCompare(a.achievedAt)).slice(0, 5);
  const firstName = data.editorName.split(" ")[0] || "editor";

  function toggleSound() {
    const next = !sound;
    setSound(next);
    start(async () => { await setAwardSound(next); });
  }

  return (
    <div className="space-y-5">
      {/* Teamweergave: kies een editor. */}
      {!ownView ? (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--color-ink-muted)]">Showcase van</span>
          <select
            value={selectedEditorId}
            onChange={(e) => router.push(`/showcase?editor=${e.target.value}`)}
            className="sc-input h-9 py-0 text-sm"
          >
            {editors.map((ed) => <option key={ed.id} value={ed.id}>{ed.name}</option>)}
          </select>
        </label>
      ) : null}

      {/* a) Teller */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-card)]">
        <div className="text-5xl font-bold tracking-tight tabular-nums text-[var(--color-ink)]">{count}</div>
        <div className="mt-0.5 text-sm font-medium text-[var(--color-ink-muted)]">shorts opgeleverd</div>
        <p className="mx-auto mt-1 max-w-sm text-2xs text-[var(--color-ink-faint)]">Telt automatisch mee zodra een video is goedgekeurd door de klant.</p>
        <div className="mx-auto mt-4 grid max-w-md grid-cols-3 gap-2">
          {[
            { n: data.thisMonth, l: "deze maand" },
            { n: data.clientCount, l: data.clientCount === 1 ? "klant" : "klanten" },
            { n: `${data.earnedCount}/${data.totalAwards}`, l: "awards" },
          ].map((s) => (
            <div key={s.l} className="rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-2 py-2">
              <div className="text-lg font-bold tabular-nums text-[var(--color-ink)]">{s.n}</div>
              <div className="text-2xs text-[var(--color-ink-muted)]">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* b) Volgende award */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)]">
        {nextTier ? (
          <div className="flex items-center gap-4">
            <svg viewBox="0 0 100 100" width={72} height={72} className="shrink-0" aria-hidden="true">
              <polygon points={HEX} fill="none" stroke={nextTier.color} strokeWidth="2.5" strokeDasharray="5 4" />
              <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize={nextTier.badge.length > 2 ? 24 : 32} fontWeight={700} fill={nextTier.color} style={{ fontFamily: "var(--font-poppins), sans-serif" }}>{nextTier.badge}</text>
            </svg>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold text-[var(--color-ink)]">Volgende: {nextTier.name}</h3>
                <span className="shrink-0 text-xs font-medium tabular-nums text-[var(--color-ink-muted)]">Nog {nextTier.threshold - count}</span>
              </div>
              <p className="text-xs text-[var(--color-ink-muted)]">{nextTier.description}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: nextTier.color }} />
              </div>
              {data.projectionMonth ? <p className="mt-1.5 text-2xs text-[var(--color-ink-faint)]">Op jouw tempo rond {data.projectionMonth}.</p> : null}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-base font-semibold text-[var(--color-ink)]">Alle awards behaald</div>
            <p className="text-sm text-[var(--color-ink-muted)]">Je hebt elke award binnen. Legendarisch werk, {firstName}.</p>
          </div>
        )}
      </section>

      {/* c) Awardwand */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)]">
        <h3 className="mb-4 text-base font-semibold text-[var(--color-ink)]">Awards</h3>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4">
          {AWARD_TIERS.map((tier, i) => {
            const achievedAt = earnedMap.get(tier.key);
            const earned = Boolean(achievedAt);
            const alt = earned ? `${tier.name}, behaald ${fmtDate(achievedAt!)}` : `${tier.name}, nog ${tier.threshold - count} shorts`;
            return (
              <li key={tier.key} className="flex flex-col items-center gap-2 text-center">
                {earned && ownView ? (
                  <button type="button" onClick={() => setReplayKey(tier.key)} aria-label={`${alt}. Speel de viering opnieuw af.`} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-brand-500)]">
                    <AwardBadge tier={tier} earned delayIndex={i} sparkle={tier.key === "legend"} />
                  </button>
                ) : (
                  <span role="img" aria-label={alt}>
                    <AwardBadge tier={tier} earned={earned} delayIndex={i} sparkle={earned && tier.key === "legend"} />
                  </span>
                )}
                <div>
                  <div className="text-xs font-semibold text-[var(--color-ink)]">{tier.name}</div>
                  <div className="text-2xs text-[var(--color-ink-muted)]">{tier.threshold} shorts</div>
                  <div className="text-2xs" style={{ color: earned ? "var(--color-good)" : "var(--color-ink-faint)" }}>
                    {earned ? `Behaald ${fmtDate(achievedAt!)}` : `Nog ${Math.max(0, tier.threshold - count)}`}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* d) Tijdlijn */}
      {timeline.length > 0 ? (
        <section className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)]">
          <h3 className="mb-3 text-base font-semibold text-[var(--color-ink)]">Laatst behaald</h3>
          <ul className="space-y-2">
            {timeline.map((e) => {
              const tier = AWARD_TIERS.find((t) => t.key === e.awardKey);
              if (!tier) return null;
              return (
                <li key={e.awardKey} className="flex items-center gap-3">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: tier.color }} />
                  <span className="flex-1 text-sm font-medium text-[var(--color-ink)]">{tier.name}</span>
                  <span className="text-2xs text-[var(--color-ink-muted)]">{fmtDate(e.achievedAt)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* e) Instelling: geluid (alleen eigen weergave) */}
      {ownView ? (
        <button
          type="button"
          onClick={toggleSound}
          disabled={pending}
          className="inline-flex items-center gap-2 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          Geluid bij awards {sound ? "aan" : "uit"}
        </button>
      ) : null}

      {/* Viering opnieuw afspelen vanaf een behaalde badge. */}
      {replayKey ? (
        <Celebration
          awardKey={replayKey}
          firstName={firstName}
          nextRemaining={nextTier ? nextTier.threshold - count : null}
          awardSound={sound}
          mode="replay"
          onClose={() => setReplayKey(null)}
        />
      ) : null}
    </div>
  );
}
