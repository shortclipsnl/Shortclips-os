import { Check, Shirt, Users, Volume2 } from "lucide-react";

/**
 * Overzicht van de voorbereiding op de opnamedag (document "Checklist voor jullie
 * team"). Puur ter informatie — de klant hoeft niets af te vinken; de lichtblauwe
 * vinkjes maken in één oogopslag duidelijk wat er geregeld moet zijn.
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

export function VoorbereidingOverzicht() {
  return (
    <div>
      <p className="mb-3 text-[13.5px] text-[var(--color-ink-muted)]">Dit is alles wat we vragen. Verder hoeven jullie niets voor te bereiden.</p>

      <div className="grid gap-4 lg:grid-cols-3">
        {GROUPS.map((g) => (
          <div key={g.title} className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
            <div className="flex items-center gap-2 text-[14px] font-semibold"><span className="text-[var(--sc-accent)]">{g.icon}</span> {g.title}</div>
            <ul className="mt-3 flex flex-col gap-2">
              {g.items.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[13px] text-[var(--color-ink-muted)]">
                  <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-[rgba(46,144,250,0.14)] text-[var(--sc-accent)]">
                    <Check className="size-3.5" strokeWidth={2.5} />
                  </span>
                  {item}
                </li>
              ))}
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
