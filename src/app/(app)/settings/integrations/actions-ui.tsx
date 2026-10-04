"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plug, RefreshCw } from "lucide-react";
import { runSyncJob, testIntegration } from "@/server/actions/integrations";
import { Button, ErrorNote, InfoNote } from "@/components/ui";

export function TestButton({ provider, canTest }: { provider: string; canTest: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const router = useRouter();

  if (!canTest) return null;

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await testIntegration(provider);
            setResult(res);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
        Verbinding testen
      </Button>
      {result ? (
        result.ok ? <InfoNote tone="good">{result.message}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}
    </div>
  );
}

export function JobButton({ job, label }: { job: string; label: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await runSyncJob(job);
            setResult(res);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {label}
      </Button>
      {result ? (
        result.ok ? <InfoNote tone="good">{result.message}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}
    </div>
  );
}
