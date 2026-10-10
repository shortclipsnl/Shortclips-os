/**
 * Verticale, doorlopende presentatie van het Shortclips-team op de loginpagina.
 * De foto's bewegen rustig van boven naar beneden door het blauwe vlak. Pure CSS
 * (geen JavaScript) → geen merkbare invloed op de snelheid van de pagina.
 */
const TEAM = [
  { name: "Jarno", role: "Founder & Creative Director", img: "/team/jarno.png" },
  { name: "Milou", role: "Content Creative", img: "/team/milou.png" },
  { name: "Jiska", role: "Content Creative", img: "/team/jeska.png" },
  { name: "Rutger", role: "Head of Content", img: "/team/rutger.png" },
  { name: "Nynke", role: "Presentatrice", img: "/team/nynke.png" },
  { name: "Quinn", role: "Short Video Creative", img: "/team/quinn.png" },
  { name: "Fabian", role: "Short Video Creative", img: "/team/fabian.png" },
  { name: "Sem", role: "Short Video Creative", img: "/team/sem.png" },
  { name: "Max", role: "Brand Designer", img: "/team/max.png" },
];

function Card({ name, role, img }: { name: string; role: string; img: string }) {
  return (
    <figure className="overflow-hidden rounded-[var(--radius-lg)] border border-white/10 bg-white/5">
      <div className="relative aspect-square w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt={`${name} — ${role}`} className="size-full object-cover" loading="lazy" draggable={false} />
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[var(--color-indigo-deep)]/90 to-transparent px-3 pb-2.5 pt-8">
          <div className="text-sm font-semibold text-white">{name}</div>
          <div className="text-2xs text-white/70">{role}</div>
        </figcaption>
      </div>
    </figure>
  );
}

export function TeamMarquee() {
  return (
    <div className="relative h-full w-full overflow-hidden" aria-label="Het team van Shortclips">
      {/* Zachte vervaging boven en onder zodat de foto's rustig in- en uitvloeien. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-[var(--color-indigo-ink)] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-[var(--color-indigo-ink)] to-transparent" />
      <div className="sc-marquee-track flex flex-col gap-4">
        {/* Dubbel gestapeld voor een naadloze, doorlopende lus. */}
        {[...TEAM, ...TEAM].map((m, i) => (
          <Card key={`${m.name}-${i}`} {...m} />
        ))}
      </div>
    </div>
  );
}
