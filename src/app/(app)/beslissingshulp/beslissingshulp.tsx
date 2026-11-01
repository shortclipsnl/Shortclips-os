"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowLeft, Camera, ChevronRight, CircleCheck, CircleMinus, Clock, Copy,
  FileSignature, Flag, HeartPulse, KeyRound, ListPlus, Receipt, ScrollText, Scissors, Search,
  Settings2, TrendingUp, Users, Video, Wrench, X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { BESLIS, ROLLEN, type Keuzehulp, type Niveau, type Rol, type Situatie } from "@/lib/beslissingshulp/data";
import { maakIndex, zoek as zoekIn } from "@/lib/beslissingshulp/zoek";

/* ------------------------------------------------------------------ */
/* Basis                                                                */
/* ------------------------------------------------------------------ */

const NAAM = "Jarno";
const S = BESLIS.situaties;
const PER_ID = new Map(S.map((s) => [s.id, s]));

const NIVEAU: Record<Niveau, {
  kort: string; label: string; oordeel: string; icon: typeof CircleCheck;
  solid: string; soft: string; tekst: string; rand: string;
}> = {
  g: { kort: "Groen", label: "Zelf beslissen", oordeel: "Dit beslis je zelf", icon: CircleCheck,
    solid: "bg-[var(--color-good)]", soft: "bg-[var(--color-good-soft)]", tekst: "text-[#1d6b4c]", rand: "border-[#bfe3cf]" },
  o: { kort: "Oranje", label: "Zelf oplossen", oordeel: "Dit los je zelf op", icon: Wrench,
    solid: "bg-[var(--color-warn)]", soft: "bg-[var(--color-warn-soft)]", tekst: "text-[#8a5300]", rand: "border-[#f1d2a8]" },
  r: { kort: "Rood", label: `Naar ${NAAM}`, oordeel: `Dit gaat naar ${NAAM}`, icon: Flag,
    solid: "bg-[var(--color-bad)]", soft: "bg-[var(--color-bad-soft)]", tekst: "text-[#a3271c]", rand: "border-[#f0c3bf]" },
};

const CAT_ICON: Record<string, typeof CircleCheck> = {
  doc: ScrollText, cut: Scissors, cam: Camera, clock: Clock, list: ListPlus, alert: AlertTriangle,
  chart: TrendingUp, file: Receipt, key: FileSignature, user: HeartPulse, users: Users, tool: Wrench,
};
const ROL_ICON: Record<Rol, typeof CircleCheck> = { cc: ScrollText, vg: Video, bi: Flag };

type View = { naam: "start" } | { naam: "situatie"; id: string } | { naam: "jarno"; id?: string } | { naam: "grenzen" } | { naam: "beheer" };

/** Tekst tussen [[...]] is een voorstel: alleen gemarkeerd als de eigenaar dat wil zien. */
function Tekst({ t, markeer }: { t: string; markeer: boolean }) {
  const delen = t.split(/(\[\[[^\]]+\]\])/g);
  return (
    <>
      {delen.map((d, i) => {
        const m = d.match(/^\[\[(.+)\]\]$/);
        if (!m) return <Fragment key={i}>{d}</Fragment>;
        return markeer ? (
          <mark key={i} title="Voorstel, nog door Jarno te bevestigen" className="rounded bg-[#fff4c2] px-1 text-[#7a5a00] underline decoration-dashed decoration-[#d8b200] underline-offset-2">{m[1]}</mark>
        ) : <Fragment key={i}>{m[1]}</Fragment>;
      })}
    </>
  );
}
const kaal = (t: string) => t.replace(/\[\[(.+?)\]\]/g, "$1");

const INDEX = maakIndex(S);

