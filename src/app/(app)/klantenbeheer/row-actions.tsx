"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setClientStatus } from "@/server/actions/clients";
import { LinkButton, Button } from "@/components/ui";

export function ClientRowActions({ slug, status }: { slug: string; status: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const stopped = status === "churned" || status === "paused";

  return (
    <div className="flex items-center justify-end gap-2">
      <LinkButton href={`/clients/${slug}/edit`} variant="secondary" size="sm">
        Bewerken
      </LinkButton>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setClientStatus(slug, stopped ? "active" : "churned");
            if (res.ok) router.refresh();
            else setErr(res.message ?? "Mislukt");
          })
        }
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {stopped ? "Heractiveren" : "Archiveren"}
      </Button>
      {err ? <span className="text-xs text-[var(--color-bad)]">{err}</span> : null}
    </div>
  );
}
