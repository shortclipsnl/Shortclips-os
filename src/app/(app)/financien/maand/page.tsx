import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Landmark, Receipt, Scale, TrendingUp, Wallet } from "lucide-react";
import { requireFinanceOwner } from "@/server/auth/finance-guard";
import { FinanceUpload } from "@/components/finance/finance-upload";
import { getMaandControle, getMaandReeks, getVermogenZakelijk, prevMonth } from "@/server/bank/maand";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { euro, formatDateFull, formatDateTime } from "@/lib/format";
import { PrintKnop, TransactieTabel } from "./maand-ui";

export const metadata: Metadata = { title: "Maandcontrole" };
export const dynamic = "force-dynamic";

function label(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
}
function vorigeMaandNu() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

const DEKKING: Record<string, { tekst: string; kleur: string }> = {
  compleet: { tekst: "compleet", kleur: "var(--color-good)" },
  voorlopig: { tekst: "voorlopig", kleur: "var(--color-warn)" },
  ontbreekt: { tekst: "ontbreekt", kleur: "var(--color-bad)" },
};
function Badge({ d }: { d: string }) {
  const x = DEKKING[d] ?? DEKKING.ontbreekt!;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold" style={{ color: x.kleur, background: `color-mix(in srgb, ${x.kleur} 14%, transparent)` }}>
      {x.tekst}
    </span>
  );
}

