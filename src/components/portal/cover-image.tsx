"use client";

import { useState } from "react";

/**
 * Omslag die zacht infadet over de kleur-placeholder eronder — geen "pop" meer
 * als de Frame-afbeelding binnenkomt. Premium-detail, respecteert reduced motion
 * via de CSS-transition (die het OS desgewenst uitschakelt).
 */
export function CoverImage({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      onLoad={() => setLoaded(true)}
      className={`absolute inset-0 size-full object-cover transition-opacity duration-700 ease-out ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
