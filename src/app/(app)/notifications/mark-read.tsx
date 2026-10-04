"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { markAllRead } from "@/server/actions/notifications";
import { Button } from "@/components/ui";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markAllRead();
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      Alles gelezen
    </Button>
  );
}
