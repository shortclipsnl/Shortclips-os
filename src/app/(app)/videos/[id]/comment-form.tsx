"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { addComment, resolveThread } from "@/server/actions/videos";
import { Button, ErrorNote } from "@/components/ui";

export function CommentForm({
  videoId,
  canInternal,
  canClient,
}: {
  videoId: string;
  canInternal: boolean;
  canClient: boolean;
}) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "client">(
    canInternal ? "internal" : "client",
  );
  const [timecode, setTimecode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!canInternal && !canClient) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // "0:07" → milliseconden
    const parts = timecode.split(":").map(Number);
    const ms =
      timecode && parts.every((p) => !Number.isNaN(p))
        ? (parts.length === 2 ? parts[0]! * 60 + parts[1]! : parts[0]!) * 1000
        : null;

    start(async () => {
      const res = await addComment(videoId, { body, visibility, timecodeMs: ms });
      if (res.ok) {
        setBody("");
        setTimecode("");
        router.refresh();
      } else {
        setError(res.message ?? "Er ging iets mis.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Wat moet er aangepast worden?"
        className="sc-input resize-y"
        required
      />
      <div className="flex flex-wrap items-end gap-3">
        {canInternal && canClient ? (
          <div>
            <label className="sc-label" htmlFor="visibility">
              Zichtbaar voor
            </label>
            <select
              id="visibility"
              className="sc-input"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "internal" | "client")}
            >
              <option value="internal">Alleen intern</option>
              <option value="client">Ook de klant</option>
            </select>
          </div>
        ) : null}
        <div className="w-28">
          <label className="sc-label" htmlFor="timecode">
            Tijdcode
          </label>
          <input
            id="timecode"
            className="sc-input"
            placeholder="0:07"
            value={timecode}
            onChange={(e) => setTimecode(e.target.value)}
          />
        </div>
        <Button type="submit" size="md" disabled={pending || body.trim().length === 0}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Plaatsen
        </Button>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </form>
  );
}

export function ResolveButton({
  threadId,
  isResolved,
}: {
  threadId: string;
  isResolved: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await resolveThread(threadId);
          router.refresh();
        })
      }
      className={
        isResolved
          ? "inline-flex items-center gap-1 text-xs font-medium text-[var(--color-good)]"
          : "inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      }
    >
      <Check className="size-3.5" />
      {isResolved ? "opgelost" : "markeer opgelost"}
    </button>
  );
}