export default async function MaandControlePage({ searchParams }: { searchParams: Promise<{ maand?: string }> }) {
  await requireFinanceOwner();
  const sp = await searchParams;
  const maand = /^\d{4}-\d{2}$/.test(sp.maand ?? "") ? sp.maand! : vorigeMaandNu();
  const volgende = prevMonth(maand, -1);
  const [d, reeks, v] = await Promise.all([getMaandControle(maand), getMaandReeks(12), getVermogenZakelijk()]);
  const verouderd = d.sync.bronnen.filter((b) => b.status !== "actueel");

  return (
    <div className="mx-auto max-w-[1300px] print:max-w-none">
      <PageHeader
        title={`Maandcontrole ${label(maand)}`}
        description="Omzet, kosten, resultaat, cashflow en banksaldo apart van elkaar, met per cijfer de bron en of die de maand volledig dekt."
        actions={<div className="flex gap-2"><FinanceUpload /><PrintKnop /></div>}
      />

      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Link href={`/financien/maand?maand=${prevMonth(maand)}`} className="inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"><ChevronLeft className="size-4" /></Link>
        <span className="min-w-[10rem] text-center text-sm font-semibold capitalize">{label(maand)}</span>
        <Link href={`/financien/maand?maand=${volgende}`} className="inline-flex size-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] hover:bg-[var(--color-surface-sunken)]"><ChevronRight className="size-4" /></Link>
        <Link href="/financien" className="ml-auto text-sm text-[var(--color-ink-muted)] underline-offset-2 hover:underline">Terug naar Financiën</Link>
      </div>

      {/* Versheid van de bronnen: nooit verouderde cijfers presenteren alsof ze actueel zijn. */}
      <Card className="mb-5">
        <CardHeader title="Synchronisatie" subtitle="Laatste succesvolle import per bron. Ouder dan 7 dagen = verouderd." />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {d.sync.bronnen.map((b) => (
            <div key={b.key} className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{b.naam}</span>
                <span className="text-2xs font-semibold" style={{ color: b.status === "actueel" ? "var(--color-good)" : b.status === "verouderd" ? "var(--color-warn)" : "var(--color-bad)" }}>{b.status}</span>
              </div>
              <div className="mt-1 text-xs text-[var(--color-ink-muted)]">
                {b.laatsteSync ? `Laatste import ${formatDateTime(b.laatsteSync)}` : "Nog nooit geïmporteerd"}
                {b.dataTot ? ` · gegevens t/m ${formatDateFull(b.dataTot)}` : ""}
              </div>
            </div>
          ))}
        </div>
        {d.sync.rekeningen.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-xs">
              <thead><tr className="text-left text-[var(--color-ink-faint)]"><th className="py-1 pr-3">Rekening</th><th className="py-1 pr-3">Gegevens t/m</th><th className="py-1 pr-3 text-right">Eindsaldo</th><th className="py-1">Aansluiting</th></tr></thead>
              <tbody>
                {d.sync.rekeningen.map((r) => (
                  <tr key={r.iban} className="border-t border-[var(--color-line)]">
                    <td className="py-1 pr-3">{r.naam || "Knab"} <span className="text-[var(--color-ink-faint)]">{r.iban}</span></td>
                    <td className="py-1 pr-3">{formatDateFull(r.tot)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{r.eindsaldo == null ? "-" : euro(r.eindsaldo)}</td>
                    <td className="py-1" style={{ color: r.controle.startsWith("sluit") ? "var(--color-good)" : "var(--color-bad)" }}>{r.controle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {d.ontbreekt.length || verouderd.length ? (
        <div className="mb-5 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4" /> Ontbrekende of voorlopige gegevens</div>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink-muted)]">
            {d.ontbreekt.map((o) => <li key={o}>{o}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Vijf verschillende cijfers, bewust naast elkaar en niet opgeteld. */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat emphasis label="Omzet (boekhouding)" value={d.omzet.bedrag == null ? "onbekend" : euro(d.omzet.bedrag)} hint={<span>ex btw · <Badge d={d.omzet.dekking} /></span>} tone="good" icon={<TrendingUp />} />
        <Stat emphasis label="Bedrijfskosten" value={euro(d.kosten.ex)} hint={<span>ex btw ({euro(d.kosten.met)} incl.) · <Badge d={d.kosten.dekking} /></span>} tone="warn" icon={<Receipt />} />
        <Stat emphasis label={d.resultaat.definitief ? "Resultaat" : "Resultaat (voorlopig)"} value={d.resultaat.bedrag == null ? "onbekend" : euro(d.resultaat.bedrag)} hint={d.resultaat.marge == null ? "omzet min bedrijfskosten" : `marge ${d.resultaat.marge}% · vóór belasting`} tone={d.resultaat.bedrag != null && d.resultaat.bedrag < 0 ? "bad" : "info"} icon={<Scale />} />
        <Stat emphasis label="Cashflow bank" value={d.bank.dekking === "ontbreekt" ? "geen data" : euro(d.bank.netto)} hint={d.bank.dekking === "ontbreekt" ? <span>geen Knab-transacties · <Badge d="ontbreekt" /></span> : <span>in {euro(d.bank.in)} · uit {euro(d.bank.uit)} · <Badge d={d.bank.dekking} /></span>} tone="info" icon={<Wallet />} />
        <Stat emphasis label="Banksaldo einde maand" value={(() => { const s = d.bank.saldi.filter((x) => x.eindsaldo != null); return s.length ? euro(s.reduce((a, x) => a + (x.eindsaldo ?? 0), 0)) : "onbekend"; })()} hint={`${d.bank.saldi.filter((x) => x.eindsaldo != null).length} van ${d.bank.saldi.length} Knab-rekeningen met data op de laatste dag; geen vermogen, zie hieronder`} tone="info" icon={<Landmark />} />
      </div>

      <Card className="mb-6">
        <CardHeader title="Vermogen Shortclips (stand nu)" subtitle="Per post de laatst bekende stand en de bron. Banksaldo is niet hetzelfde als vermogen: gereserveerde potjes, openstaande facturen en rekeningen tellen apart." />
        {v.waarschuwingen.length ? (
          <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm" style={{ color: "var(--color-warn)" }}>{v.waarschuwingen.map((w) => <li key={w}>{w}</li>)}</ul>
        ) : null}
        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-[var(--color-ink-faint)]"><th className="py-1">Rekening</th><th className="py-1">Stand per</th><th className="py-1 text-right">Saldo</th></tr></thead>
            <tbody>
              {v.saldi.map((s) => (
                <tr key={s.id} className="border-t border-[var(--color-line)]">
                  <td className="py-1.5">{s.naam}{s.gereserveerd ? <span className="ml-1 text-2xs text-[var(--color-warn)]">gereserveerd</span> : null}<div className="text-2xs text-[var(--color-ink-faint)]">{s.bron}</div></td>
                  <td className="py-1.5 text-xs">{formatDateFull(s.datum)}</td>
                  <td className="py-1.5 text-right tabular-nums">{euro(s.bedrag)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-t border-[var(--color-line)]"><td className="py-1.5">Liquide middelen zakelijk</td><td className="py-1.5 text-right tabular-nums">{euro(v.liquide)}</td></tr>
              <tr className="border-t border-[var(--color-line)]"><td className="py-1.5">waarvan gereserveerd (btw, inkomstenbelasting)</td><td className="py-1.5 text-right tabular-nums">−{euro(v.gereserveerd)}</td></tr>
              <tr className="border-t border-[var(--color-line)] font-semibold"><td className="py-1.5">Niet gereserveerd geld</td><td className="py-1.5 text-right tabular-nums">{euro(v.vrij)}</td></tr>
              <tr className="border-t border-[var(--color-line)]"><td className="py-1.5">Openstaande facturen (debiteuren){v.balansDatum ? <div className="text-2xs text-[var(--color-ink-faint)]">DigiBoox, stand {formatDateFull(v.balansDatum)}</div> : null}</td><td className="py-1.5 text-right tabular-nums">{v.debiteuren == null ? "onbekend" : `+${euro(v.debiteuren)}`}</td></tr>
              <tr className="border-t border-[var(--color-line)]"><td className="py-1.5">Nog te betalen rekeningen (crediteuren)</td><td className="py-1.5 text-right tabular-nums">{v.crediteuren == null ? "onbekend" : `−${euro(v.crediteuren)}`}</td></tr>
              <tr className="border-t border-[var(--color-line)]"><td className="py-1.5">Btw lopend kwartaal (schatting)<div className="text-2xs text-[var(--color-ink-faint)]">21% over omzet vanaf {v.btwKwartaalVanaf} min btw in de kosten</div></td><td className="py-1.5 text-right tabular-nums">{v.btwSchatting == null ? "onbekend" : `−${euro(v.btwSchatting)}`}</td></tr>
              <tr className="border-t border-[var(--color-line)] font-semibold"><td className="py-1.5">Werkkapitaal (indicatie)<div className="text-2xs font-normal text-[var(--color-ink-faint)]">niet gereserveerd geld + openstaande facturen − crediteuren − btw lopend kwartaal; vóór inkomstenbelasting</div></td><td className="py-1.5 text-right tabular-nums">{v.werkkapitaal == null ? "onbekend" : euro(v.werkkapitaal)}</td></tr>
              <tr className="border-t border-[var(--color-line)] text-[var(--color-ink-muted)]"><td className="py-1.5">Btw-positie volgens boekhouding<div className="text-2xs">niet verrekend zolang er vraagposten openstaan</div></td><td className="py-1.5 text-right tabular-nums">{v.btwBoekhouding == null ? "onbekend" : euro(v.btwBoekhouding)}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mb-6 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Kosten per categorie" subtitle={`${d.kosten.bron}. Vast ${euro(d.kosten.vast)} · variabel en eenmalig ${euro(d.kosten.variabel)}.`} />
          <table className="mt-3 w-full text-sm">
            <thead><tr className="text-left text-xs text-[var(--color-ink-faint)]"><th className="py-1">Categorie</th><th className="py-1 text-right">Ex btw</th><th className="py-1 text-right">Gem. 3 mnd</th><th className="py-1 text-right">Verschil</th></tr></thead>
            <tbody>
              {d.categorieen.map((c) => (
                <tr key={c.categorie} className="border-t border-[var(--color-line)]">
                  <td className="py-1.5">{c.categorie}</td>
                  <td className="py-1.5 text-right tabular-nums">{euro(c.ex)}</td>
                  <td className="py-1.5 text-right tabular-nums text-[var(--color-ink-muted)]">{euro(c.gemVorige3)}</td>
                  <td className="py-1.5 text-right tabular-nums" style={{ color: c.verschil > 0 ? "var(--color-bad)" : "var(--color-good)" }}>{c.verschil > 0 ? "+" : ""}{euro(c.verschil)}</td>
                </tr>
              ))}
              {!d.categorieen.length ? <tr><td colSpan={4} className="py-3 text-[var(--color-ink-muted)]">Geen kostenregels voor deze maand.</td></tr> : null}
            </tbody>
          </table>
        </Card>
        <Card>
          <CardHeader title="Kosten per leverancier" subtitle="Bedrijfskosten uit de Kostenmonitor, hoogste eerst." />
          <div className="mt-3 max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {d.leveranciers.map((l) => (
                  <tr key={l.leverancier + l.categorie} className="border-t border-[var(--color-line)]">
                    <td className="py-1.5">{l.leverancier}<div className="text-2xs text-[var(--color-ink-faint)]">{l.categorie} · {l.soort} · {l.n}x</div></td>
                    <td className="py-1.5 text-right tabular-nums">{euro(l.ex)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {d.opvallend.length ? (
        <Card className="mb-6">
          <CardHeader title="Opvallend deze maand" subtitle="Grote uitgaven (vanaf 1.000 euro), nieuwe leveranciers, stijgers en nog niet ingedeelde posten." />
          <ul className="mt-3 space-y-1 text-sm">
            {d.opvallend.map((o, i) => (
              <li key={i} className="flex gap-2"><span className="w-20 shrink-0 text-2xs font-semibold uppercase text-[var(--color-ink-faint)]">{o.soort}</span><span>{o.tekst}</span></li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader title={`Banktransacties (${d.bank.aantal})`} subtitle="Elke boeking van de Knab-rekeningen. Dit is cashflow: een bijschrijving is niet automatisch omzet en een afschrijving niet automatisch kosten." />
        <TransactieTabel transacties={d.transacties} />
      </Card>

      <Card className="mb-6 break-before-page">
        <CardHeader title="Maand voor maand" subtitle="Verdiend (omzet boekhouding), uitgegeven (bedrijfskosten ex btw) en over (resultaat vóór belasting). Bank in en uit zonder overboekingen tussen eigen rekeningen." />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-[var(--color-ink-faint)]"><th className="py-1">Maand</th><th className="py-1 text-right">Omzet</th><th className="py-1 text-right">Kosten</th><th className="py-1 text-right">Resultaat</th><th className="py-1 text-right">Bank in</th><th className="py-1 text-right">Bank uit</th></tr></thead>
            <tbody>
              {reeks.map((r) => (
                <tr key={r.maand} className={`border-t border-[var(--color-line)] ${r.maand === maand ? "font-semibold" : ""}`}>
                  <td className="py-1.5"><Link className="capitalize hover:underline" href={`/financien/maand?maand=${r.maand}`}>{label(r.maand)}</Link>{r.lopend ? <span className="ml-1 text-2xs text-[var(--color-ink-faint)]">lopend</span> : null}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.omzet == null ? "-" : euro(r.omzet)}</td>
                  <td className="py-1.5 text-right tabular-nums">{euro(r.kosten)}</td>
                  <td className="py-1.5 text-right tabular-nums" style={{ color: r.resultaat == null ? undefined : r.resultaat >= 0 ? "var(--color-good)" : "var(--color-bad)" }}>{r.resultaat == null ? "-" : euro(r.resultaat)}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.bankIn == null ? "-" : euro(r.bankIn)}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.bankUit == null ? "-" : euro(r.bankUit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-2xs text-[var(--color-ink-faint)]">Resultaat is vóór inkomstenbelasting en zonder afschrijvingen of boekhoudkundige correcties; die laat de boekhouding van de accountant zien.</p>
      </Card>
    </div>
  );
}
