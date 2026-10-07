"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import {
  approveScript,
  approveVideo,
  commentOnScript,
} from "@/server/actions/portal";
import { Button, buttonClass, ErrorNote, InfoNote } from "@/components/ui";

export function VideoDecision({ videoId, frameUrl }: { videoId: string; frameUrl?: string | null }) {
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="accent"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await approveVideo(videoId);
              setResult(res);
              if (res.ok) router.refresh();
            })
          }
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Goedkeuren
        </Button>
        {frameUrl ? (
          <a href={frameUrl} target="_blank" rel="noreferrer" className={buttonClass({ variant: "secondary" })}>
            <ExternalLink className="size-4" /> Aanpassing vragen in Frame
          </a>
        ) : null}
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">
        Geef je feedback met tijdcode in Frame, zo blijft alles in één gebundelde ronde bij de juiste video.
      </p>

      {result ? (
        result.ok ? <InfoNote tone="good">{result.message}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}
    </div>
  );
}

export function ScriptDecision({ scriptId }: { scriptId: string }) {
  const [mode, setMode] = useState<"idle" | "feedback">("idle");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="space-y-3">
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="accent"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await approveScript(scriptId);
                setResult(res);
                if (res.ok) router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Akkoord
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode("feedback")}>
            Opmerking plaatsen
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            className="sc-input resize-y"
            rows={3}
            placeholder="Wat zou je graag anders zien in dit script?"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending || body.trim().length === 0}
              onClick={() =>
                start(async () => {
                  const res = await commentOnScript(scriptId, { body });
                  setResult(res);
                  if (res.ok) {
                    setBody("");
                    setMode("idle");
                    router.refresh();
                  }
                })
              }
            >
              Versturen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>
              Annuleren
            </Button>
          </div>
        </div>
      )}
      {result ? (
        result.ok ? <InfoNote tone="good">{result.message}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}
    </div>
  );
}
