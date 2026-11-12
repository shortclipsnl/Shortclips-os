import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import {
  ArrowUpRight, BookOpen, ChevronDown, CircleCheck, Clapperboard, Film, Megaphone,
  MessageCircle, MessagesSquare, Palmtree, PenLine, Siren, Target,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  KENNISBANK_TEAM, kaal, naamVan,
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

/** KPI's waarvan de actuele stand betrouwbaar uit het werkoverzicht te tellen is. */
const KPI_LIVE: Record<string, Exclude<Categorie, "alle">> = {
  "Scripts op tijd": "scripting",
  "Reactietijd naar klanten": "klantcontact",
  "Openstaande klantvragen": "klantcontact",
  "Opleveringen op tijd": "editing",
  "Deadlines editors": "editing",
  "Publicaties volgens planning": "publicatie",
  "Opnames volgens planning": "opname",
};

const BESLIS: Record<Niveau, { titel: string; balk: string; tekst: string; dot: string; icon: typeof CircleCheck }> = {
  zelf: { titel: "Zelf beslissen", balk: "bg-[var(--color-good)]", tekst: "text-[#1d6b4c]", dot: "text-[var(--color-good)]", icon: CircleCheck },
  overleg: { titel: "Overleg met Jarno", balk: "bg-[var(--color-warn)]", tekst: "text-[#8a5300]", dot: "text-[var(--color-warn)]", icon: MessageCircle },
  escaleren: { titel: "Altijd naar Jarno", balk: "bg-[var(--color-bad)]", tekst: "text-[#a3271c]", dot: "text-[var(--color-bad)]", icon: Siren },
};
/** Zoveel punten per beslisblok direct zichtbaar; de rest klapt open. */
const ZICHTBAAR = 4;

function Kop({ titel, sub }: { titel: string; sub?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="text-base font-semibold text-[var(--color-ink)]">{titel}</h2>
      {sub ? <span className="text-xs text-[var(--color-ink-faint)]">{sub}</span> : null}
    </div>
  );
}

function Stand({ t }: { t: Telling }) {
  if (t.laat > 0) return <span className="rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-2xs font-bold text-[#a3271c]">{t.laat} te laat</span>;
  if (t.open > 0) return <span className="rounded-full bg-[var(--color-neutral-soft)] px-2 py-0.5 text-2xs font-bold text-[var(--color-ink)]">{t.open} open</span>;
  return null;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <dt className="text-[var(--color-ink-faint)]">{label}</dt>
      <dd className="text-[var(--color-ink)]">{children}</dd>
    </div>
  );
}

