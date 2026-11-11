import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import {
  ArrowUpRight, BookOpen, ChevronDown, CircleCheck, Clapperboard, Clock, Film, Flag, Gauge, Megaphone,
  MessageCircle, MessagesSquare, Palmtree, PenLine, ShieldCheck, Siren, Target, UserRound,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  KENNISBANK_TEAM, NIVEAUS, kaal, naamVan,
  type Config, type Categorie, type Koppeling, type Niveau,
} from "@/lib/verantwoordelijkheden/data";
import type { Telling } from "@/server/verantwoordelijkheden";

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

/** Subtiele kleur per soort werk: een gekleurde rand en icoon, verder rustig wit. */
type Stijl = { balk: string; zacht: string; tekst: string; icon: typeof Target };
const CAT: Record<Exclude<Categorie, "alle">, Stijl> = {
  klantcontact: { balk: "bg-[var(--color-brand-500)]", zacht: "bg-[color-mix(in_srgb,var(--color-brand-500)_12%,transparent)]", tekst: "text-[#00739f]", icon: MessagesSquare },
  scripting: { balk: "bg-[var(--color-violet)]", zacht: "bg-[color-mix(in_srgb,var(--color-violet)_12%,transparent)]", tekst: "text-[#5a3fd6]", icon: PenLine },
  opname: { balk: "bg-[var(--color-warn)]", zacht: "bg-[var(--color-warn-soft)]", tekst: "text-[#8a5300]", icon: Clapperboard },
  editing: { balk: "bg-[#3b6fd8]", zacht: "bg-[color-mix(in_srgb,#3b6fd8_12%,transparent)]", tekst: "text-[#2b55ad]", icon: Film },
  publicatie: { balk: "bg-[var(--color-good)]", zacht: "bg-[var(--color-good-soft)]", tekst: "text-[#1d6b4c]", icon: Megaphone },
  intern: { balk: "bg-[var(--color-indigo-ink)]", zacht: "bg-[var(--color-neutral-soft)]", tekst: "text-[var(--color-ink-muted)]", icon: Target },
};
const NEUTRAAL: Stijl = CAT.intern;
const stijlVoor = (k: Koppeling | null): Stijl => (k?.categorie && k.categorie !== "alle" ? CAT[k.categorie] : NEUTRAAL);

/** KPI's waarvan de actuele stand betrouwbaar uit het werkoverzicht te tellen is. Alleen tellen wat er al is. */
const KPI_LIVE: Record<string, Exclude<Categorie, "alle">> = {
  "Scripts op tijd": "scripting",
  "Reactietijd naar klanten": "klantcontact",
  "Openstaande klantvragen": "klantcontact",
  "Opleveringen op tijd": "editing",
  "Deadlines editors": "editing",
  "Publicaties volgens planning": "publicatie",
  "Opnames volgens planning": "opname",
};
const KPI_STIJL: Record<string, Stijl> = Object.fromEntries(Object.entries(KPI_LIVE).map(([k, c]) => [k, CAT[c]]));

const BESLIS: Record<Niveau, { titel: string; balk: string; kop: string; tekst: string; dot: string; icon: typeof CircleCheck }> = {
  zelf: { titel: "Dit beslis ik zelfstandig", balk: "bg-[var(--color-good)]", kop: "bg-[var(--color-good-soft)]", tekst: "text-[#1d6b4c]", dot: "text-[var(--color-good)]", icon: CircleCheck },
  overleg: { titel: "Wanneer overleg ik met Jarno?", balk: "bg-[var(--color-warn)]", kop: "bg-[var(--color-warn-soft)]", tekst: "text-[#8a5300]", dot: "text-[var(--color-warn)]", icon: MessageCircle },
  escaleren: { titel: "Dit gaat altijd naar Jarno", balk: "bg-[var(--color-bad)]", kop: "bg-[var(--color-bad-soft)]", tekst: "text-[#a3271c]", dot: "text-[var(--color-bad)]", icon: Siren },
};
const BESLIS_UITLEG: Record<Niveau, string> = {
  zelf: "Geen toestemming nodig. Bij niveau 2 leg je het besluit vast in het portaal.",
  overleg: NIVEAUS.overleg.uitleg,
  escaleren: NIVEAUS.escaleren.uitleg,
};

