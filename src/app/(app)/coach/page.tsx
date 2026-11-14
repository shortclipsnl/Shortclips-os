import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, PageHeader, Stat } from "@/components/ui";
import { requireFinanceOwner } from "@/server/auth/finance-guard";
import { getDag, getWeek, recenteDagen, recenteWeken } from "@/server/coach/store";
import { amsDate, isoWeekId, longDateNl, mondayOf } from "@/server/coach/time";
import { WEGING, type Onderdeel } from "@/server/coach/types";
import { ActieStatusKnoppen, AvondFormulier, GenereerKnop } from "./forms";

export const metadata: Metadata = { title: "Coach" };
export const dynamic = "force-dynamic";
// Genereren met het sterke model kan een minuut duren.
export const maxDuration = 300;

/**
 * Coach: persoonlijke businesscoach en groeicontroller. Uitsluitend voor de
 * eigenaar; teamleden krijgen "pagina niet gevonden".
 */
export default async function CoachPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireFinanceOwner();
  const sp = await searchParams;
  const vandaag = amsDate();
  const weekId = sp.week && /^\d{4}-w\d{2}$/.test(sp.week) ? sp.week : isoWeekId(vandaag);
  const [dag, week, dagen, weken] = await Promise.all([getDag(vandaag), getWeek(weekId), recenteDagen(10), recenteWeken(8)]);

  const maandag = mondayOf(vandaag);
  const dezeWeek = dagen.filter((d) => d.datum >= maandag && d.avond);
  const weekGem = dezeWeek.length ? Math.round((dezeWeek.reduce((s, d) => s + (d.avond?.gewogen ?? 0), 0) / dezeWeek.length) * 10) / 10 : null;
  const ingevuld = dagen.filter((d) => d.input).length;
  const o = dag?.ochtend;
  const a = dag?.avond;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader
        title="Coach"
        description={`${longDateNl(vandaag)}. Iedere werkdag moet bijdragen aan winst, sales of structurele vooruitgang. Druk zijn is geen prestatie. Alleen zichtbaar voor jou.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Score vandaag" value={a ? fmt(a.gewogen) : "nog niet"} tone={a ? toneVoor(a.gewogen) : "neutral"} hint={a ? (a.status === "definitief" ? "Definitief" : "Voorlopig, vul je avondcheck in") : "Na de avondcontrole"} />
        <Stat label="Gemiddelde deze week" value={weekGem != null ? fmt(weekGem) : "nog niet"} tone={weekGem != null ? toneVoor(weekGem) : "neutral"} hint={`${dezeWeek.length} beoordeelde dag(en)`} />
        <Stat label="Ochtendacties gehaald" value={o ? `${o.acties.filter((x) => x.status === "gehaald").length} van ${o.acties.length}` : "nog niet"} hint="Zet de status zelf bij elke actie" />
        <Stat label="Avondchecks ingevuld" value={`${ingevuld} van ${dagen.length}`} tone={dagen.length && ingevuld / dagen.length < 0.75 ? "warn" : "neutral"} hint="Laatste 10 dagen. Zonder jouw input blijft impact onbewezen." />
      </div>

      <Sectie titel="Ochtendcontrole" actie={o ? null : <GenereerKnop soort="ochtend" label="Ochtendcontrole nu maken" />}>
        {o ? (
          <div className="space-y-4">
            <p className="text-base font-medium text-[var(--color-ink)]">{o.kern}</p>
            {o.waarschuwing ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-sm text-[#8a5300]">{o.waarschuwing}</p> : null}
            <ol className="space-y-3">
              {o.acties.map((x, i) => (
                <li key={i} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium text-[var(--color-ink)]">{i + 1}. {x.wat}</p>
                    <ActieStatusKnoppen datum={vandaag} index={i} status={x.status} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{x.waarom}</p>
                  <p className="mt-1 text-sm"><span className="font-medium text-[var(--color-ink)]">Klaar als:</span> <span className="text-[var(--color-ink-muted)]">{x.klaarAls}</span>{x.tijd ? <span className="text-[var(--color-ink-faint)]"> · {x.tijd}</span> : null}</p>
                </li>
              ))}
            </ol>
            <div className="grid gap-3 md:grid-cols-3">
              <Blok titel="Opvolgen">{o.opvolging}</Blok>
              <Blok titel="Blokkerende beslissingen">{o.blokkades}</Blok>
              <Blok titel="Delegeren">{o.delegeren}</Blok>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-ink-muted)]">Wordt op werkdagen om 07:45 automatisch gemaakt uit je agenda, open offertes, leads en contracten.</p>
        )}
      </Sectie>

      <section id="avond" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Sectie titel="Avondcheck">
          <AvondFormulier initial={dag?.input ?? undefined} />
        </Sectie>
        <Sectie titel={a ? `Beoordeling ${fmt(a.gewogen)}` : "Beoordeling"} actie={a ? <Badge tone={a.status === "definitief" ? "good" : "warn"}>{a.status}</Badge> : null}>
          {a ? (
            <div className="space-y-4">
              <table className="w-full text-sm">
                <tbody>
                  {(Object.keys(WEGING) as Onderdeel[]).map((k) => (
                    <tr key={k} className="border-b border-[var(--color-line)] align-top last:border-0">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-[var(--color-ink)]">{WEGING[k].label}</p>
                        <p className="text-xs text-[var(--color-ink-faint)]">{Math.round(WEGING[k].gewicht * 100)}%</p>
                      </td>
                      <td className="w-12 py-2 pr-3 text-right text-base font-semibold text-[var(--color-ink)]">{a.scores[k].score}</td>
                      <td className="py-2 text-[var(--color-ink-muted)]">{a.scores[k].bewijs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="grid gap-3 sm:grid-cols-2">
                <Blok titel="Bereikt">{a.bereikt}</Blok>
                <Blok titel="Tijd verspild">{a.verspild}</Blok>
                <Blok titel="Belangrijkste gemiste kans">{a.gemisteKans}</Blok>
                <Blok titel="De ene actie voor morgen" sterk>{a.actieMorgen}</Blok>
              </div>
              {a.patroon ? <p className="rounded-[var(--radius-sm)] bg-[var(--color-violet-soft)] px-3 py-2 text-sm text-[#5636c4]"><span className="font-medium">Patroon:</span> {a.patroon}</p> : null}
              {a.vragen.length ? (
                <div className="text-sm">
                  <p className="font-medium text-[var(--color-ink)]">Om je score definitief te maken:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[var(--color-ink-muted)]">{a.vragen.map((v, i) => <li key={i}>{v}</li>)}</ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-ink-muted)]">Om 17:22 maakt de coach een voorlopige beoordeling. Vul links in wat je gedaan hebt om hem definitief te maken.</p>
          )}
        </Sectie>
      </section>

      <Sectie
        titel={week ? `Weekrapport ${week.id.replace("-w", " week ")}` : "Weekrapport"}
        actie={
          <div className="flex flex-wrap items-center gap-3">
            {weken.length ? (
              <div className="flex flex-wrap gap-1">
                {weken.map((w) => (
                  <Link key={w.id} href={`/coach?week=${w.id}`} className={`rounded-full px-2.5 py-0.5 text-xs ${w.id === weekId ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}>
                    W{w.id.slice(-2)}
                  </Link>
                ))}
              </div>
            ) : null}
            {weekId === isoWeekId(vandaag) ? <GenereerKnop soort="week" label={week ? "Opnieuw maken" : "Weekrapport nu maken"} /> : null}
          </div>
        }
      >
        {week ? (
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <Cijfers titel="Activiteit" rijen={week.cijfers.activiteit} />
              <Cijfers titel="Commerciële voortgang" rijen={week.cijfers.voortgang} />
              <Cijfers titel="Gerealiseerd" rijen={week.cijfers.gerealiseerd} />
            </div>
            <p className="rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 py-3 text-sm text-white"><span className="font-semibold">Ongemakkelijke waarheid:</span> {week.waarheid}</p>
            <div className="space-y-3">
              {week.rapport.map((r, i) => (
                <div key={i}>
                  <p className="text-sm font-semibold text-[var(--color-ink)]">{r.titel}</p>
                  <p className="text-sm text-[var(--color-ink-muted)]">{r.tekst}</p>
                </div>
              ))}
            </div>
            {week.prioriteiten.length ? (
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Prioriteiten volgende week</p>
                <ol className="space-y-2">
                  {week.prioriteiten.map((p, i) => (
                    <li key={i} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2 text-sm">
                      <span className="font-medium text-[var(--color-ink)]">{i + 1}. {p.wat}</span>
                      <span className="text-[var(--color-ink-muted)]"> · Klaar als: {p.klaarAls}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-ink-muted)]">Wordt elke vrijdag om 16:41 gemaakt. De cijfers komen uit offertes, leads en contracten in het portaal, aangevuld met wat je zelf invult.</p>
        )}
      </Sectie>

      {dagen.length ? (
        <Sectie titel="Laatste dagen">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-ink-faint)]">
                <th className="pb-2 font-medium">Dag</th>
                <th className="pb-2 font-medium">Score</th>
                <th className="pb-2 font-medium">Acties gehaald</th>
                <th className="pb-2 font-medium">Actie voor de volgende dag</th>
              </tr>
            </thead>
            <tbody>
              {dagen.map((d) => (
                <tr key={d.datum} className="border-t border-[var(--color-line)] align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-[var(--color-ink)]">{longDateNl(d.datum)}</td>
                  <td className="py-2 pr-3">{d.avond ? <Badge tone={toneVoor(d.avond.gewogen)}>{fmt(d.avond.gewogen)}{d.avond.status === "voorlopig" ? " *" : ""}</Badge> : <span className="text-[var(--color-ink-faint)]">geen</span>}</td>
                  <td className="py-2 pr-3 text-[var(--color-ink-muted)]">{d.ochtend ? `${d.ochtend.acties.filter((x) => x.status === "gehaald").length} van ${d.ochtend.acties.length}` : "geen"}</td>
                  <td className="py-2 text-[var(--color-ink-muted)]">{d.avond?.actieMorgen ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-[var(--color-ink-faint)]">* voorlopig: zonder jouw eigen avondcheck</p>
        </Sectie>
      ) : null}
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const toneVoor = (n: number) => (n >= 7.5 ? "good" : n >= 5.5 ? "warn" : "bad") as "good" | "warn" | "bad";

function Sectie({ titel, actie, children }: { titel: string; actie?: ReactNode; children: ReactNode }) {
  return (
    <section className="sc-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-ink)]">{titel}</h2>
        {actie}
      </div>
      {children}
    </section>
  );
}

function Blok({ titel, children, sterk }: { titel: string; children: ReactNode; sterk?: boolean }) {
  return (
    <div className={`rounded-[var(--radius-sm)] p-3 ${sterk ? "bg-[var(--color-indigo-ink)] text-white" : "bg-[var(--color-surface-sunken)]"}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${sterk ? "text-white/70" : "text-[var(--color-ink-faint)]"}`}>{titel}</p>
      <p className={`mt-1 text-sm ${sterk ? "text-white" : "text-[var(--color-ink-muted)]"}`}>{children || "Onbekend"}</p>
    </div>
  );
}

function Cijfers({ titel, rijen }: { titel: string; rijen: Array<{ label: string; waarde: string }> }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{titel}</p>
      <dl className="space-y-1.5 text-sm">
        {rijen.map((r) => (
          <div key={r.label} className="flex justify-between gap-3">
            <dt className="text-[var(--color-ink-muted)]">{r.label}</dt>
            <dd className={`text-right font-medium ${r.waarde.startsWith("onbekend") ? "text-[var(--color-ink-faint)]" : "text-[var(--color-ink)]"}`}>{r.waarde}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