function BeslisBlok({ nv, lijst, markeer }: { nv: Niveau; lijst: string[]; markeer: boolean }) {
  const k = BESLIS[nv];
  const Icon = k.icon;
  const punt = (x: string) => (
    <li key={x} className="flex items-start gap-2 text-[13px] leading-snug text-[var(--color-ink)]">
      <span aria-hidden className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", k.balk)} />
      <span><T t={x} markeer={markeer} /></span>
    </li>
  );
  return (
    <div className="sc-card relative overflow-hidden p-4 pt-5">
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", k.balk)} />
      <div className={cn("mb-3 flex items-center gap-2 text-sm font-bold", k.tekst)}>
        <Icon className="size-4 shrink-0" /> {k.titel}
        <span className="ml-auto text-xs font-medium text-[var(--color-ink-faint)]">{lijst.length}</span>
      </div>
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

export function Weergave({ config, email, markeer, tellingen, liveBeschikbaar }: {
  config: Config; email: string; markeer: boolean; tellingen: Record<Categorie, Telling>; liveBeschikbaar: boolean;
}) {
  const items = config.verantwoordelijkheden.filter((r) => r.persoon === email && r.actief);
  const beslissingen = config.beslissingen.filter((b) => b.persoon === email && b.actief);
  const afw = config.afwezigheid[email];
  const zelf = [...new Map(items.flatMap((r) => r.bevoegdheden).map((x) => [kaal(x).toLowerCase(), x])).values()];
  const kpis = config.profielen?.[email]?.kpis ?? [];
  const lijsten: Record<Niveau, string[]> = {
    zelf,
    overleg: beslissingen.filter((b) => b.niveau === "overleg").map((b) => b.situatie),
    escaleren: beslissingen.filter((b) => b.niveau === "escaleren").map((b) => b.situatie),
  };

  return (
    <div className="space-y-8">
      {/* 1. Verantwoordelijkheden: één regel per onderdeel, details op klik. */}
      <section>
        <Kop titel="Mijn verantwoordelijkheden" sub={items.length + " onderdelen · klik voor details"} />
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen verantwoordelijkheden vastgelegd.</p>
        ) : (
          <div className="sc-card divide-y divide-[var(--color-line)] overflow-hidden">
            {items.map((r) => {
              const s = stijlVoor(r.koppeling);
              const Icon = s.icon;
              const cat = r.koppeling?.categorie && r.koppeling.categorie !== "alle" ? r.koppeling.categorie : null;
              return (
                <details key={r.id} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition hover:bg-[var(--color-neutral-soft)] [&::-webkit-details-marker]:hidden">
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", s.zacht, s.tekst)}>
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[var(--color-ink)]">{r.titel}</div>
                      {r.verwachting ? (
                        <div className="truncate text-xs text-[var(--color-ink-muted)] group-open:whitespace-normal">
                          <T t={r.verwachting} markeer={markeer} />
                        </div>
                      ) : null}
                    </div>
                    {cat ? <span className="shrink-0"><Stand t={tellingen[cat]} /></span> : null}
                    <ChevronDown className="size-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="px-4 pb-4 pl-14">
                    <p className="text-[13px] leading-relaxed text-[var(--color-ink)]"><T t={r.wat} markeer={markeer} /></p>
                    <dl className="mt-2.5 space-y-1 text-[13px]">
                      {r.wanneer ? <Detail label="Wanneer"><T t={r.wanneer} markeer={markeer} /></Detail> : null}
                      {r.afgerond ? <Detail label="Klaar als"><T t={r.afgerond} markeer={markeer} /></Detail> : null}
                      {r.betrokken.length > 0 ? <Detail label="Samen met">{r.betrokken.map(naamVan).join(", ")}</Detail> : null}
                      {r.vervanger ? <Detail label="Vervanger">{naamVan(r.vervanger)}</Detail> : null}
                      {r.escalatie ? <Detail label="Jarno erbij"><T t={r.escalatie} markeer={markeer} /></Detail> : null}
                    </dl>
                    {r.koppeling ? (
                      <Link href={r.koppeling.href} className={cn("mt-3 inline-flex items-center gap-1 text-xs font-semibold hover:underline", s.tekst)}>
                        Naar {r.koppeling.label} <ArrowUpRight className="size-3.5" />
                      </Link>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. KPI's: compacte tegels. */}
      <section>
        <Kop titel="Mijn KPI's" sub="Hierop word je beoordeeld" />
        {kpis.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen KPI&apos;s vastgelegd in de kennisbank.</p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {kpis.map((k) => {
              const cat = KPI_LIVE[k.titel];
              const s = cat ? CAT[cat] : NEUTRAAL;
              const t = cat && liveBeschikbaar ? tellingen[cat] : null;
              return (
                <div key={k.titel} className="sc-card relative flex items-start gap-3 overflow-hidden px-3.5 py-3 pl-4">
                  <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", s.balk)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{k.titel}</div>
                    <div className="mt-0.5 text-sm font-semibold leading-snug text-[var(--color-ink)]"><T t={k.norm} markeer={markeer} /></div>
                  </div>
                  {t ? (
                    t.laat > 0 ? (
                      <span className="shrink-0 rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-2xs font-bold text-[#a3271c]">{t.laat} te laat</span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-[var(--color-good-soft)] px-2 py-0.5 text-2xs font-bold text-[#1d6b4c]">Op schema</span>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. Beslissingen: drie kolommen naast elkaar. */}
      <section>
        <Kop titel="Wie beslist?" />
        <div className="grid items-start gap-3 lg:grid-cols-3">
          <BeslisBlok nv="zelf" lijst={lijsten.zelf} markeer={markeer} />
          <BeslisBlok nv="overleg" lijst={lijsten.overleg} markeer={markeer} />
          <BeslisBlok nv="escaleren" lijst={lijsten.escaleren} markeer={markeer} />
        </div>
        <p className="mt-2.5 text-xs text-[var(--color-ink-faint)]">
          Naar Jarno? Kom altijd met een eigen voorstel, via de{" "}
          <Link href="/beslissingshulp#jarno" className="font-medium text-[var(--color-ink-muted)] hover:underline">Beslissingshulp</Link>.
        </p>
      </section>

      {/* 4. Jarno afwezig: ingeklapt. */}
      {afw && (afw.doorloopt.length > 0 || afw.beslisser) ? (
        <details className="group sc-card overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-[var(--color-ink)] hover:bg-[var(--color-neutral-soft)] [&::-webkit-details-marker]:hidden">
            <Palmtree className="size-4 text-[var(--color-ink-faint)]" /> Als Jarno afwezig is
            <ChevronDown className="ml-auto size-4 text-[var(--color-ink-faint)] transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 px-4 pb-4 text-[13px]">
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
        </details>
      ) : null}

      <p className="flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)]">
        Bron: <Link href={KENNISBANK_TEAM} className="inline-flex items-center gap-1 hover:text-[var(--color-ink)]"><BookOpen className="size-3" /> Kennisbank › Team Shortclips</Link>
      </p>
    </div>
  );
}
