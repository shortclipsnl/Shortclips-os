"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { compact, euro, num } from "@/lib/format";
import {
  GROUPS,
  ibCalc,
  isBedrijfskost,
  type KostenData,
  MN,
  MNL,
  type Regel,
} from "@/server/kosten/shared";

/* ------------------------------------------------------------------ *
 * Kostenmonitor — functioneel gelijk aan de losse Kostenmonitor, maar in
 * de ShortClips OS-huisstijl. De reken- en weergavelogica is één op één
 * overgenomen; alleen de opmaak volgt de tokens uit globals.css.
 * ------------------------------------------------------------------ */

const HEAT = [
  "rgba(27,95,224,0.08)",
  "rgba(27,95,224,0.24)",
  "rgba(27,95,224,0.46)",
  "rgba(27,95,224,0.70)",
  "rgba(27,95,224,0.95)",
];

const fmtK = (v: number) => (Math.abs(v) >= 1000 ? compact(v) : String(Math.round(v)));

export function KostenDashboard({ data: D }: { data: KostenData }) {
  const months = useMemo(() => Object.keys(D.m).sort(), [D]);

  // Afgesloten maanden: alleen vóór de maand van bijgewerkt. De lopende maand is
  // onvolledig en wordt niet getoond.
  const closed = useMemo(() => {
    const b = D.bijgewerkt ? new Date(D.bijgewerkt) : new Date();
    const k = `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, "0")}`;
    return months.filter((x) => x < k);
  }, [D, months]);

  const lastClosed = closed.at(-1) ?? months.at(-1) ?? "";

  const [mode, setMode] = useState<"ex" | "in">("ex");
  const [sel, setSel] = useState<string>(lastClosed);
  const [topMode, setTopMode] = useState<"m" | "y">("m");
  const [openCats, setOpenCats] = useState<Set<number>>(new Set());

  // Voorkeuren uit localStorage pas ná de eerste render toepassen (geen
  // hydration-mismatch): server en client renderen eerst de standaardwaarden.
  useEffect(() => {
    try {
      const b = localStorage.getItem("km_btw");
      if (b === "in" || b === "ex") setMode(b);
      const m = localStorage.getItem("km_maand");
      if (m && closed.includes(m)) setSel(m);
    } catch {
      /* localStorage kan geblokkeerd zijn — standaardwaarden blijven staan. */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Als de gekozen maand niet (meer) bestaat, val terug op de laatst afgesloten.
  const k = closed.includes(sel) ? sel : lastClosed;

  const pickBtw = (m: "ex" | "in") => {
    setMode(m);
    try {
      localStorage.setItem("km_btw", m);
    } catch {
      /* negeren */
    }
  };
  const pickMonth = (mm: string) => {
    setSel(mm);
    try {
      localStorage.setItem("km_maand", mm);
    } catch {
      /* negeren */
    }
  };

  // ---- Gedeelde helpers over D (bedragvariant volgt de btw-schakelaar) ----
  const v = (e: Regel) => (mode === "ex" ? e[3] : e[2]);
  const rows = (key: string) => D.m[key] ?? [];
  const subOf = (e: Regel) => D.subs[e[1]]!;
  const sumBy = (key: string, f: (e: Regel) => boolean) => rows(key).reduce((a, e) => a + (f(e) ? v(e) : 0), 0);
  const kosten = (key: string) => sumBy(key, (e) => isBedrijfskost(subOf(e)[1]));
  const subRows = (key: string, i: number) => rows(key).filter((e) => e[1] === i);
  const prevMonth = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
  };
  const lastYear = (key: string) => `${+key.slice(0, 4) - 1}${key.slice(4)}`;
  const label = (key: string) => `${MNL[+key.slice(5) - 1]} ${key.slice(0, 4)}`;
  const closedUpTo = (key: string) => closed.filter((x) => x <= key);

  const metaText = `Bron Knab DigiBoox · bijgewerkt ${
    D.bijgewerkt
      ? new Date(D.bijgewerkt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })
      : "onbekend"
  } · ${mode === "ex" ? "bedragen zonder btw" : "bedragen met btw"}`;

  const years = [...new Set(closed.map((x) => x.slice(0, 4)))].reverse();

  return (
    <div className="grid gap-4">
      {/* ----------------------------- Kop ----------------------------- */}
      <header className="rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] p-5 text-white shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Kostenmonitor</h2>
            <p className="mt-0.5 text-xs text-white/60">{metaText}</p>
          </div>
          <div className="inline-flex rounded-full border border-white/15 p-0.5">
            {([
              ["ex", "Zonder btw"],
              ["in", "Met btw"],
            ] as const).map(([mv, lab]) => (
              <button
                key={mv}
                type="button"
                onClick={() => pickBtw(mv)}
                aria-pressed={mode === mv}
                className={
                  mode === mv
                    ? "rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-indigo-ink)]"
                    : "rounded-full px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white"
                }
              >
                {lab}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-1.5">
          {years.map((y) => (
            <div key={y} className="flex flex-wrap items-center gap-1.5">
              <span className="w-9 text-xs font-semibold text-white/50">{y}</span>
              {closed
                .filter((key) => key.startsWith(y))
                .map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pickMonth(key)}
                    aria-pressed={key === k}
                    className={
                      key === k
                        ? "rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--color-indigo-ink)]"
                        : "rounded-full border border-white/15 px-3 py-1 text-xs font-medium text-white/80 hover:border-white/40"
                    }
                  >
                    {MN[+key.slice(5) - 1]}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </header>

      <Kpis {...{ k, kosten, sumBy, subOf, prevMonth, lastYear, closedUpTo, rows, v, label, D }} />

      <OnderDeStreep {...{ k, closed, rows, subOf, v, D }} />

      <JaarVergelijking {...{ k, closed, kosten }} />

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Categorieen {...{ k, prevMonth, closedUpTo, kosten, label, subRows, v, openCats, setOpenCats, D }} />
        <TopLeveranciers {...{ k, topMode, setTopMode, closed, rows, subOf, v, label, D }} />
      </div>

      <Heatmap {...{ k, closedUpTo, subRows, kosten, v, D }} />

      <div className="grid gap-4 lg:grid-cols-2">
        <VasteLasten {...{ k, closedUpTo, rows, subOf, v, D }} />
        <GeenKosten {...{ k, rows, subOf, D }} />
      </div>

      <AlleLeveranciers {...{ k, prevMonth, closed, rows, subOf, v, D }} />

      <section className="grid gap-1.5 text-xs text-[var(--color-ink-muted)]">
        <p>
          <strong className="text-[var(--color-ink)]">Bron.</strong> Alle afschrijvingen van de Knab-rekening
          (NL60KNAB…8372) zoals ze in DigiBoox staan, elke maand op de 1e automatisch uitgelezen. Dezelfde indeling als
          het CEO-dashboard, met meer detail per categorie en leverancier.
        </p>
        <p>
          <strong className="text-[var(--color-ink)]">Met en zonder btw.</strong> Met btw is wat er echt van de rekening
          ging. Zonder btw is per leverancier bepaald: 21% waar de bedragen precies op een bedrag plus 21% uitkomen, 9%
          bij hotels, 0% bij lonen, loonheffing, verzekeringen, bankkosten, buitenlandse diensten en eten en drinken.
        </p>
        <p>
          <strong className="text-[var(--color-ink)]">Wat ontbreekt.</strong> Revolut-uitgaven (vooral software) staan
          niet in DigiBoox; alleen de opwaarderingen naar Revolut zijn zichtbaar, onder Software en tools. Privé-opnames
          en reserveringen staan apart onder Geen kosten.
        </p>
      </section>
    </div>
  );
}

/* ============================ Deelcomponenten ============================ */

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </section>
  );
}

function Delta({ d, had }: { d: number; had: boolean }) {
  if (!had) return null;
  const r = Math.round(d);
  if (r === 0) return <span className="text-[var(--color-ink-faint)]">+0</span>;
  // Meer kosten = rood, minder = groen (zoals in de bron).
  return (
    <span className={r > 0 ? "text-[var(--color-bad)]" : "text-[var(--color-good)]"}>
      {r > 0 ? "+" : "−"}
      {num(Math.abs(r))}
    </span>
  );
}

type Shared = {
  k: string;
  D: KostenData;
  v: (e: Regel) => number;
  rows: (key: string) => Regel[];
  subOf: (e: Regel) => [string, string, string];
};

/* ------------------------------- KPI's ------------------------------- */
type KpiKey = "maand" | "avg" | "vast" | "variabel" | "eenmalig" | "controle";

function Kpis({
  k,
  kosten,
  sumBy,
  subOf,
  prevMonth,
  lastYear,
  closedUpTo,
  rows,
  v,
  label,
  D,
}: {
  k: string;
  kosten: (key: string) => number;
  sumBy: (key: string, f: (e: Regel) => boolean) => number;
  subOf: (e: Regel) => [string, string, string];
  prevMonth: (key: string) => string;
  lastYear: (key: string) => string;
  closedUpTo: (key: string) => string[];
  rows: (key: string) => Regel[];
  v: (e: Regel) => number;
  label: (key: string) => string;
  D: KostenData;
}) {
  // Welke tegel is opengeklikt? Eén tegel tegelijk; nog een keer klikken sluit.
  const [open, setOpen] = useState<KpiKey | null>(null);

  const p = prevMonth(k);
  const ly = lastYear(k);
  const t = kosten(k);
  const soort = (s: string) => sumBy(k, (e) => isBedrijfskost(subOf(e)[1]) && subOf(e)[2] === s);
  const ctrl = sumBy(k, (e) => subOf(e)[1] === "controle");
  const niet = sumBy(k, (e) => ["prive", "belasting"].includes(subOf(e)[1]));
  const ms12 = closedUpTo(k).slice(-12);
  const avg = ms12.length ? ms12.reduce((a, x) => a + kosten(x), 0) / ms12.length : 0;

  const deltaPct = (a: number, b: number) => {
    if (!b) return "";
    return Math.round((a / b - 1) * 100);
  };
  const dP = deltaPct(t, kosten(p));
  const dY = D.m[ly] ? deltaPct(t, kosten(ly)) : "";

  const pctSpan = (pc: number | "") =>
    pc === "" ? null : (
      <span className={pc > 0 ? "text-[var(--color-bad)]" : "text-[var(--color-good)]"}>
        {pc > 0 ? "+" : ""}
        {pc}%
      </span>
    );

  const toggle = (key: KpiKey) => setOpen((o) => (o === key ? null : key));

  // Leveranciers in een bepaalde emmer deze maand, grootste eerst.
  const supList = (pred: (s: [string, string, string]) => boolean) =>
    rows(k)
      .filter((e) => pred(subOf(e)))
      .sort((a, b) => v(b) - v(a));

  const tiles: { key: KpiKey; hero?: boolean; label: string; value: number; hint: React.ReactNode }[] = [
    {
      key: "maand",
      hero: true,
      label: `Kosten ${MNL[+k.slice(5) - 1]}`,
      value: t,
      hint: (
        <>
          {pctSpan(dP)} t.o.v. {MN[+p.slice(5) - 1]}
          {dY !== "" ? (
            <>
              {" · "}
              {pctSpan(dY)} t.o.v. {ly.slice(0, 4)}
            </>
          ) : null}
        </>
      ),
    },
    { key: "avg", label: "Gemiddeld per maand", value: avg, hint: "laatste 12 maanden" },
    { key: "vast", label: "Vast", value: soort("vast"), hint: "lonen, huur, verzekeringen, software" },
    { key: "variabel", label: "Variabel", value: soort("variabel"), hint: "editors, freelancers, marketing, auto" },
    { key: "eenmalig", label: "Eenmalig", value: soort("eenmalig"), hint: "apparatuur en inkopen" },
    { key: "controle", label: "Nog te beoordelen", value: ctrl, hint: <>niet in de kosten · geen kosten {euro(niet)}</> },
  ];

  return (
    <div className="grid gap-2.5">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map((ti) => (
          <Tile
            key={ti.key}
            hero={ti.hero}
            active={open === ti.key}
            label={ti.label}
            value={euro(ti.value)}
            onClick={() => toggle(ti.key)}
          >
            {ti.hint}
          </Tile>
        ))}
      </div>
      {open ? (
        <KpiDetail
          which={open}
          k={k}
          label={label}
          ms12={ms12}
          kosten={kosten}
          supList={supList}
          soort={soort}
          subOf={subOf}
          v={v}
          D={D}
        />
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  children,
  hero = false,
  active = false,
  onClick,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  hero?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`grid content-start gap-0.5 rounded-[var(--radius-md)] border p-3 text-left transition hover:border-[var(--color-brand-400)] ${
        active
          ? "border-[var(--color-brand-600)] ring-1 ring-[var(--color-brand-600)] bg-[var(--color-brand-50)]"
          : hero
            ? "border-transparent bg-[var(--color-brand-50)]"
            : "border-[var(--color-line)] bg-[var(--color-surface)]"
      }`}
    >
      <span className="flex items-center justify-between gap-1 text-2xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
        {label}
        <ChevronRight className={`size-3 shrink-0 transition-transform ${active ? "rotate-90" : ""}`} />
      </span>
      <span className="text-lg font-bold tabular-nums text-[var(--color-ink)]">{value}</span>
      <span className="text-2xs leading-tight text-[var(--color-ink-muted)]">{children}</span>
    </button>
  );
}

/* Detail onder een aangeklikte KPI-tegel: de leveranciers of de maandreeks
   die achter dat bedrag zitten, meteen zichtbaar. */
function KpiDetail({
  which,
  k,
  label,
  ms12,
  kosten,
  supList,
  soort,
  subOf,
  v,
  D,
}: {
  which: KpiKey;
  k: string;
  label: (key: string) => string;
  ms12: string[];
  kosten: (key: string) => number;
  supList: (pred: (s: [string, string, string]) => boolean) => Regel[];
  soort: (s: string) => number;
  subOf: (e: Regel) => [string, string, string];
  v: (e: Regel) => number;
  D: KostenData;
}) {
  // "Gemiddeld per maand" → de 12 maanden achter het gemiddelde, als balkjes.
  if (which === "avg") {
    const mx = Math.max(1, ...ms12.map((m) => kosten(m)));
    return (
      <Card>
        <h4 className="text-sm font-semibold text-[var(--color-ink)]">Gemiddeld per maand — laatste 12 maanden</h4>
        <div className="mt-3 grid gap-1.5">
          {ms12.map((m) => (
            <div key={m} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2.5 text-[13px]">
              <span className="capitalize text-[var(--color-ink-muted)]">{label(m)}</span>
              <span className="h-[7px] rounded-full bg-[var(--color-surface-2)]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(kosten(m) / mx) * 100}%`,
                    background: m === k ? "var(--color-brand-600)" : "var(--color-brand-300)",
                  }}
                />
              </span>
              <span className="text-right tabular-nums text-[var(--color-ink)]">{euro(kosten(m))}</span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const titleMap: Record<Exclude<KpiKey, "avg">, string> = {
    maand: `Alle kosten in ${label(k)}`,
    vast: "Vaste kosten deze maand",
    variabel: "Variabele kosten deze maand",
    eenmalig: "Eenmalige kosten deze maand",
    controle: "Nog te beoordelen deze maand",
  };
  const pred: (s: [string, string, string]) => boolean =
    which === "maand"
      ? (s) => isBedrijfskost(s[1])
      : which === "controle"
        ? (s) => s[1] === "controle"
        : (s) => isBedrijfskost(s[1]) && s[2] === which;
  const list = supList(pred);
  const mx = Math.max(1, ...list.map((e) => v(e)));
  const tot = list.reduce((a, e) => a + v(e), 0);

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--color-ink)]">{titleMap[which as Exclude<KpiKey, "avg">]}</h4>
        <span className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">{euro(tot)}</span>
      </div>
      {which === "maand" ? (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-muted)]">
          <span>Vast {euro(soort("vast"))}</span>
          <span>Variabel {euro(soort("variabel"))}</span>
          <span>Eenmalig {euro(soort("eenmalig"))}</span>
        </div>
      ) : null}
      <div className="mt-3 grid gap-1.5">
        {list.length ? (
          list.slice(0, 18).map((e, j) => {
            const s = subOf(e);
            const color = GROUPS[s[1]]?.color ?? "#98a3b3";
            return (
              <div key={j} className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-0.5 text-[13px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
                  <span className="truncate text-[var(--color-ink)]">{D.lev[e[0]]}</span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{s[0]}</span>
                </span>
                <span className="text-right tabular-nums text-[var(--color-ink)]">{euro(v(e))}</span>
                <span className="col-span-full h-[6px] rounded-full bg-[var(--color-surface-2)]">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(v(e) / mx) * 100}%`, background: color }}
                  />
                </span>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-[var(--color-ink-muted)]">Geen kosten in deze categorie deze maand.</p>
        )}
        {list.length > 18 ? (
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">+ {list.length - 18} meer leveranciers</p>
        ) : null}
      </div>
    </Card>
  );
}

/* --------------------------- Onder de streep --------------------------- */
function OnderDeStreep({
  k,
  closed,
  rows,
  subOf,
  v,
  D,
}: {
  k: string;
  closed: string[];
  rows: (key: string) => Regel[];
  subOf: (e: Regel) => [string, string, string];
  v: (e: Regel) => number;
  D: KostenData;
}) {
  const Y = k.slice(0, 4);
  const om = (m: string) => D.omzet?.[m] ?? 0;
  const koEx = (m: string) => rows(m).reduce((a, e) => a + (isBedrijfskost(subOf(e)[1]) ? e[3] : 0), 0);
  const ms = closed.filter((x) => x.startsWith(Y) && x <= k);
  const all = closed.filter((x) => x.startsWith(Y));
  const l3 = all.slice(-3);
  const rest = 12 - all.length;
  const omY = ms.reduce((a, m) => a + om(m), 0);
  const koY = ms.reduce((a, m) => a + koEx(m), 0);
  const omP = all.reduce((a, m) => a + om(m), 0) + (l3.length ? (rest * l3.reduce((a, m) => a + om(m), 0)) / l3.length : 0);
  const koP = all.reduce((a, m) => a + koEx(m), 0) + (l3.length ? (rest * l3.reduce((a, m) => a + koEx(m), 0)) / l3.length : 0);
  const J = ibCalc(omP - koP);
  const eff = J.eff;
  const col = (o: number, c: number): [number, number, number, number, number] => {
    const w = o - c;
    const tax = Math.max(0, w) * eff;
    return [o, c, w, tax, w - tax];
  };
  const M = col(om(k), koEx(k));
  const YT = col(omY, koY);

  const Row = ({ n, i, strong = false }: { n: string; i: number; strong?: boolean }) => {
    const neg = i === 1 || i === 3;
    return (
      <tr className={strong ? "border-t border-[var(--color-line)] font-semibold" : ""}>
        <td className="py-2 pr-3 text-left">{n}</td>
        <td className="py-2 pl-3 text-right tabular-nums">
          {neg ? "−" : ""}
          {euro(M[i])}
        </td>
        <td className="py-2 pl-3 text-right tabular-nums">
          {neg ? "−" : ""}
          {euro(YT[i])}
        </td>
      </tr>
    );
  };

  return (
    <Card>
      <h3 className="text-base font-semibold text-[var(--color-ink)]">Onder de streep voor Jarno</h3>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        Gefactureerde omzet min kosten, min de verwachte inkomstenbelasting en Zvw. Alles zonder btw, ongeacht de knop
        bovenaan.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
              <th className="py-1.5 text-left font-medium" />
              <th className="py-1.5 pl-3 text-right font-medium">{MNL[+k.slice(5) - 1]}</th>
              <th className="py-1.5 pl-3 text-right font-medium">
                {Y} t/m {MN[+k.slice(5) - 1]}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            <Row n="Omzet (gefactureerd)" i={0} />
            <Row n="Kosten" i={1} />
            <Row n="Winst" i={2} strong />
            <Row n={`Verwachte belasting (${Math.round(eff * 100)}%)`} i={3} />
            <Row n="Netto voor Jarno" i={4} strong />
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
        Belasting geschat met de tarieven van 2026 over de verwachte jaarwinst van {euro(J.W)} (effectief{" "}
        {Math.round(eff * 100)}%, inclusief zelfstandigenaftrek, mkb-winstvrijstelling en heffingskortingen). Per maand
        schommelt dit sterk, omdat facturen soms in één keer worden gemaakt. Niet meegenomen: privé-aftrekposten, al
        betaalde voorlopige aanslagen en een eventuele winstverdeling met een compagnon.
      </p>
    </Card>
  );
}

/* --------------------- Jaarvergelijking per maand --------------------- */
function JaarVergelijking({
  k,
  closed,
  kosten,
}: {
  k: string;
  closed: string[];
  kosten: (key: string) => number;
}) {
  const yCur = k.slice(0, 4);
  const yPrev = String(+yCur - 1);
  const mm = (i: number) => String(i + 1).padStart(2, "0");
  const cur = (i: number) => (closed.includes(`${yCur}-${mm(i)}`) ? kosten(`${yCur}-${mm(i)}`) : null);
  const prev = (i: number) => (closed.includes(`${yPrev}-${mm(i)}`) ? kosten(`${yPrev}-${mm(i)}`) : null);

  const all: number[] = [];
  for (let i = 0; i < 12; i++) {
    const c = cur(i);
    const p = prev(i);
    if (c != null) all.push(c);
    if (p != null) all.push(p);
  }
  // Niets te vergelijken? Dan laten we de grafiek weg (bijv. eerste jaar).
  if (!all.length) return null;

  const max = Math.max(1, ...all);
  const curTot = Array.from({ length: 12 }, (_, i) => cur(i) ?? 0).reduce((a, b) => a + b, 0);
  const prevTot = Array.from({ length: 12 }, (_, i) => prev(i) ?? 0).reduce((a, b) => a + b, 0);
  const H = 128;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--color-ink)]">
          Kosten per maand: {yPrev} vs {yCur}
        </h3>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: "var(--color-brand-300)" }} /> {yPrev} ·{" "}
            {euro(prevTot)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: "var(--color-brand-600)" }} /> {yCur} ·{" "}
            {euro(curTot)}
          </span>
        </div>
      </div>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        Alleen afgesloten maanden. Zo zie je in één oogopslag of de kosten dit jaar hoger of lager liggen dan vorig jaar.
      </p>
      <div className="mt-4 overflow-x-auto">
        <div className="flex min-w-[560px] items-end gap-1.5" style={{ height: `${H}px` }}>
          {Array.from({ length: 12 }).map((_, i) => {
            const c = cur(i);
            const p = prev(i);
            return (
              <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1" style={{ height: `${H}px` }}>
                <div className="flex w-full items-end justify-center gap-0.5" style={{ height: `${H - 18}px` }}>
                  {p != null ? (
                    <span
                      title={`${MN[i]} ${yPrev}: ${euro(p)}`}
                      className="w-1/2 max-w-[16px] rounded-t-[2px]"
                      style={{ height: `${Math.max(2, (p / max) * 100)}%`, background: "var(--color-brand-300)" }}
                    />
                  ) : null}
                  {c != null ? (
                    <span
                      title={`${MN[i]} ${yCur}: ${euro(c)}`}
                      className="w-1/2 max-w-[16px] rounded-t-[2px]"
                      style={{ height: `${Math.max(2, (c / max) * 100)}%`, background: "var(--color-brand-600)" }}
                    />
                  ) : null}
                </div>
                <span className="text-2xs text-[var(--color-ink-faint)]">{MN[i]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* ---------------------------- Categorieën ---------------------------- */
function Categorieen({
  k,
  prevMonth,
  closedUpTo,
  kosten,
  label,
  subRows,
  v,
  openCats,
  setOpenCats,
  D,
}: {
  k: string;
  prevMonth: (key: string) => string;
  closedUpTo: (key: string) => string[];
  kosten: (key: string) => number;
  label: (key: string) => string;
  subRows: (key: string, i: number) => Regel[];
  v: (e: Regel) => number;
  openCats: Set<number>;
  setOpenCats: (s: Set<number>) => void;
  D: KostenData;
}) {
  const p = prevMonth(k);
  const ms12 = closedUpTo(k).slice(-12);
  const tot = kosten(k);
  const subSum = (key: string, i: number) => subRows(key, i).reduce((b, e) => b + v(e), 0);
  const avgOf = (i: number) => (ms12.length ? ms12.reduce((x, m) => x + subSum(m, i), 0) / ms12.length : 0);

  const max = Math.max(
    1,
    ...D.subs.map((s, i) =>
      isBedrijfskost(s[1]) || s[1] === "controle" ? Math.max(subSum(k, i), avgOf(i)) : 0,
    ),
  );

  const toggle = (i: number) => {
    const next = new Set(openCats);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setOpenCats(next);
  };

  // Alle categorieën als één gerangschikte lijst, grootste post bovenaan —
  // beter te scannen dan per groep. Balk = deze maand, streepje = 12-mnd-gemiddelde.
  const items = D.subs
    .map((s, i) => ({ s, i, a: subSum(k, i), av: avgOf(i) }))
    .filter(({ s, a, av }) => (isBedrijfskost(s[1]) || s[1] === "controle") && (a > 0 || av > 0))
    .sort((x, y) => y.a - x.a || y.av - x.av);

  return (
    <Card>
      <h3 className="text-base font-semibold text-[var(--color-ink)]">Waar ging het geld naartoe</h3>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        {label(k)}: {euro(tot)} aan kosten, grootste post bovenaan. Het streepje op elke balk is het gemiddelde van de
        laatste 12 maanden. Klik op een categorie voor de leveranciers.
      </p>
      <div className="mt-3 grid gap-0.5">
        {items.map(({ s, i, a, av }) => {
          const pa = subSum(p, i);
          const color = GROUPS[s[1]]?.color ?? "#98a3b3";
          const open = openCats.has(i);
          const levs = [...subRows(k, i)].sort((x, y) => v(y) - v(x));
          return (
            <div key={i} className="rounded-[var(--radius-sm)]">
              <button
                type="button"
                onClick={() => toggle(i)}
                className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-2.5 gap-y-1 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-left hover:bg-[var(--color-surface-sunken)]"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight
                    className={`size-3 shrink-0 text-[var(--color-ink-faint)] transition-transform ${open ? "rotate-90" : ""}`}
                  />
                  <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
                  <span className="truncate text-sm font-medium text-[var(--color-ink)]">{s[0]}</span>
                  <span className="shrink-0 text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                    {GROUPS[s[1]]?.label ?? s[1]}
                  </span>
                </span>
                <span className="whitespace-nowrap text-right text-sm tabular-nums text-[var(--color-ink)]">{euro(a)}</span>
                <span className="whitespace-nowrap text-right text-xs tabular-nums">
                  <Delta d={a - pa} had={Boolean(pa || a)} />
                </span>
                <span className="col-span-full relative mt-0.5 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(a / max) * 100}%`, background: color }}
                  />
                  <span
                    className="absolute top-[-2px] h-[12px] w-0.5 bg-[var(--color-ink)] opacity-50"
                    style={{ left: `calc(${Math.min(100, (av / max) * 100)}% - 1px)` }}
                    title={`gemiddeld ${euro(av)}`}
                  />
                </span>
              </button>
              {open ? (
                <div className="grid gap-0.5 py-1 pl-6 pr-1.5">
                  {levs.length ? (
                    levs.map((e, j) => (
                      <div key={j} className="grid grid-cols-[1fr_auto_auto] gap-2.5 text-[13px]">
                        <span className="truncate text-[var(--color-ink)]">{D.lev[e[0]]}</span>
                        <span className="text-xs text-[var(--color-ink-muted)]">{e[4]}×</span>
                        <span className="text-right tabular-nums text-[var(--color-ink)]">{euro(v(e))}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-[var(--color-ink-muted)]">Geen betalingen deze maand</div>
                  )}
                  <div className="grid grid-cols-[1fr_auto] gap-2.5 text-[13px]">
                    <span className="text-xs text-[var(--color-ink-muted)]">Gemiddeld per maand (12 mnd)</span>
                    <span className="text-right text-xs tabular-nums text-[var(--color-ink-muted)]">{euro(av)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ------------------------ Grootste leveranciers ------------------------ */
function TopLeveranciers({
  k,
  topMode,
  setTopMode,
  closed,
  rows,
  subOf,
  v,
  label,
  D,
}: {
  k: string;
  topMode: "m" | "y";
  setTopMode: (m: "m" | "y") => void;
  closed: string[];
  rows: (key: string) => Regel[];
  subOf: (e: Regel) => [string, string, string];
  v: (e: Regel) => number;
  label: (key: string) => string;
  D: KostenData;
}) {
  const ms = topMode === "m" ? [k] : closed.filter((x) => x.startsWith(k.slice(0, 4)) && x <= k);
  const agg: Record<string, { a: number; g: string; c: string }> = {};
  for (const m of ms)
    for (const e of rows(m)) {
      const s = subOf(e);
      if (!isBedrijfskost(s[1])) continue;
      const key = D.lev[e[0]]!;
      (agg[key] ??= { a: 0, g: s[1], c: s[0] }).a += v(e);
    }
  const tot = Object.values(agg).reduce((a, x) => a + x.a, 0);
  const top = Object.entries(agg)
    .sort((a, b) => b[1].a - a[1].a)
    .slice(0, 12);
  const max = top[0]?.[1].a || 1;
  const sumTop = top.reduce((a, x) => a + x[1].a, 0);
  const lead =
    topMode === "m"
      ? `${label(k)}. Samen ${tot ? Math.round((sumTop / tot) * 100) : 0}% van de kosten.`
      : `Januari t/m ${MNL[+k.slice(5) - 1]} ${k.slice(0, 4)}. Samen ${tot ? Math.round((sumTop / tot) * 100) : 0}% van de kosten.`;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--color-ink)]">Grootste leveranciers</h3>
        <div className="inline-flex rounded-full border border-[var(--color-line-strong)] p-0.5">
          {([
            ["m", "Deze maand"],
            ["y", "Dit jaar"],
          ] as const).map(([mv, lab]) => (
            <button
              key={mv}
              type="button"
              onClick={() => setTopMode(mv)}
              aria-pressed={topMode === mv}
              className={
                topMode === mv
                  ? "rounded-full bg-[var(--color-brand-50)] px-2.5 py-1 text-xs font-medium text-[var(--color-brand-700)]"
                  : "rounded-full px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              }
            >
              {lab}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{lead}</p>
      <div className="mt-3 grid gap-2">
        {top.map(([n, x]) => (
          <div key={n} className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-0.5 text-[13px]">
            <span className="min-w-0 truncate">
              {n} <span className="text-xs text-[var(--color-ink-muted)]">{x.c}</span>
            </span>
            <span className="text-right tabular-nums text-[var(--color-ink)]">{euro(x.a)}</span>
            <span className="col-span-full h-[7px] rounded-full bg-[var(--color-surface-2)]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(x.a / max) * 100}%`, background: GROUPS[x.g]?.color ?? "#98a3b3" }}
              />
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------ Heatmap ------------------------------ */
function Heatmap({
  k,
  closedUpTo,
  subRows,
  kosten,
  v,
  D,
}: {
  k: string;
  closedUpTo: (key: string) => string[];
  subRows: (key: string, i: number) => Regel[];
  kosten: (key: string) => number;
  v: (e: Regel) => number;
  D: KostenData;
}) {
  const ms = closedUpTo(k).slice(-12);
  const list = D.subs.map((s, i) => [s, i] as const).filter(([s]) => isBedrijfskost(s[1]) || s[1] === "controle");
  const val = (i: number, m: string) => subRows(m, i).reduce((a, e) => a + v(e), 0);
  const tots = ms.map((m) => kosten(m));

  return (
    <Card>
      <h3 className="text-base font-semibold text-[var(--color-ink)]">Kosten per categorie, maand voor maand</h3>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        De laatste twaalf maanden tot en met de gekozen maand. Hoe donkerder het vakje, hoe hoger het bedrag binnen die
        categorie.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
              <th className="sticky left-0 z-[1] bg-[var(--color-surface)] px-2 py-1.5 text-left font-medium">Categorie</th>
              {ms.map((m) => (
                <th
                  key={m}
                  className={`px-2 py-1.5 text-right font-medium ${m === k ? "text-[var(--color-brand-700)]" : ""}`}
                >
                  {MN[+m.slice(5) - 1]} &apos;{m.slice(2, 4)}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right font-medium">Gem.</th>
            </tr>
          </thead>
          <tbody>
            {list.map(([s, i]) => {
              const vals = ms.map((m) => val(i, m));
              if (!vals.some(Boolean)) return null;
              const mx = Math.max(...vals);
              const tot = vals.reduce((a, b) => a + b, 0);
              return (
                <tr key={i} className="border-b border-[var(--color-line)]">
                  <td className="sticky left-0 z-[1] bg-[var(--color-surface)] px-2 py-1.5 text-left">
                    <span
                      className="mr-1.5 inline-block size-2 rounded-[2px] align-middle"
                      style={{ background: GROUPS[s[1]]?.color ?? "#98a3b3" }}
                    />
                    {s[0]}
                  </td>
                  {vals.map((x, j) => {
                    const lv = x ? Math.min(4, Math.ceil((x / mx) * 4)) : -1;
                    return (
                      <td
                        key={j}
                        className={`px-2 py-1.5 text-right ${ms[j] === k ? "outline outline-1 -outline-offset-1 outline-[var(--color-brand-600)]" : ""}`}
                        style={lv >= 0 ? { background: HEAT[lv], color: lv >= 3 ? "#fff" : undefined } : undefined}
                      >
                        {x ? fmtK(x) : "·"}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right font-semibold">{fmtK(tot / ms.length)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-[var(--color-line-strong)] font-semibold">
              <td className="sticky left-0 z-[1] bg-[var(--color-surface)] px-2 py-1.5 text-left">Totale kosten</td>
              {tots.map((x, j) => (
                <td
                  key={j}
                  className={`px-2 py-1.5 text-right ${ms[j] === k ? "outline outline-1 -outline-offset-1 outline-[var(--color-brand-600)]" : ""}`}
                >
                  {fmtK(x)}
                </td>
              ))}
              <td className="px-2 py-1.5 text-right">{fmtK(tots.reduce((a, b) => a + b, 0) / ms.length)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------------------------- Vaste lasten ---------------------------- */
function VasteLasten({
  k,
  closedUpTo,
  rows,
  subOf,
  v,
  D,
}: {
  k: string;
  closedUpTo: (key: string) => string[];
  rows: (key: string) => Regel[];
  subOf: (e: Regel) => [string, string, string];
  v: (e: Regel) => number;
  D: KostenData;
}) {
  const ms = closedUpTo(k).slice(-6);
  const per: Record<string, { c: string; g: string; m: Record<string, number> }> = {};
  for (const m of ms)
    for (const e of rows(m)) {
      const s = subOf(e);
      if (!isBedrijfskost(s[1]) || s[2] !== "vast") continue;
      const n = D.lev[e[0]]!;
      const o = (per[n] ??= { c: s[0], g: s[1], m: {} });
      o.m[m] = (o.m[m] ?? 0) + v(e);
    }
  // Vaste leveranciers als balkgrafiek: grootste bovenaan, streepje = gemiddelde.
  const list = Object.entries(per)
    .filter(([, o]) => Object.keys(o.m).length >= 3)
    .map(([n, o]) => {
      const vals = Object.values(o.m);
      return {
        n,
        c: o.c,
        g: o.g,
        av: vals.reduce((a, b) => a + b, 0) / vals.length,
        now: o.m[k] ?? null,
      };
    })
    .sort((a, b) => (b.now ?? b.av) - (a.now ?? a.av));
  const max = Math.max(1, ...list.map((o) => Math.max(o.now ?? 0, o.av)));

  return (
    <Card>
      <h3 className="text-base font-semibold text-[var(--color-ink)]">Vaste lasten</h3>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        Leveranciers die je bijna elke maand betaalt, grootste bovenaan. De balk is {MNL[+k.slice(5) - 1]}; het streepje
        is het gemiddelde. Rood betekent: verwacht, maar deze maand niet gezien.
      </p>
      <div className="mt-3 grid gap-2">
        {list.length ? (
          list.map((o) => {
            const color = GROUPS[o.g]?.color ?? "#98a3b3";
            const missing = o.now == null;
            return (
              <div key={o.n} className="grid grid-cols-[1fr_auto] items-center gap-x-2.5 gap-y-0.5 text-[13px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
                  <span className="truncate font-medium text-[var(--color-ink)]">{o.n}</span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{o.c}</span>
                </span>
                <span className="whitespace-nowrap text-right tabular-nums">
                  {missing ? (
                    <span className="inline-flex rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-bad)]">
                      niet gezien
                    </span>
                  ) : (
                    <span className="text-[var(--color-ink)]">{euro(o.now!)}</span>
                  )}
                </span>
                <span className="col-span-full relative h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  {!missing ? (
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${(o.now! / max) * 100}%`, background: color }}
                    />
                  ) : null}
                  <span
                    className="absolute top-[-2px] h-[12px] w-0.5 bg-[var(--color-ink)] opacity-50"
                    style={{ left: `calc(${Math.min(100, (o.av / max) * 100)}% - 1px)` }}
                    title={`gemiddeld ${euro(o.av)}`}
                  />
                </span>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen vaste lasten in beeld.</p>
        )}
      </div>
    </Card>
  );
}

/* ----------------------------- Geen kosten ----------------------------- */
function GeenKosten({
  k,
  rows,
  subOf,
  D,
}: {
  k: string;
  rows: (key: string) => Regel[];
  subOf: (e: Regel) => [string, string, string];
  D: KostenData;
}) {
  const r = rows(k)
    .filter((e) => ["prive", "belasting"].includes(subOf(e)[1]))
    .sort((a, b) => b[2] - a[2]);
  const tot = r.reduce((a, e) => a + e[2], 0);

  return (
    <Card>
      <h3 className="text-base font-semibold text-[var(--color-ink)]">Geen kosten</h3>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
        Privé-opnames, reserveringen en btw/IB-betalingen. Die gaan van de rekening af, maar tellen niet als
        bedrijfskosten.
      </p>
      <div className="mt-3 overflow-x-auto">
        {r.length ? (
          <table className="w-full min-w-[360px] text-[13px]">
            <thead>
              <tr className="text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                <th className="py-1.5 text-left font-medium">Naar</th>
                <th className="py-1.5 pl-3 text-left font-medium">Soort</th>
                <th className="py-1.5 pl-3 text-right font-medium">Bedrag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {r.map((e, j) => (
                <tr key={j}>
                  <td className="py-2 pr-2">
                    {D.lev[e[0]]} <span className="text-xs text-[var(--color-ink-muted)]">{e[4]}×</span>
                  </td>
                  <td className="py-2 pl-3 text-left text-[var(--color-ink-muted)]">{subOf(e)[0]}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{euro(e[2])}</td>
                </tr>
              ))}
              <tr className="border-t border-[var(--color-line-strong)] font-semibold">
                <td className="py-2 pr-2">Totaal</td>
                <td />
                <td className="py-2 pl-3 text-right tabular-nums">{euro(tot)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-[var(--color-ink-muted)]">Geen privé-opnames of belastingbetalingen deze maand.</p>
        )}
      </div>
    </Card>
  );
}

/* -------------------------- Alle leveranciers -------------------------- */
function AlleLeveranciers({
  k,
  prevMonth,
  closed,
  rows,
  subOf,
  v,
  D,
}: {
  k: string;
  prevMonth: (key: string) => string;
  closed: string[];
  rows: (key: string) => Regel[];
  subOf: (e: Regel) => [string, string, string];
  v: (e: Regel) => number;
  D: KostenData;
}) {
  const [q, setQ] = useState("");
  const [fcat, setFcat] = useState("");

  const p = prevMonth(k);
  const prevBy = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of rows(p)) map[`${e[0]}_${e[1]}`] = v(e);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, D, v]);
  const seenBefore = useMemo(() => {
    const set = new Set<number>();
    for (const m of closed.filter((x) => x < k)) for (const e of rows(m)) set.add(e[0]);
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, closed, D]);

  const term = q.trim().toLowerCase();
  const r = rows(k)
    .filter((e) => (!fcat || String(e[1]) === fcat) && (!term || D.lev[e[0]]!.toLowerCase().includes(term)))
    .sort((a, b) => v(b) - v(a));
  const totMet = r.reduce((a, e) => a + e[2], 0);
  const totEx = r.reduce((a, e) => a + e[3], 0);

  // Alleen categorieën die in de data voorkomen, voor het filter.
  const catOptions = D.subs.map((s, i) => [i, s[0]] as const);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--color-ink)]">Alle leveranciers deze maand</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1.5">
            <Search className="size-4 text-[var(--color-ink-faint)]" />
            <input
              className="w-40 bg-transparent text-sm outline-none"
              placeholder="Zoek leverancier"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm"
            value={fcat}
            onChange={(e) => setFcat(e.target.value)}
            aria-label="Filter categorie"
          >
            <option value="">Alle categorieën</option>
            {catOptions.map(([i, nm]) => (
              <option key={i} value={i}>
                {nm}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[680px] text-[13px]">
          <thead>
            <tr className="text-2xs uppercase tracking-wide text-[var(--color-ink-faint)]">
              <th className="py-1.5 text-left font-medium">Leverancier</th>
              <th className="py-1.5 pl-3 text-left font-medium">Categorie</th>
              <th className="py-1.5 pl-3 text-right font-medium">Aantal</th>
              <th className="py-1.5 pl-3 text-right font-medium">Met btw</th>
              <th className="py-1.5 pl-3 text-right font-medium">Zonder btw</th>
              <th className="py-1.5 pl-3 text-right font-medium">Vorige maand</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {r.map((e, j) => {
              const s = subOf(e);
              const pv = prevBy[`${e[0]}_${e[1]}`];
              return (
                <tr key={j}>
                  <td className="py-2 pr-2">
                    {D.lev[e[0]]}
                    {seenBefore.has(e[0]) ? null : (
                      <span className="ml-1.5 inline-flex rounded-full bg-[var(--color-info-soft)] px-1.5 py-0.5 text-2xs font-medium text-[var(--color-brand-700)]">
                        nieuw
                      </span>
                    )}
                  </td>
                  <td className="py-2 pl-3 text-left text-[var(--color-ink-muted)]">{s[0]}</td>
                  <td className="py-2 pl-3 text-right tabular-nums text-[var(--color-ink-muted)]">{e[4]}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{euro(e[2])}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{euro(e[3])}</td>
                  <td className="py-2 pl-3 text-right tabular-nums text-[var(--color-ink-muted)]">{pv ? euro(pv) : "-"}</td>
                </tr>
              );
            })}
            <tr className="border-t border-[var(--color-line-strong)] font-semibold">
              <td className="py-2 pr-2">Totaal ({r.length})</td>
              <td />
              <td />
              <td className="py-2 pl-3 text-right tabular-nums">{euro(totMet)}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{euro(totEx)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