async function kopieer(tekst: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(tekst);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = tekst; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

/* ------------------------------------------------------------------ */
/* Hoofdcomponent                                                       */
/* ------------------------------------------------------------------ */

export function Beslissingshulp({ owner, startRol }: { owner: boolean; startRol: Rol }) {
  const [view, setView] = useState<View>({ naam: "start" });
  const [rol, setRol] = useState<Rol>(startRol);
  const [q, setQ] = useState("");
  const [markeer, setMarkeer] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);

  // Hash-routing: terugknop van de browser werkt en een situatie is te delen
  // via een link (bijv. /beslissingshulp#s-extra-script).
  const leesHash = useCallback(() => {
    const h = window.location.hash.replace("#", "");
    if (h.startsWith("s-") && PER_ID.has(h.slice(2))) setView({ naam: "situatie", id: h.slice(2) });
    else if (h === "jarno") setView({ naam: "jarno" });
    else if (h === "grenzen") setView({ naam: "grenzen" });
    else if (h === "beheer" && owner) setView({ naam: "beheer" });
    else setView({ naam: "start" });
  }, [owner]);
  useEffect(() => {
    // Eerste keer via een timer (geen setState direct in het effect).
    const t = window.setTimeout(leesHash, 0);
    window.addEventListener("hashchange", leesHash);
    window.addEventListener("popstate", leesHash);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("hashchange", leesHash);
      window.removeEventListener("popstate", leesHash);
    };
  }, [leesHash]);

  const ga = useCallback((v: View) => {
    const hash = v.naam === "situatie" ? `s-${v.id}` : v.naam === "start" ? "" : v.naam;
    if (window.location.hash.replace("#", "") !== hash) {
      window.history.pushState(null, "", hash ? `#${hash}` : window.location.pathname);
    }
    setView(v);
    window.scrollTo({ top: 0 });
  }, []);

  const toon = useCallback((t: string) => {
    setMelding(t);
    window.setTimeout(() => setMelding(null), 2200);
  }, []);

  const mk = markeer || view.naam === "beheer";

  return (
    <div className="mx-auto max-w-[760px] pb-10">
      {view.naam === "start" && (
        <Start owner={owner} rol={rol} setRol={setRol} q={q} setQ={setQ} ga={ga} />
      )}
      {view.naam === "situatie" && PER_ID.get(view.id) && (
        <Detail key={view.id} s={PER_ID.get(view.id)!} ga={ga} mk={mk} toon={toon} />
      )}
      {view.naam === "jarno" && <Jarno key={view.id ?? "x"} voorId={view.id} ga={ga} mk={mk} toon={toon} />}
      {view.naam === "grenzen" && <Grenzen ga={ga} mk={mk} />}
      {view.naam === "beheer" && owner && <Beheer ga={ga} markeer={markeer} setMarkeer={setMarkeer} />}

      {melding ? (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm text-white shadow-lg">
          {melding}
        </div>
      ) : null}
    </div>
  );
}

type Nav = (v: View) => void;

/* ------------------------------------------------------------------ */
/* Onderdelen                                                           */
/* ------------------------------------------------------------------ */

function Rij({ s, ga, toonNiveau = true }: { s: Situatie; ga: Nav; toonNiveau?: boolean }) {
  const n = NIVEAU[s.niveau];
  return (
    <button
      type="button"
      onClick={() => ga({ naam: "situatie", id: s.id })}
      className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-3 text-left transition-colors hover:border-[var(--color-indigo-ink)]"
    >
      <span className={cn("w-1.5 self-stretch rounded-full", n.solid)} aria-hidden />
      <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-[var(--color-ink)]">{s.titel}</span>
      {toonNiveau ? <span className={cn("shrink-0 text-xs font-semibold", n.tekst)}>{n.label}</span> : null}
      <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
    </button>
  );
}

function Terug({ ga }: { ga: Nav }) {
  return (
    <button type="button" onClick={() => ga({ naam: "start" })} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
      <ArrowLeft className="size-4" /> Terug naar Beslissingshulp
    </button>
  );
}

function Kop({ children, rechts }: { children: ReactNode; rechts?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-8 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">{children}</h2>
      {rechts}
    </div>
  );
}

/* ------------------------------ Start ------------------------------ */

