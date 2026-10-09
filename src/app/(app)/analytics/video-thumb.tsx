"use client";

import { useState } from "react";
import { Film } from "lucide-react";

/**
 * Thumbnail van een video (9:16). Valt terug op een nette donkerblauwe
 * placeholder wanneer er geen thumbnail is of de afbeelding niet laadt — zo
 * verzinnen we nooit beeld dat er niet is.
 */
export function VideoThumb({ src, title, ratio = "aspect-[9/16]" }: { src: string | null; title: string; ratio?: string }) {
  const [failed, setFailed] = useState(false);
  const show = src && !failed;
  return (
    <div className={`relative ${ratio} w-full overflow-hidden bg-[var(--color-indigo-ink)]`}>
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={title} className="size-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 text-white/40">
          <Film className="size-7" />
          <span className="text-2xs">geen thumbnail</span>
        </div>
      )}
    </div>
  );
}
