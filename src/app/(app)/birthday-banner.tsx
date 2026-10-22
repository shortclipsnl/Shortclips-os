"use client";

import { useEffect } from "react";

/**
 * Feestelijke balk boven in het portaal op iemands verjaardag, zichtbaar voor
 * het hele team. Confetti speelt eenmaal per dag per bezoeker (localStorage),
 * en niet bij prefers-reduced-motion.
 */
export function BirthdayBanner({ names }: { names: string[] }) {
  useEffect(() => {
    const key = `sc-bday-${new Date().toLocaleDateString("en-CA")}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* private window e.d. — dan gewoon confetti tonen */
    }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    (async () => {
      try {
        const mod = await import("canvas-confetti");
        const confetti = mod.default;
        const colors = ["#2E90FA", "#FF6A00", "#00003b", "#ffd84d"];
        const end = Date.now() + 1600;
        (function frame() {
          if (cancelled) return;
          confetti({ particleCount: 4, angle: 60, spread: 62, startVelocity: 48, origin: { x: 0, y: 0.8 }, colors });
          confetti({ particleCount: 4, angle: 118, spread: 62, startVelocity: 48, origin: { x: 1, y: 0.8 }, colors });
          if (Date.now() < end) requestAnimationFrame(frame);
        })();
      } catch {
        /* confetti is bijzaak; de balk blijft staan */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (names.length === 0) return null;
  const who =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "is" : "zijn";

  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-2 text-center text-sm font-semibold text-white"
      style={{ background: "linear-gradient(90deg, #00003b 0%, #2E90FA 55%, #FF6A00 100%)" }}
      role="status"
    >
      <span aria-hidden="true">🎉</span>
      <span>{who} {verb} jarig! Van harte gefeliciteerd 🎂</span>
      <span aria-hidden="true">🎉</span>
    </div>
  );
}
