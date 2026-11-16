import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import {
  ArrowUpRight, BookOpen, CalendarDays, ChevronDown, CircleCheck, ClipboardCheck, Gauge, LifeBuoy,
  ListChecks, MessageCircle, Palmtree, Radar, Siren, Target, Users,
} from "lucide-react";
import { ClientLogo } from "@/components/ui";
import { cn } from "@/lib/cn";
import { KENNISBANK_TEAM, kaal, naamVan, type Config } from "@/lib/verantwoordelijkheden/data";
import { VIER_NIVEAUS, moetVastleggen, zonderVastleggen, type NiveauKey, type Rol } from "@/lib/verantwoordelijkheden/rol";
import type { Kleur, KpiStand, LiveStand } from "@/server/verantwoordelijkheden-live";
import { verderSleutel, type Functie, type Meetpunt, type Visie } from "@/lib/visie/data";
import { PrincipeChip, VisieTekst } from "@/components/visie/markeer";

/** Welke meetpunten uit Onze visie bij welke functie horen: alleen wat je zelf kunt beïnvloeden. */
const MEETPUNTEN_PER_FUNCTIE: Record<Functie, Meetpunt["key"][]> = {
  content_creative: ["voorgedaan", "leerlus", "eenkeergoed", "ontzorgd", "waarde"],
  videograaf: ["eenkeergoed"],
  editor: ["eenkeergoed"],
  directie: ["voorgedaan", "leerlus", "eenkeergoed", "ontzorgd", "waarde"],
};

/** Tekst tussen [[...]] is een voorstel: gemarkeerd voor Jarno, gewone tekst voor het team. */
function T({ t, markeer }: { t: string; markeer: boolean }) {
  if (!markeer) return <>{kaal(t)}</>;
  return (
    <>
      {t.split(/(\[\[[^\]]+\]\])/g).map((d, i) => {
        const m = d.match(/^\[\[(.+)\]\]$/);
        return m ? (
          <mark key={i} title="Voorstel, nog door Jarno te bevestigen" className="rounded bg-[#fff4c2] px-1 text-[#7a5a00]">{m[1]}</mark>
        ) : <Fragment key={i}>{d}</Fragment>;
      })}
    </>
  );
}

const KLEUR: Record<Kleur, { balk: string; tekst: string; zacht: string; label: string }> = {
  groen: { balk: "bg-[var(--color-good)]", tekst: "text-[#1d6b4c]", zacht: "bg-[var(--color-good-soft)]", label: "Volgens afspraak" },
  oranje: { balk: "bg-[var(--color-warn)]", tekst: "text-[#8a5300]", zacht: "bg-[var(--color-warn-soft)]", label: "Aandacht nodig" },
  rood: { balk: "bg-[var(--color-bad)]", tekst: "text-[#a3271c]", zacht: "bg-[var(--color-bad-soft)]", label: "Actie vereist" },
};
const NIVEAU_ICON: Record<NiveauKey, typeof CircleCheck> = { zelf: CircleCheck, vastleggen: ClipboardCheck, overleg: MessageCircle, jarno: Siren };
/** Zoveel punten per niveau direct zichtbaar; de rest klapt open. */
const ZICHTBAAR = 3;

const datumKort = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function Voorstel() {
  return <span className="ml-2 rounded bg-[#fff4c2] px-1.5 py-0.5 text-2xs font-semibold text-[#7a5a00]">Voorstel</span>;
}

