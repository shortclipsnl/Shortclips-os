"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { strategyAction } from "@/server/actions/content-memory";

/**
 * Vult de strategie (filmstijl, formatvoorstellen, scriptopbouw) één keer
 * automatisch aan als die voor deze klant nog ontbreekt, en ververst daarna
 * de pagina. Normaal staat alles al klaar door de ochtendjob.
 */
export function StrategyAutoFill({ clientId, needed }: { clientId: string; needed: boolean }) {
  const router = useRouter();
  const asked = useRef(false);
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!needed || asked.current) return;
    asked.current = true;
    const t = window.setTimeout(async () => {
      setState("busy");
      const res = await strategyAction(clientId);
      if (res.ok) {
        setState("idle");
        router.refresh();
      } else {
        setState("error");
        setMsg(res.message);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [clientId, needed, router]);

  if (state === "idle") return null;
  return (
    <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5 text-[13px] text-[var(--color-ink-muted)]">
      {state === "busy" ? <Loader2 className="size-4 animate-spin" /> : null}
      {state === "busy"
        ? "Strategie wordt geanalyseerd op basis van de resultaten van deze klant (ongeveer een minuut)..."
        : `Strategie kon nu niet worden bijgewerkt: ${msg} Dit wordt morgenochtend automatisch opnieuw geprobeerd.`}
    </div>
  );
}
