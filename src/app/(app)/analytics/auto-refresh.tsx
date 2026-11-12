"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Haalt de resultatenpagina periodiek opnieuw op (serverzijdig, dus verse
 * cijfers en een opnieuw berekende rangschikking) zolang het tabblad zichtbaar
 * is. Bij terugkeren naar het tabblad wordt direct ververst.
 */
export function AutoRefresh({ intervalMs = 5 * 60 * 1000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible" && Date.now() - last > intervalMs) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, intervalMs]);
  return null;
}
