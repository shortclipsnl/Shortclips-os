import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ChevronDown, Settings2, X } from "lucide-react";
import { LinkButton, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { requireInternal, isOwner, isEditorRole } from "@/server/auth/context";
import { getVisieVoor } from "@/server/visie";
import { FUNCTIES, functieVoorRol, principeVanDeWeek, type Functie } from "@/lib/visie/data";
import { VisieTekst } from "@/components/visie/markeer";

export const metadata: Metadata = { title: "Onze visie" };
export const dynamic = "force-dynamic";

function Kop({ kick, titel }: { kick: string; titel: string }) {
  return (
    <div className="mb-3">
      <div className="text-2xs font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">{kick}</div>
      <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-[var(--color-ink)]">{titel}</h2>
    </div>
  );
}

/**
 * Onze visie: één centrale plek voor missie, visie, positionering, de vijf
 * kernprincipes, de vertaling per functie en de klantbeloftes. Tabblad binnen
 * de Kennisbank. Opent standaard op de functie van wie is ingelogd.
 */
export default async function VisiePage({ searchParams }: { searchParams: Promise<{ functie?: string }> }) {
  const viewer = await requireInternal();
  const v = await getVisieVoor(viewer);
  if (!v) notFound();

  const owner = isOwner(viewer);
  const eigen = functieVoorRol(viewer.primaryRole, isEditorRole(viewer));
  const param = (await searchParams).functie as Functie | undefined;
  // Editors en freelance videografen zien alleen hun eigen functie; het kantoorteam kan wisselen.
  const magWisselen = !isEditorRole(viewer);
  const functie: Functie = magWisselen && param && FUNCTIES.includes(param) ? param : eigen;
  const f = v.functies[functie];
  const week = principeVanDeWeek(v);
  const open = v.openBesluiten.filter((b) => !b.besloten);

  return (
    <div className="mx-auto max-w-[1100px] space-y-9 pb-10">
      <PageHeader
        title="Onze visie"
        description="Waarom Shortclips bestaat, waar we naartoe werken en hoe we elke dag beslissen."
        actions={owner ? (
          <LinkButton href="/visie/beheer" variant="secondary">
            <Settings2 className="size-4" /> Beheer
          </LinkButton>
        ) : undefined}
      />

      {owner ? (
        <div className={cn(
          "-mt-3 rounded-[var(--radius-lg)] border px-4 py-3 text-sm",
          v.status === "definitief" ? "border-[var(--color-good)]/30 bg-[var(--color-good-soft)]" : "border-[#e6c94f]/50 bg-[#fff4c2] text-[#5c4400]",
        )}>
          {v.status === "definitief" ? (
            <span className="text-[var(--color-ink)]"><strong className="font-semibold">Vastgesteld.</strong> Zichtbaar voor het hele team, ook op Vandaag, Mijn verantwoordelijkheden, Scripting, de editorbriefing en Teammeetings.</span>
          ) : (
            <span>
              <strong className="font-semibold">Voorstel, alleen zichtbaar voor jou.</strong> Het team ziet deze pagina en de onderdelen die eruit lezen pas nadat je de visie vaststelt in{" "}
              <Link href="/visie/beheer" className="font-semibold underline">Beheer</Link>.
              {open.length > 0 ? ` Er staan nog ${open.length} besluiten open. Geel gemarkeerde tekst is nog te bevestigen.` : ""}
            </span>
          )}
        </div>
      ) : null}

      {/* 1. Positionering, missie en visie */}
      <section className="overflow-hidden rounded-[var(--radius-lg)] bg-[#00003b] text-white">
        <div className="px-6 py-8 sm:px-9 sm:py-10">
          <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-white/55">Onze positionering</div>
          <h2 className="mt-2 max-w-3xl text-2xl font-bold leading-tight tracking-tight sm:text-[28px]"><VisieTekst t={v.positionering} markeer={false} /></h2>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-white/80"><VisieTekst t={v.centraleGedachte} markeer={false} /></p>
        </div>
        <div className="grid gap-px bg-white/10 sm:grid-cols-2">
          <div className="bg-[#00003b] px-6 py-6 sm:px-9">
            <h3 className="text-sm font-semibold">Onze missie</h3>
            <p className="mt-0.5 text-2xs font-medium uppercase tracking-wide text-white/50">Wat we elke dag doen</p>
            <p className="mt-2 text-sm leading-relaxed text-white/80"><VisieTekst t={v.missie} markeer={false} /></p>
          </div>
          <div className="bg-[#00003b] px-6 py-6 sm:px-9">
            <h3 className="text-sm font-semibold">Onze visie</h3>
            <p className="mt-0.5 text-2xs font-medium uppercase tracking-wide text-white/50">Waar we naartoe werken</p>
            <p className="mt-2 text-sm leading-relaxed text-white/80"><VisieTekst t={v.visie} markeer={false} /></p>
          </div>
        </div>
      </section>

      {/* 2. Waarom Shortclips bestaat */}
      <section>
        <Kop kick="Waarom Shortclips bestaat" titel={v.waarom.titel} />
        <div className="grid gap-3 sm:grid-cols-3">
          {v.waarom.kaarten.map((k, i) => (
            <div key={k.titel} className="sc-card p-4">
              <div className="text-xs font-bold text-[var(--color-ink-faint)]">0{i + 1}</div>
              <h3 className="mt-1 text-sm font-semibold text-[var(--color-ink)]">{k.titel}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{k.tekst}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 rounded-[var(--radius-md)] bg-[var(--color-neutral-soft)] px-4 py-3 text-sm leading-relaxed text-[var(--color-ink)]">{v.waarom.conclusie}</p>
      </section>

      {/* 3. De vijf kernprincipes */}
      <section>
        <Kop kick="Onze kernprincipes" titel="Zo nemen we elke dag beslissingen" />
        <div className="sc-card divide-y divide-[var(--color-line)] overflow-hidden">
          {v.principes.map((p) => (
            <details key={p.nr} id={`principe-${p.nr}`} className="group scroll-mt-24" open={week?.nr === p.nr}>
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition hover:bg-[var(--color-neutral-soft)] [&::-webkit-details-marker]:hidden">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--color-indigo-ink)] text-sm font-bold text-white">{p.nr}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[var(--color-ink)]">
                    {p.titel}
                    {week?.nr === p.nr ? <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-2xs font-bold text-[#1d6b4c]">Principe van deze week</span> : null}
                  </div>
                  <div className="text-[13px] leading-snug text-[var(--color-ink-muted)]"><VisieTekst t={p.uitleg} markeer={owner} /></div>
                </div>
                <ChevronDown className="size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180" />
              </summary>
              <div className="grid gap-3 px-4 pb-4 pl-[60px] text-[13px] leading-relaxed sm:grid-cols-3">
                <div>
                  <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">In de praktijk</div>
                  <p className="mt-0.5 text-[var(--color-ink)]"><VisieTekst t={p.praktijk} markeer={owner} /></p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-[#1d6b4c]"><Check className="size-3" /> Past bij ons</div>
                  <p className="mt-0.5 text-[var(--color-ink)]"><VisieTekst t={p.wel} markeer={owner} /></p>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-[#a3271c]"><X className="size-3" /> Past niet</div>
                  <p className="mt-0.5 text-[var(--color-ink-muted)]"><VisieTekst t={p.niet} markeer={owner} /></p>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* 4. Wat betekent dit voor jouw functie? */}
      <section id="functie" className="scroll-mt-24">
        <Kop kick="Wat betekent dit voor jouw functie?" titel={`${f.label}: ${f.titel.charAt(0).toLowerCase()}${f.titel.slice(1)}`} />
        {magWisselen ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {FUNCTIES.map((k) => (
              <Link
                key={k}
                href={`/visie?functie=${k}#functie`}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm font-medium transition",
                  k === functie
                    ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white"
                    : "border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
                )}
              >
                {v.functies[k].label}{k === eigen ? " (jij)" : ""}
              </Link>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-[var(--radius-lg)] bg-[#00003b] p-4 text-white">
            <div className="text-2xs font-semibold uppercase tracking-wide text-white/55">Waarom jouw functie bestaat</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/90"><VisieTekst t={f.betekenis} markeer={false} /></p>
          </div>
          {([
            ["Verantwoordelijkheid", f.verantwoordelijkheid],
            ["Kwaliteitsstandaard", f.standaard],
            ["Bijdrage aan klantresultaat", f.bijdrage],
            ["Proactief waarde toevoegen", f.proactief],
          ] as const).map(([label, tekst]) => (
            <div key={label} className="sc-card p-4">
              <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink)]"><VisieTekst t={tekst} markeer={owner} /></p>
            </div>
          ))}
          <div className="sc-card p-4">
            <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Gedrag</div>
            <p className="mt-1.5 flex gap-2 text-[13px] leading-relaxed text-[var(--color-ink)]"><Check className="mt-0.5 size-3.5 shrink-0 text-[#1d6b4c]" /> <span><VisieTekst t={f.wel} markeer={owner} /></span></p>
            <p className="mt-1.5 flex gap-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]"><X className="mt-0.5 size-3.5 shrink-0 text-[#a3271c]" /> <span><VisieTekst t={f.niet} markeer={owner} /></span></p>
          </div>
        </div>
        {functie !== "directie" && functie !== "editor" && !isEditorRole(viewer) ? (
          <p className="mt-2.5 text-xs text-[var(--color-ink-faint)]">
            Wat dit per onderdeel van je werk betekent, staat op{" "}
            <Link href="/verantwoordelijkheden" className="font-medium text-[var(--color-ink-muted)] hover:underline">Mijn verantwoordelijkheden</Link>.
          </p>
        ) : null}
      </section>

      {/* 5. Zo werken wij */}
      <section>
        <Kop kick="Zo werken wij bij Shortclips" titel="Een afdeling die verantwoordelijkheid neemt, geen leverancier die opdrachten uitvoert" />
        <div className="sc-card overflow-hidden">
          <div className="hidden grid-cols-[1fr_1.4fr_1fr] gap-4 border-b border-[var(--color-line)] px-4 py-2 text-2xs font-semibold uppercase tracking-wide sm:grid">
            <span className="text-[var(--color-ink-faint)]">Situatie</span><span className="text-[#1d6b4c]">Past bij ons</span><span className="text-[#a3271c]">Past niet</span>
          </div>
          <div className="divide-y divide-[var(--color-line)]">
            {v.situaties.map((s) => (
              <div key={s.situatie} className="grid gap-1 px-4 py-3 text-[13px] leading-snug sm:grid-cols-[1fr_1.4fr_1fr] sm:gap-4">
                <div className="font-semibold text-[var(--color-ink)]">{s.situatie}</div>
                <div className="text-[var(--color-ink)]"><VisieTekst t={s.wel} markeer={owner} /></div>
                <div className="text-[var(--color-ink-muted)]"><VisieTekst t={s.niet} markeer={owner} /></div>
              </div>
            ))}
          </div>
        </div>
        <details className="group sc-card mt-3 overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-neutral-soft)] [&::-webkit-details-marker]:hidden">
            Leverancier of afdeling: hetzelfde werk, een ander vertrekpunt
            <ChevronDown className="ml-auto size-4 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180" />
          </summary>
          <div className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
            <div className="grid grid-cols-[1fr_1.2fr_1.2fr] gap-3 px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
              <span /> <span>Productiebedrijf</span> <span className="text-[var(--color-ink)]">Shortclips als afdeling</span>
            </div>
            {v.vergelijking.map((r) => (
              <div key={r.onderwerp} className="grid grid-cols-[1fr_1.2fr_1.2fr] gap-3 px-4 py-2.5 text-[13px] leading-snug">
                <span className="font-semibold text-[var(--color-ink)]">{r.onderwerp}</span>
                <span className="text-[var(--color-ink-muted)]"><VisieTekst t={r.leverancier} markeer={owner} /></span>
                <span className="font-medium text-[var(--color-ink)]"><VisieTekst t={r.afdeling} markeer={owner} /></span>
              </div>
            ))}
          </div>
        </details>
      </section>

      {/* 6. Wat beloven wij onze klanten? */}
      <section>
        <Kop kick="Wat beloven wij onze klanten?" titel="Onze verantwoordelijkheid, en wat de klant zelf doet" />
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <ol className="sc-card divide-y divide-[var(--color-line)] overflow-hidden">
            {v.beloftes.map((b, i) => (
              <li key={b} className="flex items-start gap-3 px-4 py-3 text-sm leading-snug text-[var(--color-ink)]">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-indigo-ink)] text-xs font-bold text-white">{i + 1}</span>
                <span><VisieTekst t={b} markeer={owner} /></span>
              </li>
            ))}
          </ol>
          <div className="sc-card p-4">
            <div className="text-sm font-semibold text-[var(--color-ink)]">De klant doet zelf alleen dit</div>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-snug text-[var(--color-ink)]">
              {v.klantDoet.map((k) => (
                <li key={k} className="flex items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-[var(--color-ink-faint)]" /> <span><VisieTekst t={k} markeer={owner} /></span></li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">Dat de klant zo weinig hoeft, is ons product. Vraag je de klant iets extra&apos;s, kom dan altijd met een voorstel.</p>
          </div>
        </div>
      </section>

      {/* 7. Wat wij van elkaar verwachten + inwerken */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="sc-card p-4">
          <div className="text-sm font-semibold text-[var(--color-ink)]">Wat wij van elke medewerker verwachten</div>
          <ul className="mt-2 space-y-1.5 text-[13px] leading-snug text-[var(--color-ink)]">
            {v.verwachtingen.map((k) => (
              <li key={k} className="flex items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-[#1d6b4c]" /> <span><VisieTekst t={k} markeer={owner} /></span></li>
            ))}
          </ul>
        </div>
        <div id="inwerken" className="sc-card scroll-mt-24 p-4">
          <div className="text-sm font-semibold text-[var(--color-ink)]">Nieuw bij Shortclips? Dit bespreken we na 30, 60 en 90 dagen</div>
          <div className="mt-2 space-y-2 text-[13px] leading-snug">
            {v.inwerken.map((m) => (
              <div key={m.moment} className="grid grid-cols-[92px_1fr] gap-2">
                <span className="font-semibold text-[var(--color-ink)]">{m.moment}</span>
                <span className="text-[var(--color-ink-muted)]">{m.vragen.join(" ")}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">Beantwoord de vragen vanuit je eigen functie ({v.functies[eigen].label}), met voorbeelden uit je eigen werk.</p>
        </div>
      </section>

      {/* 8. Meetpunten: alleen voor de eigenaar tot de normen zijn vastgelegd. */}
      {owner ? (
        <section>
          <Kop kick="Hoe we meten of we zo werken" titel="Vijf meetpunten: drie die wij sturen, twee die de klant merkt" />
          <div className="sc-card divide-y divide-[var(--color-line)] overflow-hidden">
            {v.meetpunten.map((m) => (
              <div key={m.key} className="grid gap-1 px-4 py-3 text-[13px] leading-snug sm:grid-cols-[150px_1fr_1fr_90px] sm:items-center sm:gap-4">
                <div>
                  <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{m.soort === "wij_sturen" ? "Wij sturen" : "Klant merkt"}</div>
                  <div className="font-semibold text-[var(--color-ink)]">{m.titel}</div>
                </div>
                <div className="text-[var(--color-ink)]">{m.meting}</div>
                <div className="text-[var(--color-ink-muted)]"><VisieTekst t={m.bron} markeer /></div>
                <div className="font-semibold text-[var(--color-ink)]"><VisieTekst t={m.norm} markeer /></div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            De normen zijn voorstellen. Aantoonbare waarde laat een samenhang zien, geen oorzaak: algoritme, seizoen en het aanbod van de klant spelen mee. Daarom vergelijken we met het eigen startpunt en rekenen we medewerkers er niet op af.
          </p>
        </section>
      ) : null}

      {owner && open.length > 0 ? (
        <section>
          <Kop kick="Alleen voor jou" titel={`${open.length} besluiten die nog openstaan`} />
          <ol className="sc-card divide-y divide-[var(--color-line)] overflow-hidden">
            {open.map((b, i) => (
              <li key={b.id} className="flex items-start gap-3 px-4 py-3 text-[13px] leading-snug">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#fff4c2] text-xs font-bold text-[#7a5a00]">{i + 1}</span>
                <span>
                  <span className="font-semibold text-[var(--color-ink)]">{b.vraag}</span>
                  {b.voorstel ? <span className="block text-[var(--color-ink-muted)]">Voorstel: {b.voorstel}</span> : null}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-[var(--color-ink-faint)]">Afvinken doe je in <Link href="/visie/beheer" className="font-medium hover:underline">Beheer</Link>.</p>
        </section>
      ) : null}

      <p className="text-xs text-[var(--color-ink-faint)]">
        Bron: Onze visie, beheerd door Jarno.{v.bijgewerktOp ? ` Laatst bijgewerkt ${new Date(v.bijgewerktOp).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}.` : ""}
      </p>
    </div>
  );
}
