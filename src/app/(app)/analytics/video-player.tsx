"use client";

import { useState } from "react";
import type { VideoCard } from "@/lib/resultaten-overzicht";

/**
 * Speelt een video af binnen het portaal. Voorkeur: het echte bestand uit
 * Frame.io (eigen speler, werkt altijd). Anders de officiële speler van het
 * platform. Lukt geen van beide, dan een nette melding met de link.
 */
export function VideoPlayer({ v, autoPlay = true, muted = false, className = "" }: {
  v: Pick<VideoCard, "id" | "assetId" | "embedUrl" | "clientName" | "thumb">;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const [frameFailed, setFrameFailed] = useState(false);
  if (v.assetId && !frameFailed) {
    return (
      <video
        key={v.assetId}
        src={`/api/portal/frame/${v.assetId}/play`}
        poster={`/api/portal/frame/${v.assetId}/thumb`}
        controls
        autoPlay={autoPlay}
        muted={muted}
        playsInline
        onError={() => setFrameFailed(true)}
        className={`size-full bg-black object-contain ${className}`}
      />
    );
  }
  if (v.embedUrl) {
    return (
      <iframe
        key={v.id}
        src={v.embedUrl}
        title={`Video van ${v.clientName}`}
        className={`size-full border-0 bg-black ${className}`}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return (
    <div className={`flex size-full items-center justify-center bg-black p-6 text-center text-sm text-white/80 ${className}`}>
      Deze video kan niet in het portaal worden afgespeeld.
    </div>
  );
}
