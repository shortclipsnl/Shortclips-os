"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { checkIntegrationsNow, sendTestAlert } from "@/server/actions/monitoring";
import { Button, ErrorNote, InfoNote } from "@/components/ui";

export function MonitorActions() {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"check" | "mail" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  const run = (kind: "check" | "mail") =>
    start(async () => {
      setBusy(kind);
      setResult(null);
      const res = kind === "check" ? await checkIntegrationsNow() : await sendTestAlert();
      setResult(res);
      setBusy(null);
      router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("mail")}>
          {busy === "mail" ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
          Testmelding sturen
        </Button>
        <Button size="sm" disabled={pending} onClick={() => run("check")}>
          {busy === "check" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Nu controleren
        </Button>
      </div>
      {result ? (result.ok ? <InfoNote tone="good">{result.message}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>) : null}
    </div>
  );
}
