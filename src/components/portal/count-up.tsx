"use client";

import { useEffect, useRef, useState } from "react";

const nf = new Intl.NumberFormat("nl-NL");

/**
 * Laat een getal zacht omhoog tellen bij binnenkomst — een subtiel premium-
 * detail voor kerncijfers. Start op 0 (ook server-side, dus geen hydration-
 * mismatch) en telt op naar de echte waarde; bij "reduce motion" meteen klaar.
 */
export function CountUp({
  value,
  prefix = "",
  duration = 750,
  className,
}: {
  value: number;
  prefix?: string;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || value <= 0) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {nf.format(display)}
    </span>
  );
}
