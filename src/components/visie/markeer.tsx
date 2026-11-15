import { Fragment } from "react";
import { kaal } from "@/lib/visie/data";

/** Tekst tussen [[...]] is nog te bevestigen: gemarkeerd voor Jarno, gewone tekst voor het team. */
export function VisieTekst({ t, markeer }: { t: string; markeer: boolean }) {
  if (!markeer) return <>{kaal(t)}</>;
  return (
    <>
      {t.split(/(\[\[[^\]]+\]\])/g).map((d, i) => {
        const m = d.match(/^\[\[(.+)\]\]$/);
        return m ? (
          <mark key={i} title="Nog door Jarno te bevestigen" className="rounded bg-[#fff4c2] px-1 text-[#7a5a00]">{m[1]}</mark>
        ) : <Fragment key={i}>{d}</Fragment>;
      })}
    </>
  );
}

/** Klein label met het nummer van het kernprincipe; klikbaar naar de uitleg. */
export function PrincipeChip({ nr, titel }: { nr: number; titel?: string }) {
  return (
    <a
      href={`/visie#principe-${nr}`}
      title={titel ? `Principe ${nr}: ${titel}` : `Principe ${nr}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-line-strong)] px-2 py-0.5 text-2xs font-semibold text-[var(--color-ink-muted)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
    >
      <span className="grid size-3.5 place-items-center rounded-full bg-[var(--color-indigo-ink)] text-[9px] font-bold text-white">{nr}</span>
      {titel ?? `Principe ${nr}`}
    </a>
  );
}
