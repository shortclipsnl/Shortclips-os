import type { CSSProperties } from "react";
import { CheckCircle2, Clock, FlaskConical, Megaphone, MessageSquareQuote, ShieldCheck, Sparkles, TrendingDown, Wand2 } from "lucide-react";
import type { ContentDna, DnaAdvice, DnaAdviceKind, DnaTile } from "@/server/content-memory/dna";
import type { PlayStatus } from "@/server/content-memory/playbook";
import { CopyButton } from "@/components/content-memory/player";

/**
 * Content DNA: compacte strategische samenvatting bovenaan het Contentgeheugen.
 * De verdieping (beste video's, successen, formats, hooks, CTA's) staat eronder.
 */

const STATUS: Record<PlayStatus, { label: string; cls: string }> = {
  bewezen: { label: "Bewezen", cls: "bg-[var(--color-good-soft)] text-[#1d6b4c]" },
  indicatie: { label: "Voorlopig", cls: "bg-[var(--color-warn-soft)] text-[#8a5a00]" },
  onvoldoende: { label: "Te weinig data", cls: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]" },
};

function Pill({ s, label }: { s: PlayStatus; label?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[s].cls}`}>{label ?? STATUS[s].label}</span>;
}

const ICON: Record<DnaTile["key"], typeof Sparkles> = { format: Wand2, hook: MessageSquareQuote, lengte: Clock, cta: Megaphone };
const xf = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;

const RELIABILITY_DOTS: Record<ContentDna["reliability"]["level"], number> = { hoog: 3, gemiddeld: 2, laag: 1, onvoldoende: 0 };

function updatedLabel(iso: string | null): string {
  if (!iso) return "Nog geen cijfers ontvangen";
  const d = new Date(iso);
  return `Cijfers bijgewerkt ${d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "Europe/Amsterdam" })} om ${d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}`;
}

export function ContentDnaView({ dna, clientName }: { dna: ContentDna; clientName: string }) {
  const r = dna.reliability;
  const dots = RELIABILITY_DOTS[r.level];
  const recs = (["behouden", "testen", "verbeteren"] as DnaAdviceKind[]).map((k) => ({ k, a: dna.recommendations[k] }));
  const briefing = [
    `Content DNA ${clientName}`,
    dna.conclusion.text,
    dna.conclusion.advice ?? "",
    ...recs.map(({ a }) => (a ? a.copy : "")),
  ].filter(Boolean).join("\n");

  return (
    <div className="flex flex-col gap-4">
      {/* Betrouwbaarheid en actualiteit */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-[var(--color-ink-muted)]">
        <span className="inline-flex items-center gap-2" title={r.note}>
          <span className="inline-flex gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => <span key={i} className={`h-2.5 w-1.5 rounded-sm ${i < dots ? "bg-[var(--color-indigo-ink)]" : "bg-[var(--color-line-strong)]"}`} />)}
          </span>
          <b className="font-semibold text-[var(--color-ink)]">{r.label}</b>
        </span>
        <span>{r.note}</span>
        <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{updatedLabel(dna.dataUpdatedAt)}</span>
      </div>

      {/* De vier onderdelen */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dna.tiles.map((t) => <DnaTileCard key={t.key} t={t} />)}
      </div>

      {/* Strategische conclusie */}
      <section className="rounded-[18px] bg-[var(--color-indigo-ink)] p-4 text-white shadow-[0_10px_30px_rgba(0,0,59,.18)] sm:p-6" aria-label="Strategische conclusie voor volgende opnames">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-white/12"><ShieldCheck className="size-4" /></span>
            <h3 className="text-[17px] font-semibold tracking-tight">Strategische conclusie voor volgende opnames</h3>
          </div>
          <div className="flex items-center gap-2">
            {dna.conclusion.status === "bewezen"
              ? <span className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-indigo-ink)]">Bewezen</span>
              : <span className="rounded-full border border-dashed border-white/50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white/85">{dna.conclusion.status === "voorlopig" ? "Voorlopig inzicht" : "Te weinig data"}</span>}
            {dna.videoCount ? <span className="[&_button]:border-white/25 [&_button]:bg-white/10 [&_button]:text-white"><CopyButton text={briefing} label="Kopieer voor script" /></span> : null}
          </div>
        </div>
        <p className="mt-3 max-w-[920px] text-[15.5px] leading-relaxed text-white/90">{dna.conclusion.text}</p>
        {dna.conclusion.advice ? (
          <p className="mt-3 max-w-[920px] rounded-[12px] bg-white px-4 py-3 text-[15px] font-semibold leading-snug text-[var(--color-indigo-ink)]">{dna.conclusion.advice}</p>
        ) : null}
      </section>

      {/* Aanbevolen voor de volgende opnames */}
      <section aria-label="Aanbevolen voor de volgende opnames">
        <h3 className="mb-2.5 text-[15px] font-semibold">Aanbevolen voor de volgende opnames</h3>
        <div className="grid gap-3 lg:grid-cols-3">
          {recs.map(({ k, a }, i) => <AdviceCard key={k} kind={k} n={i + 1} a={a} sufficient={dna.videoCount >= 3} />)}
        </div>
      </section>
    </div>
  );
}

function DnaTileCard({ t }: { t: DnaTile }) {
  const Icon = ICON[t.key];
  const proven = t.status === "bewezen";
  return (
    <article className={`relative flex flex-col gap-2 overflow-hidden rounded-[16px] border bg-[var(--color-surface)] p-4 ${proven ? "border-[var(--color-good)]/45 shadow-sm" : "border-[var(--color-line)]"}`}>
      {proven ? <span className="absolute inset-x-0 top-0 h-1 bg-[var(--color-good)]" aria-hidden /> : null}
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)]"><Icon className="size-3.5" />{t.title}</span>
        <Pill s={t.status} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <h4 className={`text-[18px] font-semibold leading-snug ${t.value ? "" : "text-[var(--color-ink-muted)]"}`}>{t.value ?? "Nog geen conclusie"}</h4>
        {t.value && t.perf != null ? (
          <span className="shrink-0 text-right">
            <b className={`block text-[22px] font-bold leading-none tabular-nums ${proven ? "text-[#1d6b4c]" : ""}`}>{xf(t.perf)}</b>
            <span className="text-[10.5px] text-[var(--color-ink-muted)]">normaal</span>
          </span>
        ) : null}
      </div>
      {t.quote ? (
        <div className="flex items-start justify-between gap-2 rounded-[10px] bg-[var(--color-surface-sunken)] px-2.5 py-2">
          <p className="line-clamp-3 text-[12.5px] font-medium leading-snug">&ldquo;{t.quote}&rdquo;</p>
          <CopyButton text={t.quote} />
        </div>
      ) : null}
      <p className="text-[12px] leading-snug text-[var(--color-ink-muted)]">{t.detail}</p>
      {t.platformNote ? <p className="text-[11.5px] font-medium text-[var(--color-ink)]">{t.platformNote}</p> : null}
      {t.key === "cta" && t.basis ? (
        <p className={`mt-auto rounded-[8px] px-2 py-1.5 text-[11px] leading-snug ${t.basis === "conversies" ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]"}`}>
          <b className="font-semibold">{t.basis === "conversies" ? "Conversiedata" : t.basis === "linkklikken" ? "Linkklikken" : "Op basis van engagement"}.</b> {t.basisNote}
        </p>
      ) : null}
    </article>
  );
}

