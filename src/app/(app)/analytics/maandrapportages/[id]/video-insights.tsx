import { EyeOff, Eye } from "lucide-react";
import { Badge, buttonClass, type Tone } from "@/components/ui";
import type { VideoAnalyse, VideoPunt } from "@/server/reports/analysis";

export type ReviewVideo = {
  key: string; id: string; titel: string; datum: string | null; platform: string | null;
  views: number; likes: number; reacties: number; shares: number; saves: number;
  gemKijktijdSec: number | null; uitkijkPct?: number | null; duurSec?: number | null;
  scriptHook?: string | null; thumb: string | null; analyse: VideoAnalyse | null;
};

const nf = (n: number) => Math.round(n).toLocaleString("nl-NL");
const pctv = (n: number | null | undefined) => (typeof n === "number" ? `${(Math.round(n * 10) / 10).toLocaleString("nl-NL")}%` : "–");
const OORDEEL: Record<string, Tone> = { herhalen: "good", aanpassen: "info", stoppen: "neutral" };
const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn" };

function Punten({ titel, kleur, items }: { titel: string; kleur: string; items?: VideoPunt[] }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink)]"><span className="inline-block size-1.5 rounded-full" style={{ background: kleur }} />{titel}</p>
      {(items ?? []).length ? (
        <div className="divide-y divide-[var(--color-line)]">
          {(items ?? []).map((p, i) => (
            <div key={i} className="py-1.5">
              {p.titel ? <p className="text-sm font-semibold text-[var(--color-ink)]">{p.titel}</p> : null}
              <p className="text-sm text-[var(--color-ink)]">{p.uitleg}</p>
              {p.bewijs ? <p className="text-2xs text-[var(--color-ink-muted)]">{p.bewijs}</p> : null}
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-[var(--color-ink-faint)]">–</p>}
    </div>
  );
}

/** Interne inzichten per video, in dezelfde leesvolgorde als de interne PDF. */
export function VideoInsights({ videos, hidden = [], onToggleHidden, busy }: { videos: ReviewVideo[]; hidden?: string[]; onToggleHidden?: (id: string, hide: boolean) => void; busy?: boolean }) {
  if (videos.length === 0) return null;
  const gem = videos.reduce((s, v) => s + v.views, 0) / videos.length;
  return (
    <div className="space-y-4">
      <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Per video: wat leren we</p>
      {videos.map((v, i) => {
        const a = v.analyse;
        const inter = v.views > 0 ? ((v.likes + v.reacties + v.shares + v.saves) / v.views) * 100 : null;
        const hook = a?.hook || v.scriptHook || (v.titel || "").split(/[.!?\n]/)[0];
        const rows = a ? ([["Hook", a.betereHook], ["Script", a.script], ["Opname", a.opname], ["Montage", a.montage]] as const).filter(([, t]) => t) : [];
        return (
          <div key={v.key} className={`rounded-[var(--radius-sm)] border p-4 ${hidden.includes(v.id) ? "border-dashed border-[var(--color-line-strong)] opacity-80" : "border-[var(--color-line)]"}`}>
            {hidden.includes(v.id) || onToggleHidden ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-2.5 py-1.5 text-xs">
                <span className="text-[var(--color-ink-muted)]">{hidden.includes(v.id) ? "Staat niet in de klantversie (wel in de interne versie)." : "Staat in de klantversie."}</span>
                {onToggleHidden ? (
                  <button type="button" disabled={busy} onClick={() => onToggleHidden(v.id, !hidden.includes(v.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    {hidden.includes(v.id) ? <><Eye className="size-3.5" /> Weer tonen aan klant</> : <><EyeOff className="size-3.5" /> Niet tonen aan klant</>}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">Video {i + 1} van {videos.length} · {v.platform ? PLATFORM[v.platform] ?? v.platform : ""}{v.datum ? ` · ${v.datum}` : ""}{a?.hookType ? ` · hook: ${a.hookType}` : ""}</p>
                <p className="mt-0.5 font-semibold text-[var(--color-ink)]">{(v.titel || "Video").split("\n")[0]}</p>
              </div>
              {a ? <Badge tone={OORDEEL[a.oordeel] ?? "neutral"}>{a.oordeel}</Badge> : null}
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-[96px_1fr]">
              {v.thumb ? <div className="h-[170px] w-[96px] rounded-[var(--radius-sm)] bg-cover bg-center" style={{ backgroundImage: `url('${v.thumb}')` }} /> : <div className="h-[170px] w-[96px] rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)]" />}
              <div className="min-w-0 space-y-3">
                <div className="grid grid-cols-2 gap-3 border-y border-[var(--color-line)] py-2 sm:grid-cols-4">
                  <div><p className="text-lg font-bold text-[var(--color-ink)]">{nf(v.views)}</p><p className="text-2xs text-[var(--color-ink-muted)]">weergaven{gem > 0 ? ` · ${(Math.round((v.views / gem) * 10) / 10).toLocaleString("nl-NL")}× gem.` : ""}</p></div>
                  <div><p className="text-lg font-bold text-[var(--color-ink)]">{typeof v.gemKijktijdSec === "number" ? `${v.gemKijktijdSec}${typeof v.duurSec === "number" ? ` / ${v.duurSec}` : ""} s` : "–"}</p><p className="text-2xs text-[var(--color-ink-muted)]">gem. kijktijd</p></div>
                  <div><p className="text-lg font-bold text-[var(--color-ink)]">{pctv(v.uitkijkPct)}</p><p className="text-2xs text-[var(--color-ink-muted)]">bekeken</p></div>
                  <div><p className="text-lg font-bold text-[var(--color-ink)]">{pctv(inter)}</p><p className="text-2xs text-[var(--color-ink-muted)]">interactie</p></div>
                </div>
                <p className="text-2xs text-[var(--color-ink-muted)]">{nf(v.likes)} likes · {nf(v.reacties)} reacties · {nf(v.shares)} shares · {nf(v.saves)} saves{a?.kijkgedrag ? ` · ${a.kijkgedrag}` : ""}</p>
                <div className="border-l-2 border-[var(--color-ink)] pl-3"><p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink)]">Hook <span className="font-normal normal-case text-[var(--color-ink-muted)]">{a?.hookBron === "script" ? "uit script" : "afgeleid uit caption"}</span></p><p className="text-sm font-semibold text-[var(--color-ink)]">{hook}</p></div>
                {a ? <div className="border-l-2 border-[var(--color-ink)] pl-3"><p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink)]">Call to action <span className="font-normal normal-case text-[var(--color-ink-muted)]">{a.ctaType || "geen"}</span></p><p className="text-sm font-semibold text-[var(--color-ink)]">{a.cta || "Geen oproep in deze video"}</p></div> : null}
              </div>
            </div>
            {a ? (
              <>
                <div className="mt-4 grid gap-4 border-t border-[var(--color-line)] pt-3 sm:grid-cols-2">
                  <Punten titel="Wat werkte" kleur="var(--color-good)" items={a.watWerkte} />
                  <Punten titel="Wat moet beter" kleur="#c2410c" items={a.watBeter} />
                </div>
                {a.les ? <div className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] p-3 text-sm font-semibold text-white"><span className="block text-2xs uppercase tracking-wide opacity-70">Les</span>{a.les}</div> : null}
                {rows.length ? (
                  <table className="mt-3 w-full text-sm">
                    <tbody>{rows.map(([l, t]) => <tr key={l} className="border-b border-[var(--color-line)] last:border-0"><th className="w-24 py-1.5 text-left align-top font-semibold text-[var(--color-ink)]">{l}</th><td className="py-1.5 text-[var(--color-ink)]">{t}</td></tr>)}</tbody>
                  </table>
                ) : null}
              </>
            ) : <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen analyse per video. Gebruik AI opnieuw.</p>}
          </div>
        );
      })}
    </div>
  );
}
