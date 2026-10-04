"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2 } from "lucide-react";
import { changeVideoStatus, assignEditor } from "@/server/actions/videos";
import { Button, ErrorNote, InfoNote } from "@/components/ui";
import { VIDEO_STAGES, VIDEO_STATUS, type VideoStage } from "@/lib/statuses";

/** Logische vervolgstappen, zodat je niet door dertien statussen hoeft te scrollen. */
const NEXT_STEPS: Record<string, VideoStage[]> = {
  recorded: ["footage_upload"],
  footage_upload: ["awaiting_editor"],
  awaiting_editor: ["editing"],
  editing: ["internal_review"],
  internal_review: ["editor_revision", "client_review"],
  editor_revision: ["internal_review"],
  client_review: ["client_revision", "approved"],
  client_revision: ["internal_review"],
  approved: ["ready_to_publish"],
  ready_to_publish: ["scheduled"],
  scheduled: ["published"],
  published: ["analysis_available"],
  analysis_available: [],
};

export function StatusControl({
  videoId,
  status,
  canWrite,
}: {
  videoId: string;
  status: string;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const router = useRouter();

  if (!canWrite) return null;

  const suggested = NEXT_STEPS[status] ?? [];
  const options = showAll
    ? VIDEO_STAGES.filter((s) => s !== status)
    : suggested;

  function move(next: string) {
    start(async () => {
      const res = await changeVideoStatus(videoId, next);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {options.map((next) => (
          <Button
            key={next}
            size="sm"
            variant={suggested.includes(next) ? "accent" : "secondary"}
            disabled={pending}
            onClick={() => move(next)}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronRight className="size-3.5" />}
            {VIDEO_STATUS[next]?.label ?? next}
          </Button>
        ))}
        {options.length === 0 ? (
          <span className="text-sm text-[var(--color-ink-muted)]">
            Dit is de laatste stap in de pipeline.
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:underline"
        >
          {showAll ? "alleen logische stappen" : "andere status kiezen"}
        </button>
      </div>

      {result ? (
        result.ok ? (
          <InfoNote tone="good">{result.message}</InfoNote>
        ) : (
          <ErrorNote>{result.message}</ErrorNote>
        )
      ) : null}
    </div>
  );
}

export function EditorPicker({
  videoId,
  editorId,
  options,
}: {
  videoId: string;
  editorId: string | null;
  options: Array<{ id: string; fullName: string }>;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <label className="sc-label" htmlFor="editor">
        Editor
      </label>
      <select
        id="editor"
        className="sc-input"
        defaultValue={editorId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const value = e.target.value || null;
          start(async () => {
            const res = await assignEditor(videoId, value);
            setMessage(res.message ?? null);
            if (res.ok) router.refresh();
          });
        }}
      >
        <option value="">Geen editor toegewezen</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.fullName}
          </option>
        ))}
      </select>
      {message ? (
        <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">{message}</p>
      ) : null}
    </div>
  );
}
