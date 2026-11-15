import type { ReactNode } from "react";
import { kortDatum, langDatum } from "@/lib/kwartaal";
import type { Inzicht, Zekerheid } from "@/lib/kwartaal-inhoud";
import type { KlantMetrics, KlantRapport } from "@/lib/kwartaal-klant";

/**
 * De klantversie van een kwartaalrapportage als pagina. Gedeeld door het
 * klantportaal en de interne controle ("zo ziet de klant het"), zodat beide
 * exact hetzelfde tonen. Accepteert uitsluitend `KlantRapport`: de interne
 * verdieping kan hier per constructie niet in terechtkomen.
 */

const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", youtube: "YouTube Shorts", linkedin: "LinkedIn", totaal: "Alle kanalen" };
const plat = (p: string) => PLATFORM[p] ?? p;
const nf = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n).toLocaleString("nl-NL") : "–");
const signed = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n).toLocaleString("nl-NL")}`;
const pct = (n: number) => `${n > 0 ? "+" : ""}${(Math.round(n * 10) / 10).toLocaleString("nl-NL")}%`;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const ZEK: Record<Zekerheid, string> = { bewezen: "Volgt uit de cijfers", waarschijnlijk: "Waarschijnlijk", hypothese: "Vermoeden" };

function Zeker({ z }: { z: Zekerheid }) {
  if (z === "bewezen") return null;
  return <span className="ml-1.5 inline-block rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 align-middle text-[10.5px] font-medium text-[var(--color-ink-muted)]">{ZEK[z]}</span>;
}

function Section({ id, kicker, title, lead, children, card }: { id: string; kicker?: string; title: string; lead?: string; children: ReactNode; card: string }) {
  return (
    <section id={id} className={`${card} scroll-mt-24 p-5 sm:p-7`}>
      {kicker ? <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{kicker}</p> : null}
      <h2 className="mt-0.5 text-[20px] font-bold tracking-tight text-[var(--color-ink)]">{title}</h2>
      {lead ? <p className="mt-1 max-w-3xl text-[13.5px] text-[var(--color-ink-muted)]">{lead}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Kpi({ label, value, delta, sub }: { label: string; value: string; delta?: number | null; sub?: string }) {
  return (
    <div className="rounded-[14px] bg-[var(--color-indigo-ink,#00003b)] p-4 text-white">
      <p className="text-[24px] font-bold leading-tight tabular-nums">{value}</p>
      <p className="mt-0.5 text-[12px] text-white/75">{label}</p>
      {typeof delta === "number" ? (
        <p className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${delta > 0.5 ? "bg-[#e6f6ec] text-[#12703c]" : "bg-white/15 text-white"}`}>
          {delta > 0.5 ? "▲" : delta < -0.5 ? "▼" : "•"} {pct(delta)} t.o.v. vorig kwartaal
        </p>
      ) : sub ? <p className="mt-2 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/75">{sub}</p> : null}
    </div>
  );
}

function Bars({ title, labels, values, fmt = nf }: { title: string; labels: string[]; values: Array<number | null>; fmt?: (v: number) => string }) {
  const max = Math.max(...values.map((v) => Math.abs(v ?? 0)), 1);
  const top = Math.max(...values.map((v) => v ?? -Infinity));
  const leeg = values.every((v) => v === null);
  return (
    <div className="rounded-[14px] border border-[var(--color-line)] p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">{title}</p>
      {leeg ? <p className="mt-3 text-[13px] text-[var(--color-ink-faint)]">Niet gemeten in dit kwartaal.</p> : (
        <>
          <div className="mt-3 flex h-28 items-end gap-3 border-b border-[var(--color-line)]">
            {values.map((v, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end">
                <span className="mb-1 text-[11px] font-semibold tabular-nums text-[var(--color-ink-muted)]">{v === null ? "–" : fmt(v)}</span>
                <div className="w-full rounded-t-md" style={{ height: `${v === null ? 2 : Math.max(5, Math.round((Math.abs(v) / max) * 100))}%`, background: v !== null && v === top ? "var(--color-indigo-ink,#00003b)" : "#b9bbd6" }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-3">{labels.map((l) => <span key={l} className="flex-1 text-center text-[11px] capitalize text-[var(--color-ink-faint)]">{l}</span>)}</div>
        </>
      )}
    </div>
  );
}

function List({ items, tone = "good" }: { items: string[]; tone?: "good" | "neutral" }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2.5 text-[14px] text-[var(--color-ink)]">
          <span className={`mt-[7px] size-1.5 shrink-0 rounded-full ${tone === "good" ? "bg-[#12a150]" : "bg-[var(--color-indigo-ink,#00003b)]"}`} /> {x}
        </li>
      ))}
    </ul>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)] first:mt-0">{children}</h3>;
}