function Sectie({ titel, sub, children }: { titel: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--color-line)] pb-2">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{titel}</h2>
        {sub ? <span className="text-sm text-[var(--color-ink-muted)]">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Stand({ t }: { t: Telling }) {
  if (t.laat > 0) return <span className="rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-2xs font-bold text-[#a3271c]">{t.laat} te laat</span>;
  if (t.open > 0) return <span className="rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-2xs font-bold text-[var(--color-ink)]">{t.open} open</span>;
  return null;
}

function BeslisBlok({ nv, lijst, markeer }: { nv: Niveau; lijst: string[]; markeer: boolean }) {
  const k = BESLIS[nv];
  const Icon = k.icon;
  return (
    <div className="sc-card relative overflow-hidden">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", k.balk)} />
      <div className={cn("px-4 pb-3 pt-4", k.kop)}>
        <div className={cn("flex items-center gap-2 text-[15px] font-bold", k.tekst)}>
          <Icon className="size-4.5 shrink-0" /> {k.titel}
        </div>
        <p className="mt-1 text-xs leading-snug text-[var(--color-ink-muted)]">{BESLIS_UITLEG[nv]}</p>
      </div>
      {lijst.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-ink-muted)]">Niets vastgelegd.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)]">
          {lijst.map((x) => (
            <li key={x} className="flex items-start gap-2.5 px-4 py-2.5 text-sm leading-snug text-[var(--color-ink)]">
              <Icon className={cn("mt-0.5 size-3.5 shrink-0", k.dot)} />
              <span><T t={x} markeer={markeer} /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Weergave({ config, email, markeer, tellingen, liveBeschikbaar }: {
  config: Config; email: string; markeer: boolean; tellingen: Record<Categorie, Telling>; liveBeschikbaar: boolean;
}) {
  const items = config.verantwoordelijkheden.filter((r) => r.persoon === email && r.actief);
  const beslissingen = config.beslissingen.filter((b) => b.persoon === email && b.actief);
  const afw = config.afwezigheid[email];
  // Zelfstandig: alle bevoegdheden uit de verantwoordelijkheden, zonder dubbelingen.
  const zelf = [...new Map(items.flatMap((r) => r.bevoegdheden).map((x) => [kaal(x).toLowerCase(), x])).values()];
  const profiel = config.profielen?.[email];
  const kpis = profiel?.kpis ?? [];
  const lijsten: Record<Niveau, string[]> = {
    zelf,
    overleg: beslissingen.filter((b) => b.niveau === "overleg").map((b) => b.situatie),
    escaleren: beslissingen.filter((b) => b.niveau === "escaleren").map((b) => b.situatie),
  };

  return (
    <div>
      {/* 1. Waar ben ik verantwoordelijk voor? */}
      <Sectie titel="Mijn verantwoordelijkheden" sub={`${items.length} onderdelen`}>
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen verantwoordelijkheden vastgelegd.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((r) => {
              const s = stijlVoor(r.koppeling);
              const Icon = s.icon;
              const cat = r.koppeling?.categorie && r.koppeling.categorie !== "alle" ? r.koppeling.categorie : null;
              const heeftDetails = Boolean(r.afgerond || r.betrokken.length || r.escalatie || r.vervanger);
              return (
                <article key={r.id} className="sc-card relative flex flex-col overflow-hidden p-4 pl-5 sm:p-5 sm:pl-6">
                  <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", s.balk)} />
                  <div className="flex items-start gap-3">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", s.zacht, s.tekst)}>
                      <Icon className="size-4" />
                    </span>
                    <h3 className="min-w-0 flex-1 pt-1 text-base font-semibold leading-snug text-[var(--color-ink)]">{r.titel}</h3>
                    {cat ? <span className="shrink-0 pt-1"><Stand t={tellingen[cat]} /></span> : null}
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink)]"><T t={r.wat} markeer={markeer} /></p>

                  <dl className="mt-3 space-y-1.5 rounded-lg bg-[var(--color-neutral-soft)] px-3 py-2.5 text-[13px]">
                    {r.wanneer ? (
                      <div className="flex gap-2">
                        <dt className="flex w-[74px] shrink-0 items-center gap-1 self-start font-semibold text-[var(--color-ink-muted)]"><Clock className="size-3.5" /> Wanneer</dt>
                        <dd className="text-[var(--color-ink)]"><T t={r.wanneer} markeer={markeer} /></dd>
                      </div>
                    ) : null}
                    {r.verwachting ? (
                      <div className="flex gap-2">
                        <dt className="flex w-[74px] shrink-0 items-center gap-1 self-start font-semibold text-[var(--color-ink-muted)]"><Gauge className="size-3.5" /> Norm</dt>
                        <dd className="font-medium text-[var(--color-ink)]"><T t={r.verwachting} markeer={markeer} /></dd>
                      </div>
                    ) : null}
                  </dl>

                  {heeftDetails ? (
                    <details className="group mt-2">
                      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] [&::-webkit-details-marker]:hidden">
                        Meer details <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                      </summary>
                      <dl className="mt-2 space-y-1.5 text-[13px]">
                        {r.afgerond ? <div><dt className="inline font-semibold text-[var(--color-ink-muted)]">Klaar als: </dt><dd className="inline text-[var(--color-ink)]"><T t={r.afgerond} markeer={markeer} /></dd></div> : null}
                        {r.betrokken.length > 0 ? <div><dt className="inline font-semibold text-[var(--color-ink-muted)]">Samen met: </dt><dd className="inline text-[var(--color-ink)]">{r.betrokken.map(naamVan).join(", ")}</dd></div> : null}
                        {r.vervanger ? <div className="flex items-center gap-1.5 text-[var(--color-ink-muted)]"><UserRound className="size-3.5" /> Vervanger: <span className="text-[var(--color-ink)]">{naamVan(r.vervanger)}</span></div> : null}
                        {r.escalatie ? <div className="flex items-start gap-1.5 text-[#8a5300]"><Flag className="mt-0.5 size-3.5 shrink-0" /> <span>Jarno erbij als: <T t={r.escalatie} markeer={markeer} /></span></div> : null}
                      </dl>
                    </details>
                  ) : null}

                  {r.koppeling ? (
                    <div className="mt-auto pt-3">
                      <Link href={r.koppeling.href} className={cn("inline-flex items-center gap-1 text-xs font-semibold hover:underline", s.tekst)}>
                        Naar {r.koppeling.label} <ArrowUpRight className="size-3.5" />
                      </Link>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </Sectie>

      {/* 2. Welke KPI's moet ik behalen? */}
      <Sectie titel="Mijn KPI's" sub="Hierop word je beoordeeld">
        {kpis.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen KPI&apos;s vastgelegd in de kennisbank.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {kpis.map((k) => {
              const cat = KPI_LIVE[k.titel];
              const s = KPI_STIJL[k.titel] ?? NEUTRAAL;
              const t = cat ? tellingen[cat] : null;
              return (
                <div key={k.titel} className="sc-card relative flex flex-col overflow-hidden p-4 pt-5">
                  <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", s.balk)} />
                  <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">{k.titel}</div>
                  <div className="mt-1.5 text-[17px] font-semibold leading-snug text-[var(--color-ink)]"><T t={k.norm} markeer={markeer} /></div>
                  {t && liveBeschikbaar ? (
                    <div className="mt-auto flex items-center gap-1.5 pt-3 text-xs">
                      <span className="text-[var(--color-ink-faint)]">Nu:</span>
                      {t.laat > 0 ? (
                        <span className="rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 font-semibold text-[#a3271c]">{t.laat} te laat</span>
                      ) : (
                        <span className="rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 font-semibold text-[#1d6b4c]">
                          Op schema{t.open > 0 ? ` · ${t.open} open` : ""}
                        </span>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {liveBeschikbaar && kpis.some((k) => KPI_LIVE[k.titel]) ? (
          <p className="mt-2.5 text-xs text-[var(--color-ink-faint)]">De actuele stand komt uit je open punten op Vandaag. Waar geen stand staat, is die niet betrouwbaar uit het portaal te halen.</p>
        ) : null}
      </Sectie>

      {/* 3 en 4. Wat beslis ik zelf, wanneer overleg ik, wat gaat altijd naar Jarno? */}
      <Sectie titel="Mijn beslissingsbevoegdheden">
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <BeslisBlok nv="zelf" lijst={lijsten.zelf} markeer={markeer} />
          <div className="grid gap-4">
            <BeslisBlok nv="overleg" lijst={lijsten.overleg} markeer={markeer} />
            <BeslisBlok nv="escaleren" lijst={lijsten.escaleren} markeer={markeer} />
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
          Moet iets naar Jarno? Gebruik het escalatieformat in de{" "}
          <Link href="/beslissingshulp#jarno" className="font-medium text-[var(--color-brand-700)] hover:underline">Beslissingshulp</Link>{" "}
          en kom altijd met een eigen voorstel.
        </p>
      </Sectie>

      {/* Jarno afwezig: bestaande inhoud, compact onderaan */}
      {afw && (afw.doorloopt.length > 0 || afw.beslisser) && (
        <section className="sc-card mb-6 grid gap-4 p-4 sm:p-5 md:grid-cols-[1.3fr_1fr]">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
              <Palmtree className="size-4 text-[var(--color-ink-faint)]" /> Als Jarno afwezig is, loopt dit gewoon door
            </div>
            <ul className="space-y-1.5">
              {afw.doorloopt.map((x) => (
                <li key={x} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-[#1d6b4c]" /> <T t={x} markeer={markeer} />
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg bg-[var(--color-neutral-soft)] p-3.5 text-sm">
            <div className="mb-1 flex items-center gap-2 font-semibold text-[var(--color-ink)]">
              <ShieldCheck className="size-4 text-[var(--color-ink-faint)]" /> Wie beslist
            </div>
            <p className="text-[var(--color-ink)]"><T t={afw.beslisser} markeer={markeer} /></p>
            <p className="mt-2 text-[var(--color-ink-muted)]">
              Ben je zelf afwezig? Dan neemt {afw.vervanger ? <strong className="text-[var(--color-ink)]">{naamVan(afw.vervanger)}</strong> : <span className="font-medium text-[#a3271c]">nog niemand vastgelegd</span>} je werk over.
            </p>
          </div>
        </section>
      )}

      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--color-ink-faint)]">
        Bron: <Link href={KENNISBANK_TEAM} className="inline-flex items-center gap-1 hover:text-[var(--color-ink)]"><BookOpen className="size-3" /> Kennisbank › Team Shortclips</Link>
        <span>· Je krijgt hiervoor geen aparte meldingen.</span>
      </p>
    </div>
  );
}
