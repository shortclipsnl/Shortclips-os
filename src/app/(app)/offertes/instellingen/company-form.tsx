"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { saveCompanyInfo } from "@/server/actions/quotes";
import type { CompanyInfo } from "@/server/quotes/company";

const FIELDS: { key: keyof CompanyInfo; label: string; placeholder?: string }[] = [
  { key: "name", label: "Bedrijfsnaam" },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Telefoon" },
  { key: "website", label: "Website" },
  { key: "address", label: "Adres", placeholder: "Straat en huisnummer" },
  { key: "postalCity", label: "Postcode + plaats" },
  { key: "kvk", label: "KvK-nummer" },
  { key: "btw", label: "BTW-nummer" },
  { key: "iban", label: "IBAN" },
];

export function CompanyForm({ company }: { company: CompanyInfo }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [val, setVal] = useState<CompanyInfo>(company);

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveCompanyInfo(val);
      setMsg(res.ok ? "Opgeslagen." : res.message ?? "Mislukt.");
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="sc-card space-y-3 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.key === "address" ? "sm:col-span-2" : ""}>
            <label className="sc-label">{f.label}</label>
            <input className="sc-input" value={val[f.key]} placeholder={f.placeholder} onChange={(e) => setVal((v) => ({ ...v, [f.key]: e.target.value }))} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending} onClick={save} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Opslaan</button>
        {msg ? <span className="text-xs text-[var(--color-ink-muted)]">{msg}</span> : null}
      </div>
    </div>
  );
}