const KIND: Record<DnaAdviceKind, { label: string; color: string; icon: typeof Sparkles; empty: string }> = {
  behouden: { label: "Blijven toepassen", color: "var(--color-good)", icon: CheckCircle2, empty: "Nog geen bewezen aanpak. Dit verschijnt zodra een onderdeel bij minstens vier video's consequent boven normaal scoort." },
  testen: { label: "Verder testen", color: "var(--color-warn)", icon: FlaskConical, empty: "Nog geen kansrijke variatie gevonden. Nieuwe voorstellen volgen na de volgende analyse." },
  verbeteren: { label: "Verbeteren", color: "var(--color-bad)", icon: TrendingDown, empty: "Geen onderdeel dat duidelijk achterblijft bij het normale niveau." },
};

function AdviceCard({ kind, n, a, sufficient }: { kind: DnaAdviceKind; n: number; a: DnaAdvice | null; sufficient: boolean }) {
  const k = KIND[kind];
  const Icon = k.icon;
  const style = { "--k": k.color, borderColor: `color-mix(in srgb, var(--k) 35%, var(--color-line))`, background: `color-mix(in srgb, var(--k) 5%, var(--color-surface))` } as CSSProperties;
  return (
    <article style={style} className="flex flex-col gap-2 rounded-[16px] border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider" style={{ color: "var(--k)" }}>
          <span className="grid size-5 place-items-center rounded-full text-[10.5px] text-white" style={{ background: "var(--k)" }}>{n}</span>
          <Icon className="size-3.5" />{k.label}
        </span>
        {a ? (a.source === "voorstel" ? <Pill s="onvoldoende" label="Nieuw voorstel, nog niet getest" /> : <Pill s={a.status} />) : null}
      </div>
      {a ? (
        <>
          <h4 className="text-[15.5px] font-semibold leading-snug">{a.title}</h4>
          <p className="text-[12.5px] leading-snug text-[var(--color-ink-muted)]">{a.text}</p>
          <div className="mt-auto flex justify-end pt-1"><CopyButton text={a.copy} label="Kopieer voor script" /></div>
        </>
      ) : (
        <p className="text-[12.5px] leading-snug text-[var(--color-ink-muted)]">{sufficient ? k.empty : "Nog te weinig video's met resultaten voor een aanbeveling."}</p>
      )}
    </article>
  );
}
