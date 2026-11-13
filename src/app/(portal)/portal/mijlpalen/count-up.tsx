"use client";

import { useEffect, useRef, useState } from "react";

const nf = new Intl.NumberFormat("nl-NL");

/**
 * Telt bij het openen van de pagina vloeiend op van 0 naar de echte waarde.
 * Start opnieuw bij elk bezoek (de component wordt per bezoek opnieuw geladen).
 * Bij "verminderde beweging" staat direct het eindgetal er. Schermlezers krijgen
 * altijd meteen het echte getal.
 */
export function CountUp({ value, duration = 1600, delay = 0, format = (n: number) => nf.format(n) }: { value: number; duration?: number; delay?: number; format?: (n: number) => string }) {
  // Voortgang van de animatie (0 tot 1).
  const [prog, setProg] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(value) || value <= 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      // Verminderde beweging: direct het eindgetal, zonder optellen.
      raf.current = requestAnimationFrame(() => setProg(1));
      return () => cancelAnimationFrame(raf.current);
    }
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t + delay;
      const p = Math.min(1, Math.max(0, (t - start) / duration));
      setProg(p);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration, delay]);

  // easeOutExpo: snel weg, rustig landen op het eindgetal
  const eased = prog >= 1 ? 1 : 1 - Math.pow(2, -10 * prog);
  const shown = Math.round(value * eased);
  return (
    <span className="tabular-nums">
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