function Learn({ title, items }: { title: string; items: Inzicht[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-[14px] border border-[var(--color-line)] p-4">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">{title}</p>
      <ul className="mt-2 flex flex-col gap-2.5">
        {items.map((i, n) => (
          <li key={n} className="text-[14px]">
            <span className="font-semibold text-[var(--color-ink)]">{i.punt}</span><Zeker z={i.zekerheid} />
            {i.onderbouwing ? <span className="block text-[13px] text-[var(--color-ink-muted)]">{i.onderbouwing}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function KpiGrid({ m }: { m: KlantMetrics }) {
  const t = m.totaal;
  const p = m.vorig?.vergelijkbaar ? m.vorig.pct : null;
  const d = (k: keyof NonNullable<typeof p>) => (p ? p[k] ?? null : undefined);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Gepubliceerde video's" value={nf(t.videos)} delta={d("videos")} />
        <Kpi label="Weergaven" value={nf(t.views)} delta={d("views")} />
        <Kpi label="Bereik (opgeteld per kanaal)" value={nf(t.reach)} delta={d("reach")} />
        <Kpi label="Interacties" value={nf(t.engagements)} delta={d("engagements")} />
        <Kpi label="Weergaven per video" value={nf(t.gemViewsPerVideo)} delta={d("gemViewsPerVideo")} sub="Gemiddelde" />
        <Kpi label="Groei in volgers" value={signed(t.followerGrowth)} delta={d("followerGrowth")} />
        {t.engagementPct !== null ? <Kpi label="Interacties per 100 weergaven" value={t.engagementPct.toLocaleString("nl-NL")} sub="Gemiddelde" /> : null}
        {m.kijktijd.gemSec !== null ? <Kpi label="Gemiddelde kijktijd" value={`${m.kijktijd.gemSec} sec`} sub={`${m.kijktijd.videosMetMeting} video's gemeten`} /> : null}
        {m.kijktijd.uitkijkPct !== null ? <Kpi label="Uitkijkpercentage" value={`${m.kijktijd.uitkijkPct.toLocaleString("nl-NL")}%`} sub="Gemiddelde" /> : null}
        {m.profielbezoeken !== null ? <Kpi label="Profielbezoeken" value={nf(m.profielbezoeken)} sub="Totaal" /> : null}
        {m.websiteKlikken !== null ? <Kpi label="Websiteklikken" value={nf(m.websiteKlikken)} sub="Totaal" /> : null}
        {m.conversies !== null ? <Kpi label="Conversies" value={nf(m.conversies)} sub="Totaal" /> : null}
      </div>
      {m.vorig && !m.vorig.vergelijkbaar ? <p className="mt-3 text-[12.5px] text-[var(--color-ink-faint)]">Een vergelijking met {m.vorig.label} is niet opgenomen, omdat de twee periodes niet eerlijk te vergelijken zijn.</p> : null}
      {!m.vorig ? <p className="mt-3 text-[12.5px] text-[var(--color-ink-faint)]">Dit is het eerste kwartaal van de samenwerking; er is nog geen eerder kwartaal om mee te vergelijken.</p> : null}
    </>
  );
}

export function KlantReportView({ rapport, card = "sc-card", compact = false }: { rapport: KlantRapport; card?: string; compact?: boolean }) {
  const { klant: k, metrics: m } = rapport;
  const s = k.samenvatting;
  const labels = m.segmenten.map((x) => x.label);
  const seg = <T,>(f: (x: KlantMetrics["segmenten"][number]) => T | null) => m.segmenten.map((x) => (x.dagen > 0 && x.meetdagen > 0 ? f(x) : null));
  const byKey = new Map(m.topVideos.map((v) => [v.key, v]));
  const g = m.geleverd;
  const heeftGeleerd = [k.geleerd.onderwerpen, k.geleerd.hooks, k.geleerd.formats, k.geleerd.lengtes, k.geleerd.presentatoren, k.geleerd.doelgroep, k.geleerd.vaker, k.geleerd.minder].some((l) => l.length > 0);
  const platforms = m.platforms.filter((x) => x.views > 0 || x.publicaties > 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Directieoverzicht: in twee minuten te lezen. */}
      <section id="directie" className="scroll-mt-24 rounded-[18px] bg-[var(--color-indigo-ink,#00003b)] p-5 text-white sm:p-7">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Directieoverzicht · {rapport.periodLabel}</p>
        <h2 className="mt-1 text-[22px] font-bold tracking-tight">{rapport.clientName}</h2>
        <p className="text-[12.5px] text-white/60">{kortDatum(rapport.periodStart)} t/m {langDatum(rapport.periodEnd)}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {([["Wat hebben we bereikt?", k.directie.bereikt], ["Wat heeft het opgeleverd?", k.directie.opgeleverd], ["Wat hebben we geleerd?", k.directie.geleerd], ["Wat doen we volgend kwartaal?", k.directie.volgend]] as const).map(([h, t]) => (
            <div key={h} className="rounded-[14px] bg-white/10 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{h}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed">{t || "–"}</p>
            </div>
          ))}
        </div>
      </section>

      <Section id="samenvatting" card={card} kicker="A" title="Managementsamenvatting" lead="Het kwartaal in één minuut.">
        <p className="text-[15px] leading-relaxed text-[var(--color-ink)]">{s.kern}</p>
        {s.resultaten.length ? <><Sub>Belangrijkste resultaten</Sub><List items={s.resultaten} /></> : null}
        {s.positief ? <><Sub>Grootste positieve ontwikkeling</Sub><p className="rounded-[12px] border-l-4 border-[#12a150] bg-[#e6f6ec] px-4 py-3 text-[14px] text-[#0f3d24]">{s.positief}</p></> : null}
        {s.inzichten.length ? <><Sub>Belangrijkste inzichten uit de content</Sub><List items={s.inzichten} tone="neutral" /></> : null}
        {s.tegenvallers.length ? (
          <><Sub>Wat tegenviel en waarom</Sub>
            <div className="flex flex-col gap-2">
              {s.tegenvallers.map((t, i) => (
                <div key={i} className="rounded-[12px] border-l-4 border-[var(--color-indigo-ink,#00003b)] bg-[var(--color-surface-sunken)] px-4 py-3 text-[14px]">
                  <span className="font-semibold text-[var(--color-ink)]">{t.wat}</span>
                  {t.oorzaak ? <span className="mt-0.5 block text-[var(--color-ink-muted)]">{t.oorzaak}<Zeker z={t.zekerheid} /></span> : null}
                </div>
              ))}
            </div></>
        ) : null}
        {s.verbeterd.length ? <><Sub>Wat Shortclips heeft verbeterd</Sub><List items={s.verbeterd} /></> : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {s.kans ? <div className="rounded-[14px] border border-[var(--color-line)] p-4"><p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Belangrijkste kans volgend kwartaal</p><p className="mt-1.5 text-[14px]">{s.kans}</p></div> : null}
          {s.advies ? <div className="rounded-[14px] border border-[var(--color-line)] p-4"><p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Ons advies voor de komende drie maanden</p><p className="mt-1.5 text-[14px]">{s.advies}</p></div> : null}
        </div>
      </Section>

      <Section id="kpi" card={card} kicker="B" title="Belangrijkste resultaten" lead={`Resultaten over ${kortDatum(rapport.periodStart)} t/m ${langDatum(rapport.periodEnd)}. Totalen, gemiddelden en groeipercentages staan apart vermeld.`}>
        <KpiGrid m={m} />
        {platforms.length ? (
          <><Sub>Per kanaal</Sub>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13.5px]">
                <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-[var(--color-ink-faint)]"><th className="py-1.5 font-semibold">Kanaal</th><th className="py-1.5 text-right font-semibold">Weergaven</th><th className="py-1.5 text-right font-semibold">Bereik</th><th className="py-1.5 text-right font-semibold">Interacties</th><th className="py-1.5 text-right font-semibold">Volgers</th><th className="py-1.5 text-right font-semibold">Plaatsingen</th></tr></thead>
                <tbody>
                  {platforms.map((x) => (
                    <tr key={x.platform} className="border-t border-[var(--color-line)]">
                      <td className="py-2 font-medium">{plat(x.platform)}</td>
                      <td className="py-2 text-right tabular-nums">{nf(x.views)}</td>
                      <td className="py-2 text-right tabular-nums">{x.meetdagen ? nf(x.reach) : "–"}</td>
                      <td className="py-2 text-right tabular-nums">{x.meetdagen ? nf(x.engagements) : "–"}</td>
                      <td className="py-2 text-right tabular-nums">{x.meetdagen ? signed(x.followerGrowth) : "–"}</td>
                      <td className="py-2 text-right tabular-nums">{nf(x.publicaties)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {platforms.filter((x) => x.platform !== "totaal").length > 1 ? <p className="mt-2 text-[12.5px] text-[var(--color-ink-faint)]">Bereik is per kanaal opgeteld. Iemand die via twee kanalen is bereikt, telt twee keer mee.</p> : null}</>
        ) : null}
      </Section>

      <Section id="opgeleverd" card={card} kicker="C" title="Wat heeft Shortclips opgeleverd?" lead="Wat jullie de afgelopen drie maanden concreet hebben gekregen.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi label="Opnamesessies" value={nf(g.opnamedagen)} />
          {g.pipelineBijgehouden ? <Kpi label="Video's geproduceerd" value={nf(g.geproduceerd)} /> : null}
          <Kpi label="Video's gepubliceerd" value={nf(g.gepubliceerd)} />
          <Kpi label="Concepten en scripts" value={nf(g.concepten)} />
          <Kpi label="Plaatsingen op de kanalen" value={nf(g.plaatsingen)} />
          {m.pakket.verwachtInKwartaal !== null ? <Kpi label="Afgesproken voor dit kwartaal" value={nf(m.pakket.verwachtInKwartaal)} /> : null}
        </div>
        {k.opgeleverd.tekst ? <><Sub>Shortclips als jullie contentafdeling</Sub><p className="text-[14px] leading-relaxed">{k.opgeleverd.tekst}</p></> : null}
        {k.opgeleverd.diensten.length ? <div className="mt-3 flex flex-wrap gap-1.5">{k.opgeleverd.diensten.map((d) => <span key={d} className="rounded-full bg-[var(--color-indigo-ink,#00003b)] px-3 py-1 text-[12px] font-medium text-white">{cap(d)}</span>)}</div> : null}
        {m.pakket.bijzonderheden.map((b) => <p key={b} className="mt-3 text-[12.5px] text-[var(--color-ink-muted)]">{b}</p>)}
        {m.doelen.length ? (
          <><Sub>Doelen en realisatie</Sub>
            <table className="w-full text-[13.5px]">
              <thead><tr className="text-left text-[11.5px] uppercase tracking-wide text-[var(--color-ink-faint)]"><th className="py-1.5 font-semibold">Doel</th><th className="py-1.5 text-right font-semibold">Doel</th><th className="py-1.5 text-right font-semibold">Gerealiseerd</th><th className="py-1.5 text-right font-semibold">Behaald</th></tr></thead>
              <tbody>{m.doelen.map((d) => <tr key={d.id} className="border-t border-[var(--color-line)]"><td className="py-2">{d.label}</td><td className="py-2 text-right tabular-nums">{nf(d.target)}</td><td className="py-2 text-right tabular-nums">{d.gerealiseerd === null ? "Niet gemeten" : nf(d.gerealiseerd)}</td><td className="py-2 text-right">{d.behaald === null ? "–" : d.behaald ? "Ja" : "Nog niet"}</td></tr>)}</tbody>
            </table></>
        ) : null}
      </Section>

      <Section id="ontwikkeling" card={card} kicker="D" title="Ontwikkeling gedurende het kwartaal" lead="Hoe de resultaten zich over de drie maanden hebben ontwikkeld.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Bars title="Weergaven" labels={labels} values={seg((x) => x.views)} />
          <Bars title="Bereik" labels={labels} values={seg((x) => x.reach)} />
          <Bars title="Interacties per 100 weergaven" labels={labels} values={seg((x) => x.engagementPct)} fmt={(v) => v.toLocaleString("nl-NL")} />
          <Bars title="Groei in volgers" labels={labels} values={seg((x) => x.followerGrowth)} fmt={signed} />
          <Bars title="Weergaven per video" labels={labels} values={seg((x) => x.gemViewsPerVideo)} />
          <Bars title="Gepubliceerde video's" labels={labels} values={m.segmenten.map((x) => (x.dagen > 0 ? x.videos : null))} />
        </div>
        {k.trends.length ? (
          <><Sub>Opvallende trends</Sub>
            <div className="flex flex-col gap-2">
              {k.trends.map((t, i) => (
                <div key={i} className="flex gap-3 rounded-[14px] border border-[var(--color-line)] p-4">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-indigo-ink,#00003b)] text-[12px] font-bold text-white">{i + 1}</span>
                  <div className="text-[14px]">
                    <p className="font-semibold text-[var(--color-ink)]">{t.titel}</p>
                    <p>{t.beschrijving}</p>
                    {t.verklaring ? <p className="mt-0.5 text-[var(--color-ink-muted)]">{t.verklaring}<Zeker z={t.zekerheid} /></p> : null}
                  </div>
                </div>
              ))}
            </div></>
        ) : null}
      </Section>

      <Section id="content" card={card} kicker="E" title="Best presterende content" lead="Gekozen op weergaven, interactie en kijktijd, en op het doel waarvoor de video is gemaakt.">
        {k.topVideos.length === 0 ? <p className="text-[14px] text-[var(--color-ink-muted)]">Voor dit kwartaal zijn geen cijfers per video beschikbaar.</p> : (
          <div className="flex flex-col gap-3">
            {k.topVideos.map((t, i) => {
              const v = byKey.get(t.key);
              if (!v) return null;
              const th = rapport.thumbs[v.id];
              return (
                <div key={t.key} className="flex gap-4 rounded-[14px] border border-[var(--color-line)] p-4">
                  <div className="grid h-[124px] w-[70px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[var(--color-indigo-ink,#00003b)] bg-cover bg-center text-[18px] font-bold text-white" style={th ? { backgroundImage: `url(${th})` } : undefined}>{th ? "" : i + 1}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold leading-snug text-[var(--color-ink)]">{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="hover:underline">{v.titel}</a> : v.titel}</p>
                    <p className="mt-0.5 text-[12.5px] text-[var(--color-ink-faint)]">{v.datum ? langDatum(v.datum) : ""}{v.platforms.length ? ` · ${v.platforms.map(plat).join(", ")}` : ""}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
                      <span className="rounded-full bg-[var(--color-indigo-ink,#00003b)] px-2.5 py-0.5 font-semibold text-white">{nf(v.views)} weergaven</span>
                      <span className="rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-0.5">{nf(v.likes)} likes · {nf(v.reacties)} reacties · {nf(v.shares)} shares · {nf(v.saves)} saves</span>
                      {v.engagementPct !== null ? <span className="rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-0.5">{v.engagementPct.toLocaleString("nl-NL")} interacties per 100 weergaven</span> : null}
                      {v.gemKijktijdSec !== null ? <span className="rounded-full bg-[#e6f6ec] px-2.5 py-0.5 text-[#12703c]">{v.gemKijktijdSec} sec kijktijd</span> : null}
                      {v.uitkijkPct !== null ? <span className="rounded-full bg-[#e6f6ec] px-2.5 py-0.5 text-[#12703c]">{v.uitkijkPct.toLocaleString("nl-NL")}% uitgekeken</span> : null}
                    </div>
                    {t.waarom ? <p className="mt-2.5 text-[13.5px]"><span className="font-semibold">Waarom dit werkte: </span>{t.waarom}<Zeker z={t.zekerheid} /></p> : null}
                    {t.meenemen ? <p className="mt-1 text-[13.5px]"><span className="font-semibold">Dit nemen we mee: </span>{t.meenemen}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {heeftGeleerd && !compact ? (
        <Section id="geleerd" card={card} kicker="F" title="Wat hebben we geleerd?" lead="Inzichten over jullie doelgroep, gebaseerd op de eigen resultaten van dit kwartaal.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Learn title="Onderwerpen die werken" items={k.geleerd.onderwerpen} />
            <Learn title="Openingszinnen die aandacht trekken" items={k.geleerd.hooks} />
            <Learn title="Formats" items={k.geleerd.formats} />
            <Learn title="Videolengte" items={k.geleerd.lengtes} />
            <Learn title="Presentatoren" items={k.geleerd.presentatoren} />
            <Learn title="Vragen en reacties van de doelgroep" items={k.geleerd.doelgroep} />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {k.geleerd.vaker.length ? <div><Sub>Dit maken we vaker</Sub><List items={k.geleerd.vaker} /></div> : null}
            {k.geleerd.minder.length ? <div><Sub>Dit maken we minder vaak</Sub><List items={k.geleerd.minder} tone="neutral" /></div> : null}
          </div>
        </Section>
      ) : null}

      <Section id="impact" card={card} kicker="G" title="Zakelijke impact" lead="Wat aantoonbaar is, wat een indicatie is en wat niet gemeten kan worden.">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><Sub>Direct meetbaar</Sub>{k.impact.direct.length ? <List items={k.impact.direct} /> : <p className="text-[13.5px] text-[var(--color-ink-faint)]">Geen direct meetbare zakelijke resultaten in dit kwartaal.</p>}</div>
          <div><Sub>Indirecte indicatoren</Sub>{k.impact.indirect.length ? <List items={k.impact.indirect} tone="neutral" /> : <p className="text-[13.5px] text-[var(--color-ink-faint)]">–</p>}</div>
          <div><Sub>Kwalitatieve inzichten</Sub>{k.impact.kwalitatief.length ? <List items={k.impact.kwalitatief} tone="neutral" /> : <p className="text-[13.5px] text-[var(--color-ink-faint)]">–</p>}</div>
        </div>
        {k.impact.nietMeetbaar ? <p className="mt-4 rounded-[12px] bg-[var(--color-surface-sunken)] px-4 py-3 text-[13.5px] text-[var(--color-ink-muted)]">{k.impact.nietMeetbaar}</p> : null}
      </Section>

      {k.verbeterpunten.length ? (
        <Section id="verbeterpunten" card={card} kicker="H" title="Verbeterpunten en kansen" lead="Gebaseerd op jullie eigen resultaten, met de actie die Shortclips onderneemt.">
          <div className="flex flex-col gap-3">
            {k.verbeterpunten.map((v, i) => (
              <div key={i} className="rounded-[14px] border border-[var(--color-line)] p-4">
                <p className="text-[15px] font-semibold text-[var(--color-ink)]">{i + 1}. {v.constatering}</p>
                <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-[13.5px] sm:grid-cols-[150px_1fr]">
                  <dt className="text-[var(--color-ink-faint)]">Waarom belangrijk</dt><dd>{v.belang}</dd>
                  <dt className="text-[var(--color-ink-faint)]">Actie van Shortclips</dt><dd>{v.actie}</dd>
                  <dt className="text-[var(--color-ink-faint)]">Verwacht resultaat</dt><dd>{v.verwachtResultaat}</dd>
                  {v.verantwoordelijke ? <><dt className="text-[var(--color-ink-faint)]">Verantwoordelijke</dt><dd>{cap(v.verantwoordelijke)}</dd></> : null}
                </dl>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <Section id="plan" card={card} kicker="I" title="Plan voor het volgende kwartaal" lead="Zo vertalen we de inzichten naar de komende drie maanden.">
        {k.plan.binnenPakket.length ? (
          <><Sub>Binnen jullie huidige pakket</Sub>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {k.plan.binnenPakket.map((a, i) => (
                <div key={i} className="rounded-[14px] bg-[var(--color-indigo-ink,#00003b)] p-4 text-white">
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-white/60">Actie {i + 1}</p>
                  <p className="mt-1 text-[14.5px] font-semibold leading-snug">{a.titel}</p>
                  <p className="mt-1.5 text-[12.5px] text-white/75">{a.toelichting}</p>
                </div>
              ))}
            </div></>
        ) : null}
        {k.plan.aanvullend.length ? (
          <><Sub>Aanvullende voorstellen (buiten het huidige pakket)</Sub>
            <div className="flex flex-col gap-2">
              {k.plan.aanvullend.map((a, i) => (
                <div key={i} className="rounded-[12px] border border-dashed border-[var(--color-line)] px-4 py-3 text-[14px]"><span className="font-semibold">{a.titel}</span><span className="block text-[13px] text-[var(--color-ink-muted)]">{a.toelichting}</span></div>
              ))}
            </div></>
        ) : null}
      </Section>

      <section id="conclusie" className="scroll-mt-24 rounded-[18px] bg-[var(--color-indigo-ink,#00003b)] p-5 text-white sm:p-7">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">J · Conclusie en vervolg</p>
        <p className="mt-2 text-[16px] leading-relaxed">{k.conclusie.kern}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {([["Wat is er bereikt", k.conclusie.bereikt], ["Grootste kansen", k.conclusie.kansen], ["Wat Shortclips verbetert", k.conclusie.verbeteringen]] as const).filter(([, t]) => t).map(([h, t]) => (
            <div key={h} className="rounded-[14px] bg-white/10 p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{h}</p><p className="mt-1.5 text-[13.5px] leading-relaxed">{t}</p></div>
          ))}
        </div>
        {k.conclusie.prioriteiten.length ? (
          <><p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-white/60">Prioriteiten voor de komende drie maanden</p>
            <ol className="mt-2 flex flex-col gap-1.5">{k.conclusie.prioriteiten.map((x, i) => <li key={i} className="flex gap-2.5 text-[14px]"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-white text-[11px] font-bold text-[#00003b]">{i + 1}</span>{x}</li>)}</ol></>
        ) : null}
      </section>

      <p className="text-[12px] text-[var(--color-ink-faint)]">
        Bronnen en meetperiode: {m.bronnen.map((b) => `${b.naam} (${b.periode})`).join("; ")}. Alle cijfers zijn gemeten; er zijn geen geschatte of aangevulde waarden opgenomen.
      </p>
    </div>
  );
}
