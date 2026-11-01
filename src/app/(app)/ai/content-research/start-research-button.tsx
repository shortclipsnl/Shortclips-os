"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { startResearch } from "@/server/actions/content-research";

export function StartResearchButton({
  clientId,
  running,
  variant = "secondary",
  label = "Onderzoek opnieuw",
}: {
  clientId: string;
  running?: boolean;
  variant?: "primary" | "accent" | "secondary" | "ghost";
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const busy = pending || running;

  function go() {
    setErr(null);
    start(async () => {
      const res = await startResearch(clientId);
      if (!res.ok) setErr(res.message ?? "Er ging iets mis.");
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={go} disabled={busy} className={buttonClass({ variant, size: "sm" })}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        {running ? "Onderzoek bezig…" : label}
      </button>
      {err ? <span className="text-xs text-[var(--color-bad)]">{err}</span> : null}
    </span>
  );
}