function Blok({ icon: Icon, titel, sub, children, actie }: { icon: typeof Target; titel: string; sub?: string; children: ReactNode; actie?: ReactNode }) {
  return (
    <section className="sc-card flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-4 py-3">
        <Icon className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{titel}</h2>
        {sub ? <span className="text-xs text-[var(--color-ink-faint)]">{sub}</span> : null}
        {actie ? <span className="ml-auto">{actie}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Uitklap({ icon: Icon, titel, sub, children }: { icon: typeof Target; titel: string; sub?: string; children: ReactNode }) {
  return (
    <details className="group sc-card overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-neutral-soft)] [&::-webkit-details-marker]:hidden">
        <Icon className="size-4 shrink-0 text-[var(--color-ink-faint)]" /> {titel}
        {sub ? <span className="hidden text-xs font-normal text-[var(--color-ink-faint)] sm:inline">{sub}</span> : null}
        <ChevronDown className="ml-auto size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[var(--color-line)] px-4 py-4 text-[13px]">{children}</div>
    </details>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-2">
      <dt className="text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="text-[var(--color-ink)]">{children}</dd>
    </div>
  );
}

function KpiTegel({ titel, norm, stand }: { titel: string; norm: string; stand: KpiStand | undefined }) {
  const k = stand?.kleur ? KLEUR[stand.kleur] : null;
  const inhoud = (
    <>
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", k ? k.balk : "bg-[var(--color-line-strong)]")} />
      <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{titel}</div>
      <div className={cn("mt-1.5 text-2xl font-bold leading-none", k ? k.tekst : "text-[var(--color-ink-faint)]")}>{stand?.waarde ?? "–"}</div>
      <div className="mt-1.5 text-xs leading-snug text-[var(--color-ink)]">{stand?.toelichting ?? "Nog geen meting"}</div>
      <div className="mt-auto pt-2 text-2xs leading-snug text-[var(--color-ink-faint)]">Afspraak: {norm}</div>
      {k ? <span className={cn("mt-2 w-fit rounded-full px-2 py-0.5 text-2xs font-bold", k.zacht, k.tekst)}>{k.label}</span> : null}
    </>
  );
  const klasse = "sc-card relative flex min-h-[148px] flex-col overflow-hidden px-3.5 pb-3 pt-4";
  return stand?.href ? (
    <Link href={stand.href} className={cn(klasse, "transition hover:border-[var(--color-line-strong)]")}>{inhoud}</Link>
  ) : (
    <div className={klasse}>{inhoud}</div>
  );
}

function NiveauBlok({ nv, lijst, markeer }: { nv: (typeof VIER_NIVEAUS)[number]; lijst: string[]; markeer: boolean }) {
  const k = KLEUR[nv.kleur];
  const Icon = NIVEAU_ICON[nv.key];
  const punt = (x: string) => (
    <li key={x} className="flex items-start gap-2 text-[13px] leading-snug text-[var(--color-ink)]">
      <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", k.balk)} />
      <span><T t={x} markeer={markeer} /></span>
    </li>
  );
  return (
    <div className="sc-card relative overflow-hidden p-4 pt-5">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", k.balk)} />
      <div className={cn("flex items-center gap-2 text-sm font-bold", k.tekst)}>
        <Icon className="size-4 shrink-0" /> {nv.titel}
        <span className="ml-auto text-xs font-medium text-[var(--color-ink-faint)]">{lijst.length}</span>
      </div>
      <p className="mb-3 mt-1 text-xs leading-snug text-[var(--color-ink-muted)]">{nv.uitleg}</p>
      {lijst.length === 0 ? (
        <p className="text-[13px] text-[var(--color-ink-muted)]">Niets vastgelegd.</p>
      ) : (
        <>
          <ul className="space-y-2">{lijst.slice(0, ZICHTBAAR).map(punt)}</ul>
          {lijst.length > ZICHTBAAR ? (
            <details className="group mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Nog {lijst.length - ZICHTBAAR} tonen</span>
                <span className="hidden group-open:inline">Minder tonen</span>
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <ul className="mt-2 space-y-2">{lijst.slice(ZICHTBAAR).map(punt)}</ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

export function Weergave({ config, email, naam, functie, rol, live, markeer, visie = null }: {
  config: Config; email: string; naam: string; functie: string; rol: Rol; live: LiveStand; markeer: boolean;
  /** Onze visie (centrale bron). Null = nog niet zichtbaar voor deze kijker: de pagina blijft dan zoals hij was. */
  visie?: Visie | null;
}) {
  const visieFunctie: Functie = rol.key === "cc" ? "content_creative" : rol.key === "directie" ? "directie" : "videograaf";
  const fv = visie?.functies[visieFunctie] ?? null;
  const meetpunten = visie ? visie.meetpunten.filter((m) => MEETPUNTEN_PER_FUNCTIE[visieFunctie].includes(m.key)) : [];
  const items = config.verantwoordelijkheden.filter((r) => r.persoon === email && r.actief);
  const beslissingen = config.beslissingen.filter((b) => b.persoon === email && b.actief);
  const afw = config.afwezigheid[email];
  const zelf = [...new Map(items.flatMap((r) => r.bevoegdheden).map((x) => [kaal(x).toLowerCase(), x])).values()];
  const kennisbankKpis = config.profielen?.[email]?.kpis ?? [];
  const lijsten: Record<NiveauKey, string[]> = {
    zelf: zelf.filter((x) => !moetVastleggen(x)),
    vastleggen: zelf.filter(moetVastleggen).map(zonderVastleggen),
    overleg: beslissingen.filter((b) => b.niveau === "overleg").map((b) => b.situatie),
    jarno: beslissingen.filter((b) => b.niveau === "escaleren").map((b) => b.situatie),
  };
  const directie = rol.key === "directie";
  if (directie) {
    // Voor de directeur: wat het team volgens de verdeling bij hem neerlegt (niveau 4).
    lijsten.jarno = [...new Map(
      config.beslissingen.filter((b) => b.persoon !== email && b.actief && b.niveau === "escaleren").map((b) => [kaal(b.situatie).toLowerCase(), b.situatie]),
    ).values()];
  }
  const niveaus = VIER_NIVEAUS.map((nv) => ({ ...nv, ...(rol.niveaus?.[nv.key] ?? {}) }));
  const cc = rol.key === "cc" || directie;
  const aantal = cc ? live.klanten.length : live.opnames.length;

  return (
    <div className="space-y-5">
      {/* 1. Missieblok: wie ben ik, waarvoor sta ik, wat is het resultaat. */}
      <section className="overflow-hidden rounded-2xl bg-[var(--color-indigo-ink)] px-5 py-6 text-white sm:px-7 sm:py-7">
        <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-white/60">{functie}</div>
        <h1 className="mt-2 max-w-3xl text-xl font-bold leading-snug sm:text-2xl">
          Ik, {naam}, ben verantwoordelijk voor {rol.verantwoordelijkVoor}.
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/80">{rol.missie}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-white/10 px-4 py-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-white/60">Belangrijkste resultaat</div>
            <div className="mt-1 text-sm font-semibold leading-snug">{rol.resultaat}</div>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-white/60">
              {directie ? "Actieve klanten" : cc ? "Mijn klanten" : "Mijn opnamedagen, komende 3 weken"}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{aantal}</span>
              {cc
                ? live.klanten.slice(0, 12).map((k) => <ClientLogo key={k.slug} name={k.name} logoUrl={k.logoUrl} color={k.color} size={24} />)
                : live.opnames.slice(0, 12).map((o) => <ClientLogo key={o.id} name={o.klant} logoUrl={o.logoUrl} color={o.color} size={24} />)}
            </div>
          </div>
        </div>
      </section>

      {/* 2. KPI-strook: maximaal vijf, alleen echte gegevens. */}
      <section>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
          {rol.kpis.map((k) => <KpiTegel key={k.id} titel={k.titel} norm={k.norm} stand={live.kpis[k.id]} />)}
        </div>
        <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">
          Cijfers komen rechtstreeks uit het portaal. De kleuren volgen voorlopige grenswaarden. Een streepje betekent: nog geen meting.
        </p>
        {markeer ? (
          <details className="group mt-2 rounded-lg border border-dashed border-[#e2c95a] bg-[#fffbe6] px-3.5 py-2.5 text-xs text-[#5c4500]">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold [&::-webkit-details-marker]:hidden">
              <Gauge className="size-3.5" /> Voorstel grenswaarden en ontbrekende metingen (alleen zichtbaar voor jou)
              <ChevronDown className="ml-auto size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="mt-2 space-y-2">
              {rol.kpis.map((k) => (
                <li key={k.id}>
                  <span className="font-semibold">{k.titel}.</span> {k.grenzen}
                  {k.registratie ? <span className="block text-[#7a5a00]">Ontbreekt: {k.registratie}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* 3. Links mijn klanten of opnamedagen, rechts wat ik zelf moet signaleren. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {directie ? (
          <Blok
            icon={Target}
            titel={rol.lijstTitel}
            sub={live.doelen ? `week ${live.doelen.week} van ${live.doelen.weken}` : undefined}
            actie={<Link href="/doelen" className="text-xs font-semibold text-[var(--color-ink-muted)] hover:underline">Alle doelen</Link>}
          >
            {!live.doelen ? (
              <p className="px-4 py-4 text-[13px] text-[var(--color-ink-muted)]">De doelen konden nu niet geladen worden. Kijk op Doelen.</p>
            ) : live.doelen.pijlers.every((p) => p.totaal === 0) ? (
              <p className="px-4 py-4 text-[13px] text-[var(--color-ink-muted)]">Er zijn nog geen doelen voor dit kwartaal vastgelegd.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {live.doelen.pijlers.map((p) => {
                  const kleur: Kleur | null = p.achter > 0 ? "rood" : p.risico > 0 ? "oranje" : p.totaal > 0 ? "groen" : null;
                  return (
                    <li key={p.key}>
                      <Link href="/doelen" className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-[var(--color-neutral-soft)]">
                        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", kleur ? KLEUR[kleur].balk : "bg-[var(--color-line-strong)]")} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{p.label}</div>
                          <div className="text-xs text-[var(--color-ink-muted)]">
                            {p.totaal === 0 ? "Geen doelen" : `${p.totaal} ${p.totaal === 1 ? "doel" : "doelen"}${p.gehaald ? ` · ${p.gehaald} gehaald` : ""}`}
                          </div>
                        </div>
                        <span className="flex shrink-0 gap-1">
                          {p.opKoers ? <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-2xs font-bold text-[#1d6b4c]">{p.opKoers} op koers</span> : null}
                          {p.risico ? <span className="rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-2xs font-bold text-[#8a5300]">{p.risico} risico</span> : null}
                          {p.achter ? <span className="rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-2xs font-bold text-[#a3271c]">{p.achter} achter</span> : null}
                        </span>
                        <ArrowUpRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Blok>
        ) : (
        <Blok icon={cc ? Users : CalendarDays} titel={rol.lijstTitel} sub={cc ? `${aantal} actief` : "komende 3 weken"}>
          {cc ? (
            live.klanten.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-[var(--color-ink-muted)]">Er zijn nog geen actieve klanten aan jou toegewezen.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {live.klanten.map((k) => (
                  <li key={k.slug}>
                    <Link href={`/clients/${k.slug}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-[var(--color-neutral-soft)]">
                      <ClientLogo name={k.name} logoUrl={k.logoUrl} color={k.color} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{k.name}</div>
                        <div className={cn("text-xs", k.volgendeOpname ? "text-[var(--color-ink-muted)]" : "font-medium text-[#8a5300]")}>
                          {k.volgendeOpname ? `Volgende opname ${datumKort(k.volgendeOpname)}` : "Geen opname gepland"}
                        </div>
                      </div>
                      {k.signalen > 0 ? (
                        <span className="shrink-0 rounded-full bg-[var(--color-warn-soft)] px-2 py-0.5 text-2xs font-bold text-[#8a5300]">
                          {k.signalen} {k.signalen === 1 ? "signaal" : "signalen"}
                        </span>
                      ) : null}
                      <ArrowUpRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : live.opnames.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-[var(--color-ink-muted)]">Er staan de komende drie weken geen opnamedagen op jouw naam.</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {live.opnames.map((o) => (
                <li key={o.id}>
                  <Link href={`/productions/${o.id}`} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-[var(--color-neutral-soft)]">
                    <ClientLogo name={o.klant} logoUrl={o.logoUrl} color={o.color} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[var(--color-ink)]">{o.klant}</div>
                      <div className="text-xs text-[var(--color-ink-muted)]">{datumKort(o.datum)}{o.tijd ? ` · ${o.tijd}` : ""}</div>
                    </div>
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold",
                      o.scriptKlaar ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-warn-soft)] text-[#8a5300]",
                    )}>
                      {o.scriptKlaar ? "Script definitief" : "Script nog niet definitief"}
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Blok>
        )}

        <Blok
          icon={Radar}
          titel="Zelf signaleren deze week"
          sub={live.signalenBeschikbaar ? `${live.signalenTotaal} open` : undefined}
          actie={<Link href="/kwaliteit" className="text-xs font-semibold text-[var(--color-ink-muted)] hover:underline">Alle aandachtspunten</Link>}
        >
          {!live.signalenBeschikbaar ? (
            <p className="px-4 py-4 text-[13px] text-[var(--color-ink-muted)]">De signalen konden nu niet geladen worden. Kijk op Aandachtspunten.</p>
          ) : live.signalen.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-[var(--color-ink)]">
              <CircleCheck className="size-4 shrink-0 text-[var(--color-good)]" /> Het portaal ziet nu niets wat jouw actie vraagt.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {live.signalen.map((s) => {
                const rij = (
                  <>
                    {s.klant ? <ClientLogo name={s.klant} logoUrl={s.logoUrl} color={s.color} size={30} /> : (
                      <span className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-[var(--color-neutral-soft)] text-[var(--color-ink-faint)]">{directie ? <Radar className="size-4" /> : <Target className="size-4" />}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold leading-snug text-[var(--color-ink)]">
                        {s.klant ? <>{s.klant}: </> : null}{s.actie}
                      </div>
                      <div className="text-xs leading-snug text-[var(--color-ink-muted)]">{s.wat} · Eigenaar: {s.eigenaar ?? naam}</div>
                    </div>
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold",
                      s.urgent ? "bg-[var(--color-bad-soft)] text-[#a3271c]" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink)]",
                    )}>{s.wanneer}</span>
                  </>
                );
                return (
                  <li key={s.key}>
                    {s.href ? (
                      <Link href={s.href} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-[var(--color-neutral-soft)]">{rij}</Link>
                    ) : <div className="flex items-center gap-3 px-4 py-2.5">{rij}</div>}
                  </li>
                );
              })}
            </ul>
          )}
          {live.signalenTotaal > live.signalen.length ? (
            <Link href="/kwaliteit" className="border-t border-[var(--color-line)] px-4 py-2.5 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-neutral-soft)]">
              Nog {live.signalenTotaal - live.signalen.length} op Aandachtspunten
            </Link>
          ) : null}
          <details className="group border-t border-[var(--color-line)]">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-[var(--color-ink-muted)] hover:bg-[var(--color-neutral-soft)] [&::-webkit-details-marker]:hidden">
              Hier let ik zelf op, ook zonder melding
              <ChevronDown className="ml-auto size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="space-y-1.5 px-4 pb-3.5 text-[13px] text-[var(--color-ink)]">
              {rol.signaleren.map((x) => (
                <li key={x} className="flex items-start gap-2"><span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--color-warn)]" />{x}</li>
              ))}
            </ul>
          </details>
        </Blok>
      </div>

      {/* 4. De vier niveaus van verantwoordelijkheid. */}
      <section>
        <div className="mb-2.5 flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-[var(--color-ink)]">Wat beslis ik zelf?</h2>
          <span className="text-xs text-[var(--color-ink-faint)]">{rol.beslisUitleg ?? "Staat iets niet bij Naar Jarno, dan los je het zelf of samen op."}</span>
        </div>
        <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {niveaus.map((nv) => <NiveauBlok key={nv.key} nv={nv} lijst={lijsten[nv.key]} markeer={markeer} />)}
        </div>
        <p className="mt-2.5 text-xs text-[var(--color-ink-faint)]">
          Twijfel je over het niveau van een situatie? Zoek hem op in de{" "}
          <Link href="/beslissingshulp" className="font-medium text-[var(--color-ink-muted)] hover:underline">Beslissingshulp</Link>.
        </p>
      </section>

      {/* 5. Verdieping: ingeklapt. */}
      <section className="space-y-2.5">
        {visie && fv ? (
          <Uitklap icon={Target} titel="Hoe voeg ik meer waarde toe dan mijn taken?" sub="Uit Onze visie">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Waarom mijn functie bestaat</div>
                <p className="leading-relaxed text-[var(--color-ink)]"><VisieTekst t={fv.betekenis} markeer={markeer} /></p>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Wanneer lever ik echt goed werk?</div>
                <p className="leading-relaxed text-[var(--color-ink)]"><VisieTekst t={fv.standaard} markeer={markeer} /></p>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Proactief</div>
                <p className="leading-relaxed text-[var(--color-ink)]"><VisieTekst t={fv.proactief} markeer={markeer} /></p>
              </div>
            </div>
            {meetpunten.length > 0 ? (
              <div className="mt-4 border-t border-[var(--color-line)] pt-3">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Voeg ik waarde toe? Een richting, geen afrekenpunt</div>
                <ul className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
                  {meetpunten.map((m) => (
                    <li key={m.key} className="leading-snug text-[var(--color-ink)]">
                      <span className="font-semibold">{m.titel}:</span> {m.vraag}{" "}
                      <span className="text-[var(--color-ink-muted)]">{m.meting}.{markeer ? <> Norm: <VisieTekst t={m.norm} markeer /></> : null}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Link href="/visie#functie" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-ink-muted)] hover:underline">Naar Onze visie <ArrowUpRight className="size-3.5" /></Link>
          </Uitklap>
        ) : null}

        <Uitklap icon={CircleCheck} titel="Wanneer is mijn werk klaar?">
          <ul className="space-y-1.5">
            {rol.klaarAls.map((x) => (
              <li key={x} className="flex items-start gap-2 text-[var(--color-ink)]">
                <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-[#1d6b4c]" /> {x}
              </li>
            ))}
          </ul>
        </Uitklap>

        <Uitklap icon={ListChecks} titel="Mijn vaste taken">
          <p className="mb-3 text-[var(--color-ink-muted)]">{rol.kerntaak}</p>
          <div className={cn("grid gap-4", rol.taken.length > 1 ? "md:grid-cols-3" : "")}>
            {rol.taken.map((b) => (
              <div key={b.titel}>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{b.titel}</div>
                <ul className={cn("space-y-1.5", rol.taken.length === 1 ? "sm:columns-2 sm:gap-8" : "")}>
                  {b.punten.map((x) => (
                    <li key={x} className="flex items-start gap-2 text-[var(--color-ink)]">
                      <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--color-indigo-ink)]" />{x}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Uitklap>

        <Uitklap icon={Target} titel="Mijn verantwoordelijkheden in detail" sub={`${items.length} onderdelen`}>
          {items.length === 0 ? (
            <p className="text-[var(--color-ink-muted)]">Nog geen verantwoordelijkheden vastgelegd.</p>
          ) : (
            <div className="-mx-4 -my-4 divide-y divide-[var(--color-line)]">
              {items.map((r) => {
                const verder = visie?.verderDanDeTaak[verderSleutel(r.id)] ?? null;
                const principe = verder ? visie?.principes.find((x) => x.nr === verder.principe) : null;
                return (
                <details key={r.id} className="group/item">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-neutral-soft)] [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[var(--color-ink)]">{r.titel}</div>
                      {r.verwachting ? (
                        <div className="truncate text-xs text-[var(--color-ink-muted)] group-open/item:whitespace-normal"><T t={r.verwachting} markeer={markeer} /></div>
                      ) : null}
                    </div>
                    <ChevronDown className="size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-open/item:rotate-180" />
                  </summary>
                  <div className="px-4 pb-4">
                    <p className="leading-relaxed text-[var(--color-ink)]"><T t={r.wat} markeer={markeer} /></p>
                    {verder ? (
                      <div className="mt-2.5 rounded-lg bg-[var(--color-neutral-soft)] px-3 py-2 leading-relaxed text-[var(--color-ink)]">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <strong className="font-semibold">Verder dan de taak</strong>
                          {principe ? <PrincipeChip nr={principe.nr} titel={principe.titel} /> : null}
                        </div>
                        <VisieTekst t={verder.tekst} markeer={markeer} />
                      </div>
                    ) : null}
                    <dl className="mt-2.5 space-y-1">
                      {r.wanneer ? <Detail label="Wanneer"><T t={r.wanneer} markeer={markeer} /></Detail> : null}
                      {r.afgerond ? <Detail label="Klaar als"><T t={r.afgerond} markeer={markeer} /></Detail> : null}
                      {r.betrokken.length > 0 ? <Detail label="Samen met">{r.betrokken.map(naamVan).join(", ")}</Detail> : null}
                      {r.vervanger ? <Detail label="Vervanger">{naamVan(r.vervanger)}</Detail> : null}
                      {r.escalatie ? <Detail label="Naar Jarno"><T t={r.escalatie} markeer={markeer} /></Detail> : null}
                    </dl>
                    {r.koppeling ? (
                      <Link href={r.koppeling.href} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-ink-muted)] hover:underline">
                        Naar {r.koppeling.label} <ArrowUpRight className="size-3.5" />
                      </Link>
                    ) : null}
                  </div>
                </details>
                );
              })}
            </div>
          )}
        </Uitklap>

        <Uitklap icon={LifeBuoy} titel="Wat doe ik bij problemen?" sub={`${rol.scenarios.length} situaties met eigenaar, actie en niveau`}>
          <div className="grid gap-3 md:grid-cols-2">
            {rol.scenarios.map((s) => (
              <div key={s.situatie} className="rounded-lg border border-[var(--color-line)] p-3.5">
                <div className="text-sm font-semibold text-[var(--color-ink)]">{s.situatie}{markeer && s.voorstel ? <Voorstel /> : null}</div>
                <dl className="mt-2 space-y-1">
                  <Detail label="Eigenaar">{s.eigenaar}</Detail>
                  <Detail label="Actie">{s.actie}</Detail>
                  <Detail label="Voorkomen">{s.voorkomen}</Detail>
                  <Detail label="Niveau">{s.niveau}</Detail>
                </dl>
              </div>
            ))}
          </div>
        </Uitklap>

        {afw && (afw.doorloopt.length > 0 || afw.beslisser) ? (
          <Uitklap icon={Palmtree} titel="Wat gebeurt er als Jarno afwezig is?">
            <div className="space-y-3">
              {afw.doorloopt.length > 0 ? (
                <ul className="space-y-1.5">
                  {afw.doorloopt.map((x) => (
                    <li key={x} className="flex items-start gap-2 text-[var(--color-ink)]">
                      <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-[#1d6b4c]" /> <span><T t={x} markeer={markeer} /></span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <dl className="space-y-1">
                {afw.beslisser ? <Detail label="Wie beslist"><T t={afw.beslisser} markeer={markeer} /></Detail> : null}
                <Detail label="Ben jij weg">
                  {afw.vervanger ? <>{naamVan(afw.vervanger)} neemt over</> : <span className="text-[#a3271c]">Nog niemand vastgelegd</span>}
                </Detail>
              </dl>
            </div>
          </Uitklap>
        ) : null}

        {kennisbankKpis.length > 0 ? (
          <Uitklap icon={Gauge} titel="Alle afspraken uit de kennisbank" sub={`${kennisbankKpis.length} normen`}>
            <dl className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
              {kennisbankKpis.map((k) => (
                <div key={k.titel} className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)] py-1">
                  <dt className="font-semibold text-[var(--color-ink)]">{k.titel}</dt>
                  <dd className="text-right text-[var(--color-ink-muted)]"><T t={k.norm} markeer={markeer} /></dd>
                </div>
              ))}
            </dl>
          </Uitklap>
        ) : null}
      </section>

      <p className="flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
        Bron: <Link href={KENNISBANK_TEAM} className="inline-flex items-center gap-1 hover:text-[var(--color-ink)]"><BookOpen className="size-3" /> Kennisbank › Team Shortclips</Link>
      </p>
    </div>
  );
}
