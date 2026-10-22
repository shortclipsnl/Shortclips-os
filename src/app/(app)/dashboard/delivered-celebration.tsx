"use client";

import { useEffect } from "react";

/**
 * Klein feestmoment voor de editor: confetti wanneer er deze maand een video is
 * opgeleverd — zodat het echt voelt als "yes, die is af". Speelt eenmaal per
 * nieuwe oplevering (de sleutel bevat het aantal, dus bij een extra oplevering
 * viert hij opnieuw) en niet bij prefers-reduced-motion.
 */
export function DeliveredCelebration({ monthKey, count }: { monthKey: string; count: number }) {
  useEffect(() => {
    if (count <= 0) return;
    const key = `sc-delivered-${monthKey}-${count}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* private venster e.d. — dan gewoon vieren */
    }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    (async () => {
      try {
        const mod = await import("canvas-confetti");
        const confetti = mod.default;
        const colors = ["#2E90FA", "#FF6A00", "#1d6b4c", "#ffd84d"];
        const end = Date.now() + 1200;
        (function frame() {
          if (cancelled) return;
          confetti({ particleCount: 3, angle: 60, spread: 60, startVelocity: 45, origin: { x: 0, y: 0.9 }, colors });
          confetti({ particleCount: 3, angle: 120, spread: 60, startVelocity: 45, origin: { x: 1, y: 0.9 }, colors });
          if (Date.now() < end) requestAnimationFrame(frame);
        })();
      } catch {
        /* confetti is bijzaak */
      }
    })();
    return () => { cancelled = true; };
  }, [monthKey, count]);

  return null;
}
