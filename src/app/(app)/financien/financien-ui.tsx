"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { deleteFixedCost, deleteSalesLead, upsertCompanyMonth, upsertFixedCost, upsertSalesLead } from "@/server/actions/management-finance";
import { importDigibooxFinance, type DigibooxImportResult } from "@/server/actions/digiboox-import";
import { Button } from "@/components/ui";

const eur = (n: number) => `€ ${n.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
function monthLabel(p: string) { const [y, m] = p.split("-").map(Number); return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("nl-NL", { month: "short", year: "numeric" }); }
const cell = "w-24 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2 py-1 text-right text-sm tabular-nums";

/* --- Bedrijfsmaand: doel + freelance/personeel/overig per maand --- */
export type CompanyMonth = { period: string; revenueTarget: string; freelanceCost: string; staffCost: string; otherCost: string };

export function CompanyMonthRow({ period, income, directCost, fixedTotal, company }: { period: string; income: number; directCost: number; fixedTotal: number; company?: CompanyMonth }) {
  const [target, setTarget] = useState(company ? String(Number(company.revenueTarget) || "") : "");
  const [freelance, setFreelance] = useState(company ? String(Number(company.freelanceCost) || "") : "");
  const [staff, setStaff] = useState(company ? String(Number(company.staffCost) || "") : "");
  const [other, setOther] = useState(company ? String(Number(company.otherCost) || "") : "");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const totalCost = directCost + (Number(freelance) || 0) + (Number(staff) || 0) + (Number(other) || 0) + fixedTotal;
  const result = income - totalCost;
  const margin = income > 0 ? Math.round((result / income) * 100) : 0;

  function save() {
    start(async () => {
      const res = await upsertCompanyMonth({ period, revenueTarget: Number(target) || 0, freelanceCost: Number(freelance) || 0, staffCost: Number(staff) || 0, otherCost: Number(other) || 0 });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 1500); router.refresh(); }
    });
  }

  return (
    <tr className="border-b border-[var(--color-line)]">
      <td className="px-4 py-2 font-medium">{monthLabel(period)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{eur(income)}</td>
      <td className="px-2 py-2 text-right"><input className={cell} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="doel" /></td>
      <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">−{eur(directCost)}</td>
      <td className="px-2 py-2 text-right"><input className={cell} value={freelance} onChange={(e) => setFreelance(e.target.value)} placeholder="0" /></td>
      <td className="px-2 py-2 text-right"><input className={cell} value={staff} onChange={(e) => setStaff(e.target.value)} placeholder="0" /></td>
      <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">−{eur(fixedTotal)}</td>
      <td className="px-2 py-2 text-right"><input className={cell} value={other} onChange={(e) => setOther(e.target.value)} placeholder="0" /></td>
      <td className="px-2 py-2 text-right font-bold tabular-nums" style={{ color: result >= 0 ? "var(--color-good)" : "var(--color-bad)" }}>{eur(result)}</td>
      <td className="px-2 py-2 text-right tabular-nums text-[var(--color-ink-muted)]">{margin}%</td>
      <td className="px-3 py-2 text-right">
        <button type="button" onClick={save} disabled={pending} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--color-indigo-soft)]">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}{saved ? "Op." : "Opslaan"}
        </button>
      </td>
    </tr>
  );
}

/* --- Vaste lasten --- */
export type FixedCost = { id: string; category: string; name: string; monthlyAmount: string; isActive: boolean };
const CATS = ["personeel", "kantoor", "software", "verzekeringen", "abonnementen", "overig"];

export function FixedCostManager({ items }: { items: FixedCost[] }) {
  const [name, setName] = useState("");
  const [cat, setCat] = useState("software");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!name.trim() || !amount) return;
    start(async () => {
      const res = await upsertFixedCost({ category: cat, name, monthlyAmount: Number(amount) || 0, isActive: true });
      if (res.ok) { setName(""); setAmount(""); router.refresh(); }
    });
  }
  function remove(id: string) { start(async () => { await deleteFixedCost(id); router.refresh(); }); }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 border-b border-[var(--color-line)] p-3">
        <select className="sc-input h-8 w-36 py-0 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
          {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="sc-input h-8 min-w-40 flex-1 py-0 text-sm" value={name} placeholder="omschrijving (bijv. Adobe CC)" onChange={(e) => setName(e.target.value)} />
        <span className="inline-flex items-center gap-1"><span className="text-xs text-[var(--color-ink-faint)]">€</span><input className="sc-input h-8 w-24 py-0 text-right text-sm" value={amount} placeholder="p/mnd" onChange={(e) => setAmount(e.target.value)} /></span>
        <Button size="sm" onClick={add} disabled={pending || !name.trim() || !amount}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Toevoegen</Button>
      </div>
      <ul className="divide-y divide-[var(--color-line)]">
        {items.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="w-28 shrink-0 text-xs text-[var(--color-ink-muted)]">{f.category}</span>
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="shrink-0 font-semibold tabular-nums">{eur(Number(f.monthlyAmount))}</span>
            <button type="button" onClick={() => remove(f.id)} className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Verwijderen"><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --- Offertes / pipeline --- */
export type Lead = { id: string; company: string; contactName: string | null; expectedMonthly: string; expectedValue: string; startOn: string | null; status: string; note: string | null };
const STATUSES = ["lead", "offerte", "onderhandeling", "gewonnen", "verloren"];

export function SalesLeadManager({ items }: { items: Lead[] }) {
  const [company, setCompany] = useState("");
  const [monthly, setMonthly] = useState("");
  const [start2, setStart2] = useState("");
  const [status, setStatus] = useState("offerte");
  const [pending, start] = useTransition();
  const router = useRouter();

  function add() {
    if (!company.trim()) return;
    start(async () => {
      const res = await upsertSalesLead({ company, expectedMonthly: Number(monthly) || 0, status: status as "offerte", startOn: start2 || undefined });
      if (res.ok) { setCompany(""); setMonthly(""); setStart2(""); router.refresh(); }
    });
  }
  function setLeadStatus(id: string, company: string, s: string) { start(async () => { await upsertSalesLead({ id, company, status: s as "offerte" }); router.refresh(); }); }
  function remove(id: string) { start(async () => { await deleteSalesLead(id); router.refresh(); }); }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2 border-b border-[var(--color-line)] p-3">
        <input className="sc-input h-8 min-w-40 flex-1 py-0 text-sm" value={company} placeholder="bedrijfsnaam" onChange={(e) => setCompany(e.target.value)} />
        <span className="inline-flex items-center gap-1"><span className="text-xs text-[var(--color-ink-faint)]">€</span><input className="sc-input h-8 w-24 py-0 text-right text-sm" value={monthly} placeholder="p/mnd" onChange={(e) => setMonthly(e.target.value)} /></span>
        <input type="date" className="sc-input h-8 w-36 py-0 text-sm" value={start2} onChange={(e) => setStart2(e.target.value)} />
        <select className="sc-input h-8 w-36 py-0 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <Button size="sm" onClick={add} disabled={pending || !company.trim()}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Toevoegen</Button>
      </div>
      <ul className="divide-y divide-[var(--color-line)]">
        {items.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{l.company}</span>
              <span className="block text-xs text-[var(--color-ink-muted)]">{eur(Number(l.expectedMonthly))}/mnd{l.startOn ? ` · start ${l.startOn}` : ""}</span>
            </span>
            <select className="sc-input h-7 w-32 py-0 text-xs" value={l.status} onChange={(e) => setLeadStatus(l.id, l.company, e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button type="button" onClick={() => remove(l.id)} className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-bad)]" aria-label="Verwijderen"><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --- Digiboox-import: boekhoud-exports (.xlsx) inlezen --- */
export function DigibooxImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DigibooxImportResult | null>(null);
  const router = useRouter();

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setNames(Array.from(e.target.files ?? []).map((f) => f.name));
    setResult(null);
  }
  function upload() {
    const files = inputRef.current?.files;
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    start(async () => {
      const res = await importDigibooxFinance(fd);
      setResult(res);
      if (res.ok) {
        setNames([]);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    });
  }

  return (
    <div className="p-5 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept=".xlsx" multiple onChange={onPick}
          className="block max-w-full text-sm text-[var(--color-ink-muted)] file:mr-3 file:rounded-[var(--radius-sm)] file:border file:border-[var(--color-line-strong)] file:bg-[var(--color-surface)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[var(--color-ink)] hover:file:bg-[var(--color-surface-sunken)]" />
        <Button onClick={upload} disabled={pending || names.length === 0} size="sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Inlezen
        </Button>
      </div>
      <p className="mt-2 text-2xs text-[var(--color-ink-faint)]">
        Kies in Digiboox de export <strong>Mutaties</strong> (omzet/kosten per maand) en/of <strong>Winst- en verliesrekening</strong> (jaartotaal). Meerdere bestanden tegelijk mag.
      </p>

      {result ? (
        <div className={`mt-3 rounded-[var(--radius-sm)] px-3 py-2 text-xs ${result.ok ? "bg-[var(--color-good-soft)] text-[#14633a]" : "bg-[var(--color-warn-soft)] text-[#8a5300]"}`}>
          {result.ok ? (
            <>
              <strong>{result.imported} maand(en) bijgewerkt</strong> uit de boekhouding.
              {result.year ? <> Jaartotaal ({result.year.label}): omzet {eur(result.year.revenue)}, kosten {eur(result.year.cost)}, resultaat <strong>{eur(result.year.result)}</strong>.</> : null}
            </>
          ) : (
            <>Niet gelukt: {result.message}</>
          )}
          {result.files && result.files.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5 text-2xs opacity-80">
              {result.files.map((f, i) => (
                <li key={i}>• {f.name} — {f.kind}{f.months ? `, ${f.months} maanden` : ""}{f.warnings.length ? ` (${f.warnings.join("; ")})` : ""}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
