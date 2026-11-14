import { ArrowUpRight, Camera, Clock, Lightbulb, MessageSquareQuote, Megaphone, Sparkles, Target, Trophy, Wand2 } from "lucide-react";
import type { ClientMemory } from "@/server/content-memory";
import { EVIDENCE_LABEL } from "@/server/content-memory/analyze";
import { Thumb, nf, pct, plat, xf } from "./shared";

/**
 * Klantversie van het Contentgeheugen. Zelfde inzichten als intern, maar
 * visueel en opbouwend: tegenvallers staan hier niet prominent in.
 * Wordt gebruikt in het klantportaal én als voorbeeld in het interne portaal.
 */
export function ClientMemoryView({ cm }: { cm: ClientMemory }) {
  const m = cm.memory;
  const formats = m.formats.filter((g) => g.n >= 2 && g.medianPerf >= 1).slice(0, 3);
  const ctas = m.ctas.filter((g) => g.label !== "Geen duidelijke CTA" && g.n >= 2 && g.medianPerf >= 1).slice(0, 3);
  const steps = [
    ...cm.ai.ideas.slice(0, 3).map((i) => i.title),
    ...(formats[0] ? [`Vaker inzetten: ${formats[0].label}`] : []),
    ...(m.topHooks[0] ? [`Nieuwe openingen in de stijl van "${m.topHooks[0].hook}"`] : []),
  ].slice(0, 4);
  // Alleen onderdelen met een conclusie; de scriptopbouw is intern werkmateriaal.
  const works = (cm.playbook?.items ?? []).filter((i) => i.key !== "script" && i.value && i.status !== "onvoldoende");

  return (
    <div className="flex flex-col gap-7">
      <section className="overflow-hidden rounded-[20px] bg-[#00003b] p-6 text-white sm:p-8">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Contentgeheugen</div>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight">Wat we over jouw content hebben geleerd</h1>
        <p className="mt-2 max-w-2xl text-[14px] text-white/70">Elke video die we samen maken, maakt de volgende beter. Dit geheugen bouwt zich automatisch op uit de echte resultaten van je video&apos;s.</p>
        <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-xl">
          {[[m.videoCount.toLocaleString("nl-NL"), "video's geanalyseerd"], [nf(m.totalViews), "weergaven"], [nf(m.totalInteractions), "interacties"]].map(([v, l]) => (
            <div key={l} className="rounded-xl bg-white/[0.08] p-3"><div className="text-[22px] font-bold tabular-nums">{v}</div><div className="text-[12px] text-white/65">{l}</div></div>
          ))}
        </div>
      </section>

      {!m.sufficient ? (
        <section className="sc-glass p-6">
          <h2 className="text-[18px] font-bold">Je contentgeheugen wordt opgebouwd</h2>
          <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">Vanaf ongeveer acht gepubliceerde video&apos;s zie je hier de eerste patronen. We trekken bewust geen conclusies uit een paar video&apos;s.</p>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--sc-fill)]"><div className="h-full rounded-full bg-[var(--sc-cta)]" style={{ width: `${Math.min(100, (m.videoCount / 8) * 100)}%` }} /></div>
          <div className="mt-1.5 text-[12px] text-[var(--color-ink-muted)]">{m.videoCount} van 8 video&apos;s</div>
        </section>
      ) : null}

      {works.length ? (
        <section className="sc-glass p-6 sm:p-7">
          <Head icon={Target} label="Wat werkt voor jou" title="Zo ziet jouw best presterende video eruit" />
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Berekend uit de echte resultaten van jouw video&apos;s. We bouwen hier bij elke nieuwe video op voort.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {works.map((i) => {
              const Icon = WORK_ICON[i.key] ?? Sparkles;
              return (
                <div key={i.key} className="flex flex-col gap-2 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]"><Icon className="size-3.5" />{WORK_LABEL[i.key]}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${i.status === "bewezen" ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-warn-soft)] text-[#8a5a00]"}`}>{i.status === "bewezen" ? "Bewezen" : "Veelbelovend"}</span>
                  </div>
                  <div className="text-[17px] font-bold leading-snug">{i.value}</div>
                  {i.quote ? <div className="text-[13px] italic text-[var(--color-ink-muted)]">“{i.quote}”</div> : null}
                  <div className="mt-auto text-[12.5px] text-[var(--color-ink-muted)]">{i.perf != null ? `${xf(i.perf)} je normale niveau · ` : ""}{i.n} video&apos;s</div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {m.patterns.length ? (
        <section className="sc-glass p-6 sm:p-7">
          <Head icon={Sparkles} label="Sterkste patronen" title="Wat bij jou structureel goed werkt" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {m.patterns.map((p, i) => (
              <div key={i} className="flex gap-3 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4 text-[14px]">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--sc-cta)] text-[12px] font-bold text-[var(--sc-cta-ink)]">{i + 1}</span>
                <span>{p}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {formats.length ? (
        <section className="sc-glass p-6 sm:p-7">
          <Head icon={Wand2} label="Formats" title="Deze soorten video's werken het best" />
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {formats.map((g, i) => {
              const info = cm.ai.formats.find((f) => f.name === g.label);
              const best = g.examples[0];
              return (
                <div key={g.label} className="flex flex-col gap-3 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]">#{i + 1} · {g.n} video&apos;s</div>
                  <div className="text-[17px] font-bold leading-snug">{g.label}</div>
                  <div className="flex gap-4 text-[13px]"><span><b className="text-[18px] tabular-nums">{xf(g.medianPerf)}</b> je normale niveau</span><span><b className="text-[18px] tabular-nums">{Math.round(g.hitRate * 100)}%</b> boven gemiddeld</span></div>
                  {info?.why ? <p className="text-[13px] text-[var(--color-ink-muted)]">{info.why}</p> : null}
                  {best ? <div className="mt-auto flex items-center gap-3"><Thumb v={best} size="sm" /><div className="min-w-0 text-[12.5px]"><div className="line-clamp-2 font-semibold">{best.title}</div><div className="text-[var(--color-ink-muted)]">{nf(best.views)} weergaven · {plat(best.platform)}</div></div></div> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {m.topHooks.length ? (
        <section className="sc-glass p-6 sm:p-7">
          <Head icon={MessageSquareQuote} label="Hooks" title="Openingszinnen die de aandacht pakten" />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {m.topHooks.slice(0, 6).map((v) => (
              <div key={v.id} className="flex gap-3 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-3.5">
                <Thumb v={v} size="sm" />
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold leading-snug">“{v.hook}”</div>
                  <div className="mt-1 text-[12.5px] text-[var(--color-ink-muted)]">{nf(v.views)} weergaven · {plat(v.platform)} · {xf(v.perf)} je normale niveau</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {ctas.length ? (
        <section className="sc-glass p-6 sm:p-7">
          <Head icon={Megaphone} label="Call to actions" title="Afsluiters die werken" />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {ctas.map((g) => {
              const ex = g.examples.find((e) => e.ctaText) ?? g.examples[0];
              return (
                <div key={g.label} className="rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-4">
                  <div className="text-[15px] font-bold">{g.label}</div>
                  <div className="mt-0.5 text-[12.5px] text-[var(--color-ink-muted)]">{g.n} video&apos;s · {xf(g.medianPerf)} je normale niveau</div>
                  {ex?.ctaText ? <div className="mt-3 rounded-lg bg-[var(--color-surface)] p-2.5 text-[13px] italic">“{ex.ctaText}”</div> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {m.topVideos.length ? (
        <section className="sc-glass p-6 sm:p-7">
          <Head icon={Trophy} label="Beste video's" title="Je best presterende video's" />
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Eerlijk vergeleken binnen hetzelfde platform, dus niet alleen op het aantal weergaven.</p>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            {m.topVideos.slice(0, 8).map((v, i) => (
              <div key={v.id} className="flex flex-col gap-2 rounded-[14px] border border-[var(--sc-line)] bg-[var(--sc-fill)] p-3">
                <div className="flex items-start justify-between gap-2"><Thumb v={v} /><span className="rounded-full bg-[var(--sc-cta)] px-2 py-0.5 text-[11px] font-bold text-[var(--sc-cta-ink)]">#{i + 1}</span></div>
                <div className="line-clamp-2 text-[13px] font-semibold leading-snug">{v.title}</div>
                <div className="grid grid-cols-2 gap-1 text-[11.5px] text-[var(--color-ink-muted)]">
                  <span><b className="block text-[14px] text-[var(--color-ink)] tabular-nums">{nf(v.views)}</b>weergaven</span>
                  <span><b className="block text-[14px] text-[var(--color-ink)] tabular-nums">{pct(v.engagementRate)}</b>engagement</span>
                </div>
                {v.externalUrl ? <a href={v.externalUrl} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--sc-accent)]">Bekijk video <ArrowUpRight className="size-3" /></a> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {steps.length && m.sufficient ? (
        <section className="sc-glass p-6 sm:p-7">
          <Head icon={Lightbulb} label="Volgende stap" title="Wat we meenemen naar je volgende video's" />
          <ul className="mt-4 flex flex-col gap-2">
            {steps.map((s, i) => <li key={i} className="flex gap-3 text-[14px]"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--sc-accent)]" />{s}</li>)}
          </ul>
        </section>
      ) : null}

      <p className="text-[12px] text-[var(--color-ink-muted)]">
        Gebaseerd op {m.videoCount} video&apos;s met resultaten{m.measuredFrom ? ` (${new Date(m.measuredFrom).toLocaleDateString("nl-NL", { month: "long", year: "numeric" })} tot nu)` : ""}. &quot;Normaal niveau&quot; is het gemiddelde van je eigen video&apos;s op hetzelfde platform. Een patroon laat zien wat samen opvalt, niet wat de enige oorzaak is. Bewijsniveaus: {Object.values(EVIDENCE_LABEL).join(", ").toLowerCase()}.
      </p>
    </div>
  );
}

const WORK_LABEL: Record<string, string> = { format: "Type video", hook: "Opening", lengte: "Videolengte", filmstijl: "Manier van filmen" };
const WORK_ICON: Record<string, typeof Sparkles> = { format: Wand2, hook: MessageSquareQuote, lengte: Clock, filmstijl: Camera };

function Head({ icon: Icon, label, title }: { icon: typeof Sparkles; label: string; title: string }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-[var(--st-blue-bg)] text-[var(--sc-accent)]"><Icon className="size-4" /></span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sc-accent)]">{label}</span>
      </div>
      <h2 className="mt-2 text-[21px] font-bold tracking-tight">{title}</h2>
    </>
  );
}
