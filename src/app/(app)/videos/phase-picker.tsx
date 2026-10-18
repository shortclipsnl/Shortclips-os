"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { changeVideoStatus } from "@/server/actions/videos";
import { STATUS_TO_PHASE, VIDEO_PHASE_META, type VideoPhase } from "@/lib/statuses";

/** Volle, onderscheidende kleur per productiefase (Monday-stijl) — overal gelijk. */
export const PHASE_COLOR: Record<VideoPhase, string> = {
  gepland: "var(--color-ink-muted)",
  beelden_binnen: "var(--color-info)",
  in_edit: "var(--color-brand-600)",
  interne_controle: "var(--color-violet)",
  bij_klant: "var(--color-warn)",
  feedback_verwerken: "var(--color-bad)",
  klaar: "var(--color-good)",
  live: "var(--color-indigo-ink)",
};

/**
 * De fases waartussen je handmatig kunt wisselen, met de status die gezet wordt
 * als je die fase kiest. "gepland" en "live" zitten er niet bij: dat zijn geen
 * handmatige werkfases in dit bord.
 */
const MOVABLE: { phase: VideoPhase; status: string; label: string }[] = [
  { phase: "beelden_binnen", status: "awaiting_editor", label: "Beelden binnen" },
  { phase: "in_edit", status: "editing", label: "In edit" },
  { phase: "interne_controle", status: "internal_review", label: "Interne controle" },
  { phase: "bij_klant", status: "client_review", label: "Feedback klant" },
  { phase: "feedback_verwerken", status: "client_revision", label: "Feedback verwerken" },
  { phase: "klaar", status: "approved", label: "Afgerond" },
];

/**
 * Volledig gekleurde, klikbare fasepil. De huidige fase staat als volle kleur;
 * klikken klapt de andere fases eronder uit (ook in kleur). Een keuze zet de
 * bijbehorende status via changeVideoStatus, waardoor de video automatisch naar
 * het juiste bord/fase verspringt.
 */
export function PhasePicker({
  videoId,
  status,
  canEdit,
  size = "md",
}: {
  videoId: string;
  status: string;
  canEdit: boolean;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  const phase = (STATUS_TO_PHASE[status as keyof typeof STATUS_TO_PHASE] ?? "beelden_binnen") as VideoPhase;
  const color = PHASE_COLOR[phase];
  const label = VIDEO_PHASE_META[phase].label;
  const pad = size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs";

  const choose = (target: { phase: VideoPhase; status: string }) => {
    setOpen(false);
    if (target.phase === phase) return;
    setErr(null);
    start(async () => {
      const res = await changeVideoStatus(videoId, target.status);
      if (res.ok) router.refresh();
      else setErr(res.message ?? "Wijzigen mislukt");
    });
  };

  if (!canEdit) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full font-semibold text-white ${pad}`} style={{ background: color }}>
        {label}
      </span>
    );
  }

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={pending}
        className={`inline-flex items-center gap-1 rounded-full font-semibold text-white ${pad}`}
        style={{ background: color, boxShadow: open ? "0 0 0 2px var(--color-ink)" : undefined }}
        title="Klik om de fase te wijzigen"
      >
        {label}
        {pending ? <Loader2 className="size-3 animate-spin" /> : <ChevronDown className="size-3 opacity-80" />}
      </button>
      {err ? <span className="ml-1.5 text-2xs font-medium text-[var(--color-bad)]">{err}</span> : null}
      {open ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {MOVABLE.map((m) => (
            <button
              key={m.phase}
              type="button"
              onClick={() => choose(m)}
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold text-white ${m.phase === phase ? "ring-2 ring-[var(--color-ink)]" : "opacity-80 hover:opacity-100"}`}
              style={{ background: PHASE_COLOR[m.phase] }}
            >
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
