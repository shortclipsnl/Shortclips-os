"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CelebrationContext } from "@/server/awards/service";
import { markCelebrated } from "@/server/actions/awards";
import { Celebration } from "./celebration";

/**
 * Toont de vieringskaart bij binnenkomst op elke pagina als er een nog niet
 * gevierde award is. Markeert de award(s) als gevierd zodra de editor opent.
 */
export function CelebrationGate({ context }: { context: CelebrationContext | null }) {
  const router = useRouter();
  const [done, setDone] = useState(false);

  if (!context || done) return null;

  return (
    <Celebration
      awardKey={context.awardKey}
      firstName={context.firstName}
      nextRemaining={context.nextRemaining}
      awardSound={context.awardSound}
      mode="firstOpen"
      onOpened={() => { void markCelebrated(); }}
      onClose={() => { setDone(true); router.refresh(); }}
    />
  );
}
