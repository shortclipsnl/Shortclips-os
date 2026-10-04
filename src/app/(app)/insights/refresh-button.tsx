"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { refreshInsights } from "@/server/actions/ai";
import { Button, ErrorNote, InfoNote } from "@/components/ui";

export function RefreshInsights() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await refreshInsights();
            setResult(res);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        Analyses opnieuw draaien
      </Button>
      {result ? (
        result.ok ? <InfoNote tone="good">{result.message}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}
    </div>
  );
}
