"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { approveVideo } from "@/server/actions/portal";
import { portalBtn } from "@/components/portal/status-pill";

/** Akkoord op alle video's van een sessie (één editingproject per opnamedag). */
export function SessionApprove({ deliverableId }: { deliverableId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text?: string } | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        disabled={pending}
        className={portalBtn.act}
        onClick={() =>
          start(async () => {
            const res = await approveVideo(deliverableId);
            setMsg({ ok: res.ok, text: res.message });
            if (res.ok) router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Alles goedkeuren
      </button>
      {msg && !msg.ok ? <span className="text-[12px] text-[var(--st-red)]">{msg.text ?? "Goedkeuren lukte niet."}</span> : null}
    </div>
  );
}
