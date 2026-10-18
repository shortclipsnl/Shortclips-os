"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { createResearch, runResearch } from "@/server/actions/sales-research";
import { Button, Card, ErrorNote } from "@/components/ui";
import { NoProviderNote, ToolHowTo } from "../_shared";

const AREAS = [
  "Bedrijf & positionering",
  "Social-kanalen opzoeken en verifiëren",
  "Huidige contentstrategie",
  "Pijnpunten & gemiste kansen",
  "Kansen voor Shortclips + video-ideeën",
];

export function ResearchForm({ aiReady }: { aiReady: boolean }) {
  const [f, setF] = useState({
    companyName: "",
    website: "",
    instagram: "",
    tiktok: "",
    linkedin: "",
    facebook: "",
    youtube: "",
    branche: "",
    extra: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));

  function run() {
    if (!f.companyName.trim()) {
      setErr("Vul minimaal de bedrijfsnaam in.");
      return;
    }
    setErr(null);
    start(async () => {
      const created = await createResearch(f);
      if (!created.ok || !created.id) {
        setErr(created.message ?? "Mislukt.");
        return;
      }
      const res = await runResearch(created.id);
      // Ook bij een AI-fout gaan we naar het dossier: het is aangemaakt en daar
      // kun je het opnieuw proberen.
      if (!res.ok) setErr(res.message ?? null);
      router.push(`/ai/bedrijfsonderzoek/${created.id}`);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="mb-4">
        <ToolHowTo
          steps={[
            "Vul de bedrijfsnaam en/of de website in.",
            "De AI zoekt online en levert een bondig bedrijfsonderzoek met inzichten voor je salesgesprek.",
            "Controleer altijd de genoemde bronnen voordat je ermee aan de slag gaat.",
          ]}
        />
      </div>
      {!aiReady ? <div className="mb-4"><NoProviderNote /></div> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Bedrijfsnaam" required>
          <input className="sc-input" value={f.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="Bijv. Koops Interieur" />
        </Field>
        <Field label="Branche">
          <input className="sc-input" value={f.branche} onChange={(e) => set("branche", e.target.value)} />
        </Field>
        <Field label="Website">
          <input className="sc-input" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Instagram">
          <input className="sc-input" value={f.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="@handle of URL" />
        </Field>
        <Field label="TikTok">
          <input className="sc-input" value={f.tiktok} onChange={(e) => set("tiktok", e.target.value)} placeholder="@handle of URL" />
        </Field>
        <Field label="LinkedIn">
          <input className="sc-input" value={f.linkedin} onChange={(e) => set("linkedin", e.target.value)} />
        </Field>
        <Field label="Facebook">
          <input className="sc-input" value={f.facebook} onChange={(e) => set("facebook", e.target.value)} />
        </Field>
        <Field label="YouTube">
          <input className="sc-input" value={f.youtube} onChange={(e) => set("youtube", e.target.value)} />
        </Field>
      </div>
      <div className="mt-4">
        <Field label="Aanvullende informatie (optioneel)" hint="Alles wat helpt: context, aanleiding, specifieke vraag.">
          <textarea className="sc-input resize-y text-sm" rows={2} value={f.extra} onChange={(e) => set("extra", e.target.value)} />
        </Field>
      </div>

      <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
        Niet alle velden zijn verplicht — het systeem zoekt ontbrekende kanalen zelf op en controleert ze.
      </p>

      <div className="mt-4 border-t border-[var(--color-line)] pt-4">
        <Button onClick={run} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Start bedrijfsonderzoek
        </Button>
        {pending ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-4 text-sm">
            <p className="font-medium">Bezig met onderzoeken… dit kan 1–2 minuten duren.</p>
            <ul className="mt-2 space-y-1 text-[var(--color-ink-muted)]">
              {AREAS.map((a) => (
                <li key={a} className="flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {err && !pending ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
      </div>
    </Card>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="sc-label">
        {label}
        {required ? <span className="text-[var(--color-bad)]"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{hint}</p> : null}
    </div>
  );
}