function Start({ owner, rol, setRol, q, setQ, ga }: {
  owner: boolean; rol: Rol; setRol: (r: Rol) => void; q: string; setQ: (q: string) => void; ga: Nav;
}) {
  const resultaten = useMemo(() => zoekIn(INDEX, q), [q]);
  const top = BESLIS.top[rol].map((id) => PER_ID.get(id)).filter(Boolean) as Situatie[];
  const R = ROLLEN[rol];

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Beslissingshulp</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Wat speelt er? Zoek het op en je ziet direct wat je moet doen en wat je tegen de klant zegt.</p>

      {/* Gouden regel */}
      <div className="mt-5 flex gap-3 rounded-[var(--radius-md,12px)] bg-[var(--color-indigo-ink)] p-4 text-white">
        <KeyRound className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="text-sm leading-relaxed">
          <strong className="block">Gouden regel</strong>
          <span className="text-white/80">Raakt het geld, het contract of een juridisch risico? Dan gaat het naar {NAAM}. Al het andere los jij zelf op, ook als het niet in deze lijst staat.</span>
        </div>
      </div>

      {/* Kleuren */}
      <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(["g", "o", "r"] as Niveau[]).map((l) => {
          const n = NIVEAU[l];
          const Icon = n.icon;
          const uitleg = l === "g" ? "Beslis zelf" : l === "o" ? "Los op en leg vast in de Hub" : `Naar ${NAAM}`;
          return (
            <div key={l} className={cn("flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2.5", n.soft)}>
              <Icon className={cn("size-5 shrink-0", n.tekst)} aria-hidden />
              <div className="leading-tight">
                <strong className={cn("block text-sm", n.tekst)}>{n.kort}</strong>
                <span className="text-xs text-[var(--color-ink-muted)]">{uitleg}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Zoeken */}
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--color-ink-faint)]" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && resultaten[0]) ga({ naam: "situatie", id: resultaten[0].id });
            if (e.key === "Escape") setQ("");
          }}
          placeholder="Typ wat er speelt, bijvoorbeeld: klant wil extra script"
          aria-label="Zoek een situatie"
          className="w-full rounded-[var(--radius-md,12px)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] py-3.5 pl-12 pr-11 text-base text-[var(--color-ink)] outline-none focus:border-[var(--color-indigo-ink)] focus:ring-4 focus:ring-[var(--color-indigo-ink)]/10"
        />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label="Zoekopdracht wissen" className="absolute right-3 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]">
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {q ? (
        <div className="mt-2.5 grid gap-1.5">
          {resultaten.length ? resultaten.map((s) => <Rij key={s.id} s={s} ga={ga} />) : (
            <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-ink-muted)]">
              <strong className="text-[var(--color-ink)]">Niets gevonden.</strong> Probeer een ander woord. Gaat het over geld, een contract of een juridisch risico? Dan gaat het naar {NAAM}. Al het andere los je zelf op.
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Wie doet wat */}
          <Kop>Wie doet wat?</Kop>
          <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Rol">
            {(["cc", "vg", "bi"] as Rol[]).map((r) => {
              const Icon = ROL_ICON[r];
              const aan = rol === r;
              return (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={aan}
                  onClick={() => setRol(r)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border px-2 py-3 text-xs font-semibold transition-colors sm:flex-row sm:gap-2 sm:text-sm",
                    aan
                      ? r === "bi" ? "border-[var(--color-bad)] bg-[var(--color-bad)] text-white" : "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white"
                      : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-indigo-ink)]",
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden /> {ROLLEN[r].naam}
                </button>
              );
            })}
          </div>
          <div className={cn("sc-card mt-2 border-l-4 p-4", rol === "bi" ? "border-l-[var(--color-bad)]" : "border-l-[var(--color-indigo-ink)]")}>
            <p className="text-[15px] font-medium text-[var(--color-ink)]">{R.uitleg}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <span className={cn("text-2xs font-semibold uppercase tracking-wide", rol === "bi" ? "text-[#a3271c]" : "text-[#1d6b4c]")}>{rol === "bi" ? "Beslist over" : "Beslist zelf over"}</span>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-[var(--color-ink)]">{R.doet.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
              <div>
                <span className={cn("text-2xs font-semibold uppercase tracking-wide", rol === "bi" ? "text-[var(--color-ink-muted)]" : "text-[#a3271c]")}>{rol === "bi" ? "Niet over" : `Niet zelf, dat is voor ${NAAM}`}</span>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-[var(--color-ink)]">{R.nietZelf.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            </div>
          </div>

          <Kop>{rol === "bi" ? `Hier beslist ${NAAM} over` : `Komt vaak voor bij de ${R.naam}`}</Kop>
          <div className="grid gap-1.5 sm:grid-cols-2">{top.map((s) => <Rij key={s.id} s={s} ga={ga} />)}</div>

          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => ga({ naam: "jarno" })} className="flex items-center gap-3 rounded-[var(--radius-md,12px)] bg-[var(--color-indigo-ink)] px-4 py-3.5 text-left text-white hover:opacity-95">
              <Flag className="size-5 shrink-0" />
              <span><strong className="block text-sm">Wanneer naar {NAAM}?</strong><span className="text-xs text-white/75">En wat je dan meeneemt</span></span>
            </button>
            <button type="button" onClick={() => ga({ naam: "grenzen" })} className="flex items-center gap-3 rounded-[var(--radius-md,12px)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3.5 text-left hover:border-[var(--color-indigo-ink)]">
              <KeyRound className="size-5 shrink-0 text-[var(--color-ink)]" />
              <span><strong className="block text-sm text-[var(--color-ink)]">Mijn grenzen</strong><span className="text-xs text-[var(--color-ink-muted)]">Tot waar beslis je zelf</span></span>
            </button>
          </div>

          <Kop>Alle situaties</Kop>
          <div className="grid gap-1.5">
            {BESLIS.categorieen.map((c) => {
              const items = S.filter((s) => s.categorie === c.id).sort((a, b) => "gor".indexOf(a.niveau) - "gor".indexOf(b.niveau));
              if (!items.length) return null;
              const Icon = CAT_ICON[c.icoon] ?? ScrollText;
              return (
                <details key={c.id} className="group sc-card overflow-hidden">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium text-[var(--color-ink)] [&::-webkit-details-marker]:hidden">
                    <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--color-neutral-soft)]"><Icon className="size-4" aria-hidden /></span>
                    <span className="flex-1">{c.naam}</span>
                    <span className="text-xs text-[var(--color-ink-faint)]">{items.length}</span>
                    <ChevronRight className="size-4 text-[var(--color-ink-faint)] transition-transform group-open:rotate-90" aria-hidden />
                  </summary>
                  <div className="grid gap-1.5 px-3 pb-3">{items.map((s) => <Rij key={s.id} s={s} ga={ga} />)}</div>
                </details>
              );
            })}
          </div>

          {owner ? (
            <p className="mt-8 text-center">
              <button type="button" onClick={() => ga({ naam: "beheer" })} className="text-xs text-[var(--color-ink-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]">
                Beheer en openstaande keuzes (alleen zichtbaar voor jou)
              </button>
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

/* ------------------------------ Situatie ------------------------------ */

function eindpunt(boom: Keuzehulp, pad: number[]) {
  let knoop: Keuzehulp = boom;
  for (const i of pad) {
    const o = knoop.opties[i];
    if (!o) return { knoop, uitkomst: null };
    if (o.uitkomst) return { knoop, uitkomst: o.uitkomst };
    if (o.vervolg) knoop = o.vervolg;
  }
  return { knoop, uitkomst: null as null | { niveau: Niveau; tekst: string } };
}

function Detail({ s, ga, mk, toon }: { s: Situatie; ga: Nav; mk: boolean; toon: (t: string) => void }) {
  const [pad, setPad] = useState<number[]>([]);
  const [klaar, setKlaar] = useState<Record<number, boolean>>({});
  const n = NIVEAU[s.niveau];
  const Icon = n.icon;
  const geenEscalatie = /^niet nodig/i.test(s.naarJarno);

  // Antwoorden die al gegeven zijn, met tekst, voor het spoor bovenaan.
  const spoor: { antwoord: string; i: number }[] = [];
  if (s.keuzehulp) {
    let k: Keuzehulp | undefined = s.keuzehulp;
    pad.forEach((idx, i) => { const o = k?.opties[idx]; if (o) { spoor.push({ antwoord: o.antwoord, i }); k = o.vervolg; } });
  }
  const eind = s.keuzehulp ? eindpunt(s.keuzehulp, pad) : null;
  const boomKlaar = !s.keuzehulp || !!eind?.uitkomst;

  const stappen = (
    <ul className="grid gap-1.5">
      {s.stappen.map((st, i) => (
        <li key={i}>
          <button type="button" onClick={() => setKlaar((k) => ({ ...k, [i]: !k[i] }))} className="flex w-full items-start gap-3 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2.5 text-left">
            <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2", klaar[i] ? "border-[var(--color-good)] bg-[var(--color-good)] text-white" : "border-[var(--color-line-strong)] bg-white")}>
              {klaar[i] ? <CircleCheck className="size-3.5" /> : null}
            </span>
            <span className={cn("text-sm leading-relaxed", klaar[i] ? "text-[var(--color-ink-faint)] line-through" : "text-[var(--color-ink)]")}><Tekst t={st} markeer={mk} /></span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <Terug ga={ga} />
      <div className={cn("rounded-[var(--radius-md,12px)] p-5 text-white", n.solid)}>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><Icon className="size-4" /> {n.oordeel}</div>
        <h1 className="mt-2 text-xl font-semibold leading-snug">{s.titel}</h1>
        <p className="mt-1 text-sm text-white/90"><Tekst t={s.waarom} markeer={false} /></p>
        {s.nood ? (
          <div className="mt-3 flex gap-2 rounded-[var(--radius-sm)] bg-white px-3 py-2 text-sm font-medium text-[#a3271c]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Noodprocedure: stop de schade direct en bel daarna meteen {NAAM}.
          </div>
        ) : null}
      </div>

      {s.keuzehulp ? (
        <div className="sc-card mt-3 p-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">Beantwoord de vraag</h3>
          {spoor.length ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {spoor.map((x) => (
                <button key={x.i} type="button" onClick={() => setPad(pad.slice(0, x.i))} title="Wijzig dit antwoord" className="rounded-full bg-[var(--color-neutral-soft)] px-3 py-1 text-xs text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]">
                  <Tekst t={x.antwoord} markeer={mk} /> <span className="text-[var(--color-ink-faint)]">✕</span>
                </button>
              ))}
            </div>
          ) : null}
          {eind?.uitkomst ? (
            <>
              <div className={cn("rounded-[var(--radius-sm)] p-4", NIVEAU[eind.uitkomst.niveau].soft)}>
                <div className={cn("flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide", NIVEAU[eind.uitkomst.niveau].tekst)}>
                  {(() => { const I = NIVEAU[eind.uitkomst.niveau].icon; return <I className="size-4" />; })()}
                  {NIVEAU[eind.uitkomst.niveau].oordeel}
                </div>
                <p className="mt-1.5 text-[15px] text-[var(--color-ink)]"><Tekst t={eind.uitkomst.tekst} markeer={mk} /></p>
              </div>
              <button type="button" onClick={() => setPad([])} className="mt-3 text-xs text-[var(--color-ink-muted)] underline underline-offset-2">Opnieuw beginnen</button>
            </>
          ) : eind ? (
            <>
              <p className="mb-3 text-base font-semibold text-[var(--color-ink)]"><Tekst t={eind.knoop.vraag} markeer={mk} /></p>
              <div className="grid gap-2">
                {eind.knoop.opties.map((o, i) => (
                  <button key={i} type="button" onClick={() => setPad([...pad, i])} className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border-[1.5px] border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-left text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-indigo-ink)]">
                    <span><Tekst t={o.antwoord} markeer={mk} /></span>
                    <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {boomKlaar ? (
        <div className="sc-card mt-3 p-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">Wat doe je?</h3>
          {stappen}
        </div>
      ) : (
        <details className="sc-card mt-3 overflow-hidden">
          <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-medium text-[var(--color-ink-muted)] [&::-webkit-details-marker]:hidden">Liever direct het stappenplan zien?</summary>
          <div className="px-5 pb-5">{stappen}</div>
        </details>
      )}

      {s.klantbericht ? <Klantbericht s={s} toon={toon} /> : null}

      {s.niveau === "r" ? (
        <>
          <div className="mt-3 flex gap-3 rounded-[var(--radius-md,12px)] border border-[#f0c3bf] bg-[var(--color-bad-soft)] p-4">
            <Clock className="mt-0.5 size-5 shrink-0 text-[#a3271c]" />
            <div className="text-sm">
              <strong className="block text-[#a3271c]">Daarna</strong>
              <span className="text-[var(--color-ink)]">{NAAM} reageert binnen <Tekst t={BESLIS.reactietermijn} markeer={mk} />. Geen reactie? Bel {NAAM}. Zeg de klant tot die tijd niets toe over geld of het contract.</span>
            </div>
          </div>
          <button type="button" onClick={() => ga({ naam: "jarno", id: s.id })} className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-bad)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
            <Flag className="size-4" /> Escalatie naar {NAAM} voorbereiden
          </button>
        </>
      ) : (
        <div className={cn("mt-3 flex gap-3 rounded-[var(--radius-md,12px)] border p-4", geenEscalatie ? "border-[#bfe3cf] bg-[var(--color-good-soft)]" : "border-[#f0c3bf] bg-[var(--color-bad-soft)]")}>
          {geenEscalatie ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-[#1d6b4c]" /> : <CircleMinus className="mt-0.5 size-5 shrink-0 text-[#a3271c]" />}
          <div className="text-sm">
            <strong className={cn("block", geenEscalatie ? "text-[#1d6b4c]" : "text-[#a3271c]")}>{geenEscalatie ? "Escaleren is niet nodig" : `Stop en ga naar ${NAAM} als:`}</strong>
            <span className="text-[var(--color-ink)]"><Tekst t={geenEscalatie ? (s.naarJarno.replace(/^niet nodig\.?\s*/i, "") || "Je regelt dit volledig zelf.") : s.naarJarno} markeer={mk} /></span>
          </div>
        </div>
      )}

      <details className="sc-card mt-3 overflow-hidden">
        <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-medium text-[var(--color-ink-muted)] [&::-webkit-details-marker]:hidden">Meer details</summary>
        <dl className="grid gap-3.5 px-5 pb-5 text-sm text-[var(--color-ink)]">
          <Detailregel k="Situatie"><Tekst t={s.situatie} markeer={mk} /></Detailregel>
          <Detailregel k="Eigenaar">{ROLLEN[s.eigenaar].naam}{s.voorbereiding ? `, voorbereiding door ${ROLLEN[s.voorbereiding].naam}` : ""}</Detailregel>
          <Detailregel k="Dit mag je zelf beslissen"><ul className="list-disc pl-4">{s.magZelf.map((m) => <li key={m}><Tekst t={m} markeer={mk} /></li>)}</ul></Detailregel>
          {s.niveau === "r" ? <Detailregel k={`Wanneer naar ${NAAM}`}><Tekst t={s.naarJarno} markeer={mk} /></Detailregel> : null}
          <Detailregel k="Vastleggen in de Hub"><Tekst t={s.vastleggen} markeer={mk} /></Detailregel>
          <Detailregel k="Afgerond als"><Tekst t={s.afgerond} markeer={mk} /></Detailregel>
        </dl>
      </details>
    </>
  );
}

function Detailregel({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">{k}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Klantbericht({ s, toon }: { s: Situatie; toon: (t: string) => void }) {
  const tekst = kaal(s.klantbericht ?? "");
  const delen = tekst.split(/(\[[^\]]+\])/g);
  return (
    <div className="sc-card mt-3 p-5">
      <h3 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">{s.niveau === "r" ? "Stuur de klant eerst dit bericht" : "Wat zeg je tegen de klant?"}</h3>
      <div className="rounded-[14px_14px_14px_4px] bg-[var(--color-surface-sunken)] p-4 text-sm leading-relaxed text-[var(--color-ink)]">
        {delen.map((d, i) => /^\[[^\]]+\]$/.test(d)
          ? <span key={i} className="whitespace-nowrap rounded border border-dashed border-[var(--color-line-strong)] bg-white px-1 text-[var(--color-ink-muted)]">{d}</span>
          : <Fragment key={i}>{d}</Fragment>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={async () => toon((await kopieer(tekst)) ? "Bericht gekopieerd" : "Kopiëren lukt niet, selecteer de tekst handmatig")} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
          <Copy className="size-4" /> Kopieer bericht
        </button>
        <span className="text-xs text-[var(--color-ink-muted)]">Vul de stukjes tussen [ ] in. Pas gerust aan in je eigen woorden.</span>
      </div>
    </div>
  );
}

/* ------------------------------ Wanneer naar Jarno ------------------------------ */

function Jarno({ voorId, ga, mk, toon }: { voorId?: string; ga: Nav; mk: boolean; toon: (t: string) => void }) {
  const rood = S.filter((s) => s.niveau === "r");
  const [sit, setSit] = useState(voorId ?? "");
  const [waarden, setWaarden] = useState<Record<string, string>>(() => {
    const v = voorId ? PER_ID.get(voorId) : undefined;
    const start: Record<string, string> = {};
    if (v) start.wat = `${v.titel}. `;
    return start;
  });
  const [fout, setFout] = useState<string | null>(null);
  const [open, setOpen] = useState(!!voorId);

  useEffect(() => {
    if (voorId) document.getElementById("escalatie")?.scrollIntoView({ behavior: "smooth" });
  }, [voorId]);

  const maak = async () => {
    const leeg = BESLIS.escalatieVelden.filter((f) => !(waarden[f.id] ?? "").trim());
    if (leeg.length) { setFout(`Nog ${leeg.length} veld${leeg.length > 1 ? "en" : ""} leeg. Vul alles in, dan kan ${NAAM} snel beslissen.`); return; }
    setFout(null);
    const tekst = [
      `Escalatie: ${sit && PER_ID.get(sit) ? PER_ID.get(sit)!.titel : "Overig"}`, "",
      ...BESLIS.escalatieVelden.map((f, i) => `${i + 1}. ${f.vraag}\n${waarden[f.id].trim()}`),
    ].join("\n");
    toon((await kopieer(tekst)) ? `Gekopieerd. Plak het in het vaste kanaal naar ${NAAM}.` : "Kopiëren lukt niet, selecteer de tekst handmatig");
  };

  return (
    <>
      <Terug ga={ga} />
      <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Wanneer naar {NAAM}?</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Alleen als het over geld, contracten of grote risico&apos;s gaat. Al het andere los je zelf op.</p>

      <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-[var(--radius-md,12px)] bg-[var(--color-bad-soft)] p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#a3271c]"><Flag className="size-4" /> Naar {NAAM}</h3>
          <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--color-ink)]">
            <li>Klant wil stoppen, verlengen of het contract wijzigen</li>
            <li>Korting, compensatie of iets gratis</li>
            <li>Factuur klopt niet volgens de klant, of andere betaalafspraak</li>
            <li>Extra kosten boven <Tekst t="[[€250]]" markeer={mk} /></li>
            <li>Juridisch, privacy of veiligheid</li>
            <li>Ernstige klacht of klant dreigt te stoppen</li>
          </ul>
        </div>
        <div className="rounded-[var(--radius-md,12px)] bg-[var(--color-good-soft)] p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#1d6b4c]"><CircleCheck className="size-4" /> Zelf oplossen</h3>
          <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--color-ink)]">
            <li>Planning, deadlines en opnames</li>
            <li>Scripts, feedback en revisies</li>
            <li>Editors aansturen en werk verdelen</li>
            <li>Klant ontevreden over een video</li>
            <li>Vragen over status en resultaten</li>
            <li>Factuurkopie of betalingsherinnering</li>
          </ul>
        </div>
      </div>

      <div className="sc-card mt-3 p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-ink)]">Ga nooit met alleen een probleem. Neem dit mee:</h3>
        <ol className="grid gap-1.5">
          {BESLIS.escalatieVelden.map((f, i) => (
            <li key={f.id} className="flex items-center gap-3 text-sm text-[var(--color-ink)]">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-indigo-ink)] text-xs font-semibold text-white">{i + 1}</span>
              {f.vraag}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-3 flex gap-3 rounded-[var(--radius-md,12px)] border border-[#f0c3bf] bg-[var(--color-bad-soft)] p-4">
        <Clock className="mt-0.5 size-5 shrink-0 text-[#a3271c]" />
        <div className="text-sm text-[var(--color-ink)]">
          <strong className="block text-[#a3271c]">Na het escaleren</strong>
          {NAAM} reageert binnen <Tekst t={BESLIS.reactietermijn} markeer={mk} /> met akkoord, niet akkoord of een andere oplossing. Geen reactie? Bel {NAAM}. Tegen de klant zeg je: &quot;Ik kom er uiterlijk [dag] op terug.&quot; Beloof nooit iets over geld of het contract voordat {NAAM} heeft besloten.
        </div>
      </div>

      <details id="escalatie" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="sc-card mt-3 overflow-hidden">
        <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-medium text-[var(--color-ink)] [&::-webkit-details-marker]:hidden">Escalatiebericht invullen en kopiëren</summary>
        <div className="grid gap-3 px-5 pb-5">
          <label className="grid gap-1 text-sm font-semibold text-[var(--color-ink)]">
            Situatie
            <select value={sit} onChange={(e) => setSit(e.target.value)} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-white px-3 py-2 text-sm font-normal">
              <option value="">Kies een situatie</option>
              {rood.map((s) => <option key={s.id} value={s.id}>{s.titel}</option>)}
            </select>
          </label>
          {BESLIS.escalatieVelden.map((f, i) => (
            <label key={f.id} className="grid gap-1 text-sm font-semibold text-[var(--color-ink)]">
              {i + 1}. {f.vraag}
              {f.id === "klant" ? (
                <input value={waarden[f.id] ?? ""} onChange={(e) => setWaarden({ ...waarden, [f.id]: e.target.value })} placeholder={f.placeholder} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-2 text-sm font-normal" />
              ) : (
                <textarea rows={2} value={waarden[f.id] ?? ""} onChange={(e) => setWaarden({ ...waarden, [f.id]: e.target.value })} placeholder={f.placeholder} className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 py-2 text-sm font-normal" />
              )}
            </label>
          ))}
          <div>
            <button type="button" onClick={maak} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
              <Copy className="size-4" /> Kopieer bericht voor {NAAM}
            </button>
            {fout ? <p className="mt-2 text-sm text-[#a3271c]">{fout}</p> : null}
          </div>
        </div>
      </details>
    </>
  );
}

/* ------------------------------ Mijn grenzen ------------------------------ */

function Grenzen({ ga, mk }: { ga: Nav; mk: boolean }) {
  const vg = BESLIS.bevoegdheden.find((b) => b.rol === "vg");
  return (
    <>
      <Terug ga={ga} />
      <h1 className="text-xl font-semibold tracking-tight text-[var(--color-ink)]">Mijn grenzen</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Tot de grens beslis je zelf, zonder iemand te vragen. Daarboven gaat het naar {NAAM}.</p>

      <Kop>Content Creative</Kop>
      <div className="grid gap-2">
        {BESLIS.grenzen.map((g) => (
          <div key={g.onderwerp} className="sc-card grid gap-x-4 gap-y-1 p-4 sm:grid-cols-2">
            <strong className="text-sm text-[var(--color-ink)] sm:col-span-2">{g.onderwerp}</strong>
            <div className="flex gap-2 text-sm text-[var(--color-ink)]"><CircleCheck className="mt-0.5 size-4 shrink-0 text-[var(--color-good)]" /><span><Tekst t={g.zelf} markeer={mk} /></span></div>
            <div className="flex gap-2 text-sm text-[var(--color-ink)]"><Flag className="mt-0.5 size-4 shrink-0 text-[var(--color-bad)]" /><span><Tekst t={g.jarno} markeer={mk} /></span></div>
          </div>
        ))}
      </div>

      {vg ? (
        <>
          <Kop>Videograaf</Kop>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="rounded-[var(--radius-md,12px)] bg-[var(--color-good-soft)] p-4">
              <h3 className="mb-2 text-sm font-semibold text-[#1d6b4c]">Zelf beslissen</h3>
              <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--color-ink)]">{vg.zelf.map((x) => <li key={x}><Tekst t={x} markeer={mk} /></li>)}</ul>
            </div>
            <div className="rounded-[var(--radius-md,12px)] bg-[var(--color-bad-soft)] p-4">
              <h3 className="mb-2 text-sm font-semibold text-[#a3271c]">Niet zelf</h3>
              <ul className="list-disc space-y-1 pl-4 text-sm text-[var(--color-ink)]">{vg.niet.map((x) => <li key={x}><Tekst t={x} markeer={mk} /></li>)}</ul>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

/* ------------------------------ Beheer (alleen eigenaar) ------------------------------ */

function Beheer({ ga, markeer, setMarkeer }: { ga: Nav; markeer: boolean; setMarkeer: (b: boolean) => void }) {
  const aantal = (JSON.stringify(BESLIS).match(/\[\[/g) ?? []).length;
  return (
    <>
      <Terug ga={ga} />
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-[var(--color-ink)]"><Settings2 className="size-5" /> Beheer en openstaande keuzes</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">Alleen voor jou. Het team ziet dit scherm niet.</p>

      <div className="mt-5 rounded-[var(--radius-md,12px)] border border-[#f0dc8a] bg-[#fff4c2] p-4">
        <h3 className="mb-2 text-sm font-semibold text-[#5b4300]">Nog door jou te bevestigen</h3>
        <ul className="list-disc space-y-1 pl-4 text-sm text-[#4a3800]">{BESLIS.openPunten.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>

      <label className="sc-card mt-3 flex cursor-pointer items-center gap-3 p-4 text-sm text-[var(--color-ink)]">
        <input type="checkbox" checked={markeer} onChange={(e) => setMarkeer(e.target.checked)} className="size-4" />
        Toon de {aantal} voorstellen (termijnen, bedragen) ook geel in de rest van de Beslissingshulp
      </label>

      <Kop>Bevoegdheden per rol</Kop>
      <div className="grid gap-2">
        {BESLIS.bevoegdheden.map((b) => (
          <div key={b.rol} className="sc-card p-4 text-sm">
            <strong className="text-[var(--color-ink)]">{ROLLEN[b.rol].naam}</strong>
            <p className="text-xs text-[var(--color-ink-muted)]">{ROLLEN[b.rol].uitleg}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <ul className="list-disc pl-4">{b.zelf.map((x) => <li key={x}><Tekst t={x} markeer /></li>)}</ul>
              {b.niet.length ? <ul className="list-disc pl-4 text-[#a3271c]">{b.niet.map((x) => <li key={x}><Tekst t={x} markeer /></li>)}</ul> : null}
            </div>
          </div>
        ))}
      </div>

      <Kop rechts={<span className="text-xs text-[var(--color-ink-muted)]">{S.length} situaties</span>}>Alle situaties</Kop>
      <div className="sc-card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-[var(--color-line)] text-left text-xs text-[var(--color-ink-muted)]">
            <tr><th className="px-3 py-2 font-semibold">Situatie</th><th className="px-3 py-2 font-semibold">Categorie</th><th className="px-3 py-2 font-semibold">Eigenaar</th><th className="px-3 py-2 font-semibold">Voorstel</th></tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {S.map((s) => (
              <tr key={s.id} onClick={() => ga({ naam: "situatie", id: s.id })} className="cursor-pointer hover:bg-[var(--color-surface-sunken)]">
                <td className="px-3 py-2"><span className={cn("mr-2 inline-block size-2 rounded-full", NIVEAU[s.niveau].solid)} />{s.titel}</td>
                <td className="px-3 py-2 text-[var(--color-ink-muted)]">{BESLIS.categorieen.find((c) => c.id === s.categorie)?.naam}</td>
                <td className="px-3 py-2">{ROLLEN[s.eigenaar].naam}</td>
                <td className="px-3 py-2">{JSON.stringify(s).includes("[[") ? <mark className="rounded bg-[#fff4c2] px-1 text-[#7a5a00]">Ja</mark> : "Nee"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">Regels aanpassen kan in src/lib/beslissingshulp/data.ts. Elke wijziging staat na de volgende deploy direct voor het hele team klaar.</p>
    </>
  );
}
