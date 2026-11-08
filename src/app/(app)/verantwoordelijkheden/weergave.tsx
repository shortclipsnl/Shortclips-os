import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { ArrowUpRight, CalendarClock, CircleCheck, Flag, MessageCircle, Palmtree, ShieldCheck, Siren, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  FREQUENTIES, NIVEAUS, kaal, naamVan,
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

const KLEUR: Record<Niveau, { soft: string; tekst: string; rand: string; dot: string; icon: typeof CircleCheck }> = {
  zelf: { soft: "bg-[var(--color-good-soft)]", tekst: "text-[#1d6b4c]", rand: "border-[#bfe3cf]", dot: "bg-[var(--color-good)]", icon: CircleCheck },
  overleg: { soft: "bg-[var(--color-warn-soft)]", tekst: "text-[#8a5300]", rand: "border-[#f1d2a8]", dot: "bg-[var(--color-warn)]", icon: MessageCircle },
  escaleren: { soft: "bg-[var(--color-bad-soft)]", tekst: "text-[#a3271c]", rand: "border-[#f0c3bf]", dot: "bg-[var(--color-bad)]", icon: Siren },
};

function Blok({ nr, titel, sub, children }: { nr: number; titel: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-xs font-bold tabular-nums text-[var(--color-ink-faint)]">{String(nr).padStart(2, "0")}</span>
        <h2 className="text-base font-semibold text-[var(--color-ink)]">{titel}</h2>
        {sub ? <span className="text-sm text-[var(--color-ink-muted)]">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Live({ k, tellingen }: { k: Koppeling | null; tellingen: Record<Categorie, Telling> }) {
  if (!k) return null;
  const t = k.categorie ? tellingen[k.categorie] : null;
  return (
    <Link href={k.href} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-ink-muted)] transition hover:text-[var(--color-ink)]">
      {k.label}
      {t && t.open > 0 ? (
        <span className={cn("rounded-full px-1.5 text-2xs font-bold", t.laat > 0 ? "bg-[var(--color-bad-soft)] text-[#a3271c]" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink)]")}>
          {t.laat > 0 ? `${t.laat} te laat` : `${t.open} open`}
        </span>
      ) : null}
      <ArrowUpRight className="size-3" />
    </Link>
  );
}

export function Weergave({ config, email, markeer, tellingen }: {
  config: Config; email: string; markeer: boolean; tellingen: Record<Categorie, Telling>;
}) {
  const items = config.verantwoordelijkheden.filter((r) => r.persoon === email && r.actief);
  const beslissingen = config.beslissingen.filter((b) => b.persoon === email && b.actief);
  const controles = config.controles.filter((c) => c.persoon === email && c.actief);
  const afw = config.afwezigheid[email];
  // Blok 2: alle bevoegdheden uit de verantwoordelijkheden, zonder dubbelingen.
  const zelf = [...new Map(items.flatMap((r) => r.bevoegdheden).map((x) => [kaal(x).toLowerCase(), x])).values()];
  const naarJarno = beslissingen.filter((b) => b.niveau !== "zelf").length;

  return (
    <div>
      {/* Kerncijfers: in één oogopslag */}
      <div className="mb-8 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { n: items.length, l: "verantwoordelijkheden", c: "text-[var(--color-ink)]" },
          { n: zelf.length, l: "zelf beslissen", c: "text-[#1d6b4c]" },
          { n: naarJarno, l: "situaties naar Jarno", c: "text-[#a3271c]" },
        ].map((s) => (
          <div key={s.l} className="sc-card px-3 py-3 sm:px-4">
            <div className={cn("text-2xl font-bold tabular-nums", s.c)}>{s.n}</div>
            <div className="text-xs text-[var(--color-ink-muted)]">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Blok 1 */}
      <Blok nr={1} titel="Mijn verantwoordelijkheden">
        {items.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen verantwoordelijkheden vastgelegd.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((r) => (
              <article key={r.id} className="sc-card flex flex-col p-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h3 className="text-[15px] font-semibold leading-snug text-[var(--color-ink)]">{r.titel}</h3>
                  <Live k={r.koppeling} tellingen={tellingen} />
                </div>
                <p className="mb-3 text-sm text-[var(--color-ink-muted)]"><T t={r.wat} markeer={markeer} /></p>
                <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Wanneer</dt>
                  <dd className="text-[var(--color-ink)]"><T t={r.wanneer} markeer={markeer} /></dd>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Verwacht</dt>
                  <dd className="text-[var(--color-ink)]"><T t={r.verwachting} markeer={markeer} /></dd>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klaar als</dt>
                  <dd className="text-[var(--color-ink)]"><T t={r.afgerond} markeer={markeer} /></dd>
                  {r.betrokken.length > 0 && (
                    <>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Met</dt>
                      <dd className="text-[var(--color-ink)]">{r.betrokken.map(naamVan).join(", ")}</dd>
                    </>
                  )}
                </dl>
                <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--color-line)] pt-2.5 text-xs" style={{ marginTop: "0.875rem" }}>
                  {r.escalatie && (
                    <span className="flex items-start gap-1.5 text-[#8a5300]">
                      <Flag className="mt-0.5 size-3 shrink-0" /> <span>Jarno erbij als: <T t={r.escalatie} markeer={markeer} /></span>
                    </span>
                  )}
                  {r.vervanger && (
                    <span className="flex items-center gap-1.5 text-[var(--color-ink-muted)]">
                      <UserRound className="size-3" /> Vervanger: {naamVan(r.vervanger)}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Blok>

      <div className="grid gap-x-5 lg:grid-cols-[1fr_1.4fr]">
        {/* Blok 2 */}
        <Blok nr={2} titel="Dit beslis ik zelfstandig">
          <div className={cn("rounded-xl border p-4", KLEUR.zelf.soft, KLEUR.zelf.rand)}>
            <p className={cn("mb-3 text-sm font-semibold", KLEUR.zelf.tekst)}>Geen toestemming van Jarno nodig.</p>
            <ul className="space-y-2">
              {zelf.map((x) => (
                <li key={x} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                  <CircleCheck className={cn("mt-0.5 size-4 shrink-0", KLEUR.zelf.tekst)} />
                  <span><T t={x} markeer={markeer} /></span>
                </li>
              ))}
            </ul>
          </div>
        </Blok>

        {/* Blok 3 */}
        <Blok nr={3} titel="Wanneer schakel ik Jarno in?">
          <div className="space-y-2.5">
            {(Object.keys(NIVEAUS) as Niveau[]).map((nv) => {
              const lijst = beslissingen.filter((b) => b.niveau === nv);
              if (lijst.length === 0) return null;
              const k = KLEUR[nv];
              const Icon = k.icon;
              return (
                <div key={nv} className={cn("rounded-xl border p-4", k.soft, k.rand)}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                    <Icon className={cn("size-4 self-center", k.tekst)} />
                    <span className={cn("text-sm font-bold", k.tekst)}>{NIVEAUS[nv].label}</span>
                    <span className="text-xs text-[var(--color-ink-muted)]">{NIVEAUS[nv].uitleg}</span>
                  </div>
                  <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    {lijst.map((b) => (
                      <li key={b.id} className="flex items-start gap-2 text-sm text-[var(--color-ink)]">
                        <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", k.dot)} />
                        <T t={b.situatie} markeer={markeer} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <p className="text-xs text-[var(--color-ink-muted)]">
              Moet iets naar Jarno? Gebruik het escalatieformat in de{" "}
              <Link href="/beslissingshulp#jarno" className="font-medium text-[var(--color-brand-700)] hover:underline">Beslissingshulp</Link>{" "}
              en kom altijd met een eigen voorstel.
            </p>
          </div>
        </Blok>
      </div>

      {/* Blok 4 */}
      <Blok nr={4} titel="Mijn vaste controlemomenten" sub="Uit je bestaande taken en overzichten, geen extra takenlijst">
        <div className="grid gap-3 md:grid-cols-3">
          {FREQUENTIES.map((f) => {
            const lijst = controles.filter((c) => c.frequentie === f.key);
            return (
              <div key={f.key} className="sc-card p-4">
                <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  <CalendarClock className="size-4 text-[var(--color-ink-faint)]" /> {f.label}
                </div>
                {lijst.length === 0 ? (
                  <p className="text-sm text-[var(--color-ink-faint)]">Niets vastgelegd.</p>
                ) : (
                  <ul className="space-y-2">
                    {lijst.map((c) => {
                      const t = c.koppeling?.categorie ? tellingen[c.koppeling.categorie] : null;
                      const inhoud = (
                        <>
                          <span className="min-w-0 flex-1">{c.titel}</span>
                          {t && t.open > 0 ? (
                            <span className={cn("shrink-0 rounded-full px-1.5 text-2xs font-bold", t.laat > 0 ? "bg-[var(--color-bad-soft)] text-[#a3271c]" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink)]")}>
                              {t.laat > 0 ? `${t.laat} te laat` : t.open}
                            </span>
                          ) : null}
                        </>
                      );
                      return (
                        <li key={c.id}>
                          {c.koppeling ? (
                            <Link href={c.koppeling.href} className="flex items-center gap-2 rounded-md text-sm text-[var(--color-ink)] hover:text-[var(--color-brand-700)]">
                              {inhoud}
                              <ArrowUpRight className="size-3 shrink-0 text-[var(--color-ink-faint)]" />
                            </Link>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-[var(--color-ink)]">{inhoud}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </Blok>

      {/* Jarno afwezig */}
      {afw && (afw.doorloopt.length > 0 || afw.beslisser) && (
        <Blok nr={5} titel="Wat doe ik als Jarno afwezig is?">
          <div className="sc-card grid gap-4 p-4 md:grid-cols-[1.3fr_1fr]">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                <Palmtree className="size-4 text-[var(--color-ink-faint)]" /> Dit loopt gewoon door
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
              <p className="mt-2 text-[var(--color-ink-muted)]">Niets blijft liggen in afwachting van Jarno: neem het besluit dat binnen je bevoegdheid past en leg het vast in het portaal.</p>
            </div>
          </div>
        </Blok>
      )}

      <p className="text-xs text-[var(--color-ink-faint)]">
        Je krijgt hiervoor geen aparte meldingen. Wat aandacht nodig heeft, staat in je dagstart op Vandaag.
      </p>
    </div>
  );
}
