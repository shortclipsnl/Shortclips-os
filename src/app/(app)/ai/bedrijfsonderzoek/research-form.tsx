"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Check } from "lucide-react";
import { createResearch, runResearch } from "@/server/actions/sales-research";
import { SALES_GOALS } from "@/lib/sales-research";
import { Button, Card, ErrorNote } from "@/components/ui";
import { NoProviderNote, ToolHowTo } from "../_shared";

// De fasen die we tonen tijdens het onderzoek (voortgangsindicatie over één
// onderzoekspass; de fase schuift op een inschatting op).
const PHASES = [
  "Bedrijfsinformatie verzamelen",
  "Website analyseren",
  "Social media analyseren",
  "Contentkansen identificeren",
  "Strategie en concepten ontwikkelen",
  "Salespresentatie genereren",
];

export function ResearchForm({ aiReady }: { aiReady: boolean }) {
  const [f, setF] = useState({
    companyName: "",
    website: "",
    branche: "",
    city: "",
    description: "",
    instagram: "",
    tiktok: "",
    facebook: "",
    linkedin: "",
    youtube: "",
    contactName: "",
    meetingDate: "",
    primaryGoal: "",
    extra: "",
  });
  const [goals, setGoals] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [phase, setPhase] = useState(0);
  const router = useRouter();

  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const toggleGoal = (g: string) => setGoals((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  // Fasen laten oplopen zolang het onderzoek draait (laatste fase blijft staan tot klaar).
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (pending) {
      setPhase(0);
      timer.current = setInterval(() => setPhase((p) => Math.min(PHASES.length - 1, p + 1)), 12000);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [pending]);

  function run() {
    if (!f.companyName.trim()) {
      setErr("Vul minimaal de bedrijfsnaam in.");
      return;
    }
    setErr(null);
    start(async () => {
      const created = await createResearch({ ...f, goals });
      if (!created.ok || !created.id) {
        setErr(created.message ?? "Mislukt.");
        return;
      }
      const res = await runResearch(created.id);
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
            "Vul de bedrijfsnaam, website en social media links in — en eventueel de doelstellingen en het contactmoment.",
            "Klik op 'Start bedrijfsonderzoek': de AI onderzoekt het bedrijf online en bouwt een persoonlijke salespresentatie.",
            "Bekijk en verfijn de presentatie en download 'm als PDF voor het kennismakingsgesprek.",
          ]}
        />
      </div>
      {!aiReady ? <div className="mb-4"><NoProviderNote /></div> : null}

      <Section title="Bedrijfsinformatie">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Bedrijfsnaam" required>
            <input className="sc-input" value={f.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="Bijv. Koops Interieur" />
          </Field>
          <Field label="Website">
            <input className="sc-input" value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Branche">
            <input className="sc-input" value={f.branche} onChange={(e) => set("branche", e.target.value)} />
          </Field>
          <Field label="Vestigingsplaats">
            <input className="sc-input" value={f.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Korte beschrijving van het bedrijf (optioneel)">
            <textarea className="sc-input resize-y text-sm" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Social media kanalen">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Instagram"><input className="sc-input" value={f.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="@handle of URL" /></Field>
          <Field label="TikTok"><input className="sc-input" value={f.tiktok} onChange={(e) => set("tiktok", e.target.value)} placeholder="@handle of URL" /></Field>
          <Field label="Facebook"><input className="sc-input" value={f.facebook} onChange={(e) => set("facebook", e.target.value)} /></Field>
          <Field label="LinkedIn"><input className="sc-input" value={f.linkedin} onChange={(e) => set("linkedin", e.target.value)} /></Field>
          <Field label="YouTube"><input className="sc-input" value={f.youtube} onChange={(e) => set("youtube", e.target.value)} /></Field>
        </div>
      </Section>

      <Section title="Doelstellingen van de prospect">
        <div className="flex flex-wrap gap-2">
          {SALES_GOALS.map((g) => {
            const sel = goals.includes(g);
            return (
              <button key={g} type="button" onClick={() => toggleGoal(g)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${sel ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white" : "border-[var(--color-line-strong)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-brand-500)]"}`}>
                {g}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">De AI bepaalt ook zelf welke doelstellingen waarschijnlijk relevant zijn — zonder onbevestigde aannames als feit te presenteren.</p>
      </Section>

      <Section title="Aanvullende informatie">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Contactpersoon"><input className="sc-input" value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></Field>
          <Field label="Datum kennismakingsgesprek"><input className="sc-input" value={f.meetingDate} onChange={(e) => set("meetingDate", e.target.value)} placeholder="bijv. 12 november 2026" /></Field>
        </div>
        <div className="mt-4">
          <Field label="Belangrijkste doelstelling van de potentiële klant (optioneel)">
            <input className="sc-input" value={f.primaryGoal} onChange={(e) => set("primaryGoal", e.target.value)} placeholder="bijv. meer aanvragen via social media" />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Aanvullende opmerkingen van ons salesteam (optioneel)">
            <textarea className="sc-input resize-y text-sm" rows={2} value={f.extra} onChange={(e) => set("extra", e.target.value)} />
          </Field>
        </div>
      </Section>

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
            <ul className="mt-2 space-y-1.5">
              {PHASES.map((a, i) => {
                const done = i < phase;
                const active = i === phase;
                return (
                  <li key={a} className={`flex items-center gap-2 ${done ? "text-[var(--color-good)]" : active ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)]"}`}>
                    {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : <span className="size-3.5 rounded-full border border-current opacity-40" />}
                    {a}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {err && !pending ? <div className="mt-3"><ErrorNote>{err}</ErrorNote></div> : null}
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="mb-2.5 text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{title}</h3>
      {children}
    </div>
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
