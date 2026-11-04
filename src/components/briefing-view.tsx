import Link from "next/link";
import { FileDown } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import type { EditorBriefing } from "@/server/actions/ai-tools";
import type { BriefingStatus, VideoBriefing } from "@/server/briefing/service";

export const BRIEFING_STATUS: Record<BriefingStatus, { label: string; tone: Tone }> = {
  geen: { label: "Nog geen briefing", tone: "neutral" },
  bezig: { label: "Bezig met genereren", tone: "info" },
  klaar: { label: "Klaar", tone: "good" },
  bijgewerkt_script: { label: "Bijgewerkt script", tone: "violet" },
  mislukt: { label: "Mislukt", tone: "bad" },
};

/**
 * Compacte editor-briefing: algemene aandachtspunten, overzicht van de video's
 * (alleen titels) en per-video aandachtspunten (alléén wanneer er iets bijzonders
 * is). Herhaalt het script niet.
 */
export function BriefingView({
  briefing,
  status,
  pdfHref,
}: {
  briefing: EditorBriefing | null;
  status: BriefingStatus;
  pdfHref?: string;
}) {
  const st = BRIEFING_STATUS[status] ?? BRIEFING_STATUS.geen;

  if (!briefing || status === "geen") {
    return (
      <div className="px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        {status === "bezig"
          ? "De briefing wordt automatisch gegenereerd zodra de scripts klaarstaan…"
          : status === "mislukt"
            ? "Genereren is mislukt. De volgende ronde probeert het opnieuw."
            : "Er is nog geen briefing. Die ontstaat automatisch zodra de scriptcontrole-PDF klaarstaat."}
      </div>
    );
  }

  // Null-safe: AI-briefings kunnen ontbrekende velden of verkeerde types hebben.
  // Nooit laten crashen (dat legt het hele scherm om) — hooguit minder tonen.
  const shorts = (Array.isArray(briefing.shorts) ? briefing.shorts : []).filter((s) => s && typeof s === "object");
  const algemeen = (Array.isArray(briefing.projectIntro?.algemeneAandachtspunten) ? briefing.projectIntro!.algemeneAandachtspunten : [])
    .filter((a): a is string => typeof a === "string" && a.trim() !== "");
  const punten = (s: { aandachtspunten?: unknown }) =>
    (Array.isArray(s.aandachtspunten) ? s.aandachtspunten : []).filter((a): a is string => typeof a === "string" && a.trim() !== "");
  const specifiek = shorts.filter((s) => punten(s).length > 0);

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        {pdfHref ? (
          <Link href={pdfHref} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline">
            <FileDown className="size-3.5" /> PDF
          </Link>
        ) : null}
      </div>

      {algemeen.length > 0 ? (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Algemene aandachtspunten</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {algemeen.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{`Overzicht video's (${shorts.length})`}</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
          {shorts.map((s, i) => <li key={i}>{(typeof s.titel === "string" && s.titel) || `Video ${i + 1}`}</li>)}
        </ol>
      </div>

      {specifiek.length > 0 ? (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Specifieke aandachtspunten per video</p>
          <div className="mt-1 space-y-1.5 text-sm">
            {specifiek.map((s, i) => (
              <div key={i}>
                <span className="font-medium">{(typeof s.titel === "string" && s.titel) || `Video ${i + 1}`}:</span>{" "}
                <span className="text-[var(--color-ink-muted)]">{punten(s).join(" · ")}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Editor-weergave voor één video: de aandachtspunten van déze video eerst, dan
 * de algemene aandachtspunten van de opnamesessie. Het script zelf staat al
 * elders; dit is alleen het montage-overzicht.
 */
export function VideoBriefingView({ briefing, pdfHref }: { briefing: VideoBriefing; pdfHref?: string }) {
  const heeftIets = briefing.videoAandachtspunten.length > 0 || briefing.algemeneAandachtspunten.length > 0;
  if (!heeftIets) return null;

  return (
    <div className="mt-3 space-y-3 text-sm">
      {briefing.videoAandachtspunten.length > 0 ? (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Voor deze video</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {briefing.videoAandachtspunten.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      ) : null}

      {briefing.algemeneAandachtspunten.length > 0 ? (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Algemeen deze opname</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[var(--color-ink-muted)]">
            {briefing.algemeneAandachtspunten.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      ) : null}

      {pdfHref ? (
        <Link href={pdfHref} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline">
          <FileDown className="size-3.5" /> Volledige briefing (PDF)
        </Link>
      ) : null}
    </div>
  );
}
