"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Printer, Upload } from "lucide-react";
import { importBankBestanden, type BankUploadResult } from "@/server/actions/bank-import";
import { Button } from "@/components/ui";

const eur = (n: number) => n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

export function PrintKnop() {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="print:hidden">
      <Printer className="size-4" /> Exporteer als PDF
    </Button>
  );
}

/* --- Upload van Knab CAMT.053 --- */
export function BankUpload() {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<BankUploadResult | null>(null);
  const router = useRouter();

  function upload(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    start(async () => {
      const r = await importBankBestanden(fd);
      setRes(r);
      router.refresh();
      if (ref.current) ref.current.value = "";
    });
  }

  return (
    <div className="mt-4 border-t border-[var(--color-line)] pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={ref} type="file" accept=".xml,.csv" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <Button variant="secondary" onClick={() => ref.current?.click()} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Knab-transacties synchroniseren
        </Button>
        <span className="text-xs text-[var(--color-ink-muted)]">
          Knab: Exporteren, formaat CAMT.053 (.xml). Revolut: afschrift als CSV (alleen zakelijke software telt mee). Meerdere bestanden tegelijk mag; dubbele boekingen worden overgeslagen.
        </span>
      </div>
      {res ? (
        <div className="mt-3 space-y-1 text-xs">
          {res.message ? <div className="text-[var(--color-bad)]">{res.message}</div> : null}
          {res.resultaten?.flatMap((r) =>
            r.afschriften.map((a) => (
              <div key={r.bestand + a.iban + a.van}>
                <span className="font-semibold">{a.rekeningNaam || a.iban}</span> {a.van} t/m {a.tot}: {a.nieuw} nieuw, {a.alAanwezig} al aanwezig.{" "}
                <span style={{ color: a.controle.startsWith("sluit") ? "var(--color-good)" : "var(--color-bad)" }}>{a.controle}</span>
              </div>
            )),
          )}
          {res.resultaten?.flatMap((r) => r.kosten.filter((k) => k.regels > 0).map((k) => (
            <div key={r.bestand + k.maand}>Kostenmonitor {k.maand}: {k.regels} regels bijgewerkt uit de transacties.</div>
          )))}
          {res.revolut?.map((r) => <div key={"rev" + r.maand}>Revolut {r.maand}: {r.regels} zakelijke abonnementen, {r.totaal} euro.</div>)}
          {res.fouten?.map((f) => (
            <div key={f.bestand} className="text-[var(--color-bad)]">{f.bestand}: {f.fout}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* --- Transacties met filters --- */
type T = { id: string; datum: string; rekening: string; bedrag: number; tegenpartij: string; omschrijving: string; tegenrekening: string; categorie: string; groep: string; soort: string };

export function TransactieTabel({ transacties }: { transacties: T[] }) {
  const [richting, setRichting] = useState<"alle" | "in" | "uit">("alle");
  const [cat, setCat] = useState("alle");
  const [q, setQ] = useState("");
  const [toonIntern, setToonIntern] = useState(false);
  const cats = useMemo(() => [...new Set(transacties.map((t) => t.categorie))].sort(), [transacties]);
  const lijst = useMemo(() => {
    const s = q.trim().toLowerCase();
    return transacties.filter(
      (t) =>
        (toonIntern || t.groep !== "intern") &&
        (richting === "alle" || (richting === "in" ? t.bedrag > 0 : t.bedrag < 0)) &&
        (cat === "alle" || t.categorie === cat) &&
        (!s || `${t.tegenpartij} ${t.omschrijving} ${t.tegenrekening}`.toLowerCase().includes(s)),
    );
  }, [transacties, richting, cat, q, toonIntern]);
  const som = lijst.reduce((a, t) => a + t.bedrag, 0);

  if (!transacties.length) {
    return <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Nog geen Knab-transacties voor deze maand. Synchroniseer hierboven met een CAMT.053-export.</p>;
  }
  const sel = "rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1 text-sm";
  return (
    <div className="mt-3">
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <select className={sel} value={richting} onChange={(e) => setRichting(e.target.value as never)}>
          <option value="alle">In en uit</option>
          <option value="in">Alleen bijschrijvingen</option>
          <option value="uit">Alleen afschrijvingen</option>
        </select>
        <select className={sel} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="alle">Alle categorieën</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className={`${sel} w-56`} placeholder="Zoek op naam of omschrijving" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)]">
          <input type="checkbox" checked={toonIntern} onChange={(e) => setToonIntern(e.target.checked)} /> interne overboekingen tonen
        </label>
        <span className="ml-auto text-sm tabular-nums">{lijst.length} boekingen · saldo {eur(som)}</span>
      </div>
      <div className="max-h-[640px] overflow-auto print:max-h-none">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 bg-[var(--color-surface)]">
            <tr className="text-left text-xs text-[var(--color-ink-faint)]">
              <th className="py-1 pr-2">Datum</th><th className="py-1 pr-2">Tegenpartij</th><th className="py-1 pr-2">Omschrijving</th><th className="py-1 pr-2">Categorie</th><th className="py-1 text-right">Bedrag</th>
            </tr>
          </thead>
          <tbody>
            {lijst.map((t) => (
              <tr key={t.id} className="border-t border-[var(--color-line)] align-top">
                <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">{t.datum.slice(8, 10)}-{t.datum.slice(5, 7)}</td>
                <td className="py-1.5 pr-2">{t.tegenpartij}<div className="text-2xs text-[var(--color-ink-faint)]">{t.tegenrekening} · {t.rekening.slice(-4)}</div></td>
                <td className="max-w-[340px] py-1.5 pr-2 text-xs text-[var(--color-ink-muted)]">{t.omschrijving}</td>
                <td className="py-1.5 pr-2 text-xs" style={{ color: t.groep === "controle" ? "var(--color-warn)" : undefined }}>{t.categorie}</td>
                <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums" style={{ color: t.bedrag >= 0 ? "var(--color-good)" : undefined }}>{eur(t.bedrag)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
