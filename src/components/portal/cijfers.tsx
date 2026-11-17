import { Fragment } from "react";
import { splitNumbers } from "@/lib/cijfers";

/**
 * Toont een zin met elk getal dikgedrukt, zodat cijfers in lopende tekst van
 * rapportages direct opvallen (zelfde regel als in de PDF-rapportages).
 */
export function Cijfers({ text }: { text: string }) {
  return (
    <>
      {splitNumbers(text).map((p, i) =>
        p.num ? (
          <strong key={i} className="font-semibold whitespace-nowrap text-[var(--sc-ink,#fff)]">{p.text}</strong>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
