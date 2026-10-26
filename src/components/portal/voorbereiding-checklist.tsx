"use client";

import { useEffect, useState } from "react";
import { Check, Shirt, Users, Volume2 } from "lucide-react";

/**
 * Interactieve voorbereidingschecklist voor de opnamedag (document "Checklist
 * voor jullie team"). De klant kan afvinken wat geregeld is; de voortgang wordt
 * per opname in de browser onthouden (handige persoonlijke hulp, geen harde
 * registratie). De inhoud is overal gelijk.
 */

const GROUPS: Array<{ title: string; icon: React.ReactNode; items: string[] }> = [
  {
    title: "Kleding en uiterlijk",
    icon: <Shirt className="size-4" />,
    items: [
      "Rustige kleuren die prettig ogen op camera, geen fel wit of harde roodtinten",
      "Geen grote teksten of opvallende logo's",
      "Sieraden die geluid maken thuislaten",
      "Zakken leeg, zodat er niets uitsteekt",
      "Een shirt of blouse met stevige rand werkt het beste voor de microfoon",
      "Extra set kleding alleen bij meerdere video's met dezelfde persoon",
    ],
  },
  {
    title: "Mensen en planning",
    icon: <Users className="size-4" />,
    items: [
      "Bevestig vooraf wie er in beeld komt",
      "Deze personen zijn op tijd aanwezig en hoeven er niet tussendoor uit",
      "Klanten of bezoekers die in beeld komen weten dat er gefilmd wordt",
      "Eén aanspreekpunt is bereikbaar voor vragen en beslissingen",
      "Het team is geïnformeerd, zodat niemand onverwacht binnenloopt",
      "Locaties op het terrein zijn toegankelijk en opgeruimd",
    ],
  },
  {
    title: "Ruimte en geluid",
    icon: <Volume2 className="size-4" />,
    items: [
      "Telefoons op stil in de opnameruimte",
      "Apparaten die geluid maken tijdelijk uit",
      "Deuren en ramen dicht bij omgevingsgeluid",
      "Niet door de ruimte lopen tijdens het filmen",
      "Water binnen handbereik voor de presentator",
      "Een rustige plek beschikbaar met voldoende daglicht",
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);

export function VoorbereidingChecklist({ storageKey }: { storageKey: string }) {
  const key = `sc-prep:${storageKey}`;
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setDone(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* opslag niet beschikbaar — negeren */
    }
    setReady(true);
  }, [key]);

  function toggle(item: string) {
    setDone((prev) => {
      const next = { ...prev, [item]: !prev[item] };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* negeren */
      }
      return next;
    });
  }

  const doneCount = ALL_ITEMS.filter((i) => done[i]).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[13.5px] text-[var(--color-ink-muted)]">Dit is alles wat we vragen. Verder hoeven jullie niets voor te bereiden.</p>
        {ready ? <span className="shrink-0 rounded-full bg-[var(--sc-fill-strong)] px-2.5 py-1 text-[12px] font-semibold tabular-nums">{doneCount}/{ALL_ITEMS.length}</span> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {GROUPS.map((g) => (
          <div key={g.title} className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
            <div className="flex items-center gap-2 text-[14px] font-semibold"><span className="text-[var(--sc-accent)]">{g.icon}</span> {g.title}</div>
            <ul className="mt-3 flex flex-col gap-2">
              {g.items.map((item) => {
                const checked = !!done[item];
                return (
                  <li key={item}>
                    <button type="button" onClick={() => toggle(item)} className="flex w-full items-start gap-2.5 text-left">
                      <span className={`mt-px grid size-5 shrink-0 place-items-center rounded-md border transition-colors ${checked ? "border-[#2fd27a] bg-[#2fd27a] text-white" : "border-[var(--sc-line)] bg-transparent"}`}>
                        {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
                      </span>
                      <span className={`text-[13px] ${checked ? "text-[var(--color-ink-faint)] line-through" : "text-[var(--color-ink-muted)]"}`}>{item}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-[14px] border border-[#2e90fa]/25 bg-[rgba(46,144,250,0.06)] p-4">
        <div className="text-[14px] font-semibold">Zenuwachtig voor de camera?</div>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Dat hoort erbij en is geen probleem. Wij nemen in korte stukken op, herhalen zo vaak als nodig en halen er in de montage uit wat het beste werkt. Niemand hoeft iets uit het hoofd te leren.
        </p>
      </div>
    </div>
  );
}
