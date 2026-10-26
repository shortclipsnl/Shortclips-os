"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send, Sparkles } from "lucide-react";
import { approveImprovementPlan, generateImprovementPlan, saveImprovementPlan } from "@/server/actions/improvements";
import type { ImprovementContent } from "@/server/improvements";
import { Button, ErrorNote } from "@/components/ui";

const FIELDS: Array<{ k: keyof ImprovementContent; label: string }> = [
  { k: "watWerkt", label: "Wat werkte goed" },
  { k: "watMinder", label: "Wat presteerde minder" },
  { k: "volgendeWeek", label: "Volgende week anders" },
  { k: "volgendeMaand", label: "Volgende maand testen/verbeteren" },
  { k: "formats", label: "Formats vaker inzetten" },
  { k: "optimalisaties", label: "Concrete optimalisaties" },
];

const toText = (a: string[]) => a.join("\n");
const toList = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8);

/** Interne editor voor "Wat gaan we verbeteren?" — genereren, bewerken, goedkeuren. */
export function ImprovementEditor({
  clientId,
  initial,
  status,
  approvedByName,
}: {
  clientId: string;
  initial: ImprovementContent;
  status: string | null;
  approvedByName: string | null;
}) {
  const [text, setText] = useState<Record<keyof ImprovementContent, string>>({
    watWerkt: toText(initial.watWerkt), watMinder: toText(initial.watMinder), volgendeWeek: toText(initial.volgendeWeek),
    volgendeMaand: toText(initial.volgendeMaand), formats: toText(initial.formats), optimalisaties: toText(initial.optimalisaties),
  });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [genPending, startGen] = useTransition();
  const [savePending, startSave] = useTransition();
  const router = useRouter();

  const content = (): ImprovementContent => ({
    watWerkt: toList(text.watWerkt), watMinder: toList(text.watMinder), volgendeWeek: toList(text.volgendeWeek),
    volgendeMaand: toList(text.volgendeMaand), formats: toList(text.formats), optimalisaties: toList(text.optimalisaties),
  });

  function generate() {
    setErr(null); setMsg(null);
    startGen(async () => {
      const res = await generateImprovementPlan(clientId);
      if (res.ok) { setMsg("Concept gegenereerd — controleer en keur goed."); router.refresh(); }
      else setErr(res.message ?? "Mislukt.");
    });
  }
  function save() {
    setErr(null); setMsg(null);
    startSave(async () => {
      const res = await saveImprovementPlan(clientId, content());
      if (res.ok) { setMsg("Opgeslagen (concept)."); router.refresh(); }
      else setErr(res.message ?? "Mislukt.");
    });
  }
  function approve() {
    setErr(null); setMsg(null);
    startSave(async () => {
      // Eerst de huidige tekst opslaan, dan goedkeuren.
      const s = await saveImprovementPlan(clientId, content());
      if (!s.ok) { setErr(s.message ?? "Mislukt."); return; }
      const res = await approveImprovementPlan(clientId);
      if (res.ok) { setMsg("Goedgekeurd en gedeeld met de klant."); router.refresh(); }
      else setErr(res.message ?? "Mislukt.");
    });
  }

  const approved = status === "approved";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={generate} disabled={genPending}>
          {genPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Genereer met AI
        </Button>
        {approved ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-good-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--color-good)]">
            <Check className="size-3.5" /> Gedeeld met klant{approvedByName ? ` · ${approvedByName}` : ""}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)]">Concept — nog niet zichtbaar voor de klant</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.k} className="block">
            <span className="sc-label">{f.label}</span>
            <textarea
              rows={3}
              value={text[f.k]}
              onChange={(e) => setText((t) => ({ ...t, [f.k]: e.target.value }))}
              placeholder="Eén punt per regel…"
              className="sc-input resize-y text-sm"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={save} disabled={savePending}>
          {savePending ? <Loader2 className="size-4 animate-spin" /> : null} Concept opslaan
        </Button>
        <Button size="sm" onClick={approve} disabled={savePending}>
          <Send className="size-4" /> {approved ? "Opnieuw delen" : "Goedkeuren en delen met klant"}
        </Button>
        {msg ? <span className="text-sm font-medium text-[var(--color-good)]">{msg}</span> : null}
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </div>
  );
}
