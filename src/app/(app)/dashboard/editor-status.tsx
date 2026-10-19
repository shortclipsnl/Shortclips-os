"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { VIDEO_STATUS, type VideoStage } from "@/lib/statuses";
import { changeVideoStatus } from "@/server/actions/videos";

/**
 * Voortgangsbesturing voor de editor op zijn eigen video (§5). De editor zet
 * zelf de status binnen zijn eigen stappen; statussen vanaf de klantcontrole
 * liggen buiten de editor en worden alleen-lezen getoond.
 *
 * 5 stappen → echte statussen:
 *  nog niet gestart (awaiting_editor) · bezig (editing) ·
 *  eerste versie/definitief aangeleverd (internal_review) · feedback verwerken (editor_revision)
 */
const EDITOR_STEPS: { value: VideoStage; label: string }[] = [
  { value: "recorded", label: "Binnenkort beschikbaar" },
  { value: "awaiting_editor", label: "Nog niet gestart" },
  { value: "editing", label: "Bezig met editing" },
  { value: "internal_review", label: "Aangeleverd voor controle" },
  { value: "editor_revision", label: "Feedback verwerken" },
];
const EDITOR_SETTABLE = new Set<string>(EDITOR_STEPS.map((s) => s.value));

export function EditorStatusControl({ videoId, status }: { videoId: string; status: string }) {
  const [current, setCurrent] = useState(status);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  // Buiten de editor-stappen (bij klant, goedgekeurd, live) → alleen-lezen.
  if (!EDITOR_SETTABLE.has(current)) {
    return <Badge tone={VIDEO_STATUS[current as VideoStage]?.tone ?? "neutral"}>{VIDEO_STATUS[current as VideoStage]?.label ?? current}</Badge>;
  }

  function change(next: string) {
    const prev = current;
    setCurrent(next);
    setErr(null);
    start(async () => {
      const res = await changeVideoStatus(videoId, next);
      if (!res.ok) { setCurrent(prev); setErr(res.message ?? "Mislukt"); }
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="relative inline-flex items-center">
        <select
          value={current}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          aria-label="Voortgang bijwerken"
          className="appearance-none rounded-full bg-[var(--color-info-soft)] px-2.5 py-1 pr-6 text-xs font-medium text-[#0060a8] cursor-pointer"
        >
          {EDITOR_STEPS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {pending ? <Loader2 className="pointer-events-none absolute right-1.5 size-3 animate-spin opacity-60" /> : null}
      </div>
      {err ? <span className="text-2xs text-[var(--color-bad)]">{err}</span> : null}
    </div>
  );
}
