"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { backfillThumbnailsAction } from "@/server/actions/content-memory";

/** Vult ontbrekende omslagen van deze klant op de achtergrond aan en ververst de pagina. */
export function ThumbBackfill({ clientId, missing }: { clientId: string; missing: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!missing) return;
    const key = `cg-thumbs-${clientId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* geen opslag: gewoon één keer proberen */
    }
    let alive = true;
    void backfillThumbnailsAction(clientId).then((r) => { if (alive && r.updated) router.refresh(); });
    return () => { alive = false; };
  }, [clientId, missing, router]);
  return null;
}
