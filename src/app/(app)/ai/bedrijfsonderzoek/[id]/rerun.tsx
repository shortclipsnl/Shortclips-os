"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { runResearch } from "@/server/actions/sales-research";
import { Button, ErrorNote } from "@/components/ui";

export function RerunButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const res = await runResearch(id);
            if (res.ok) router.refresh();
            else setErr(res.message ?? "Mislukt");
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {label}
      </Button>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </>
  );
}
