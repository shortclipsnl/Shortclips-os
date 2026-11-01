"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { updateDna } from "@/server/actions/content-research";

export type DnaView = {
  toneOfVoice: string;
  doelgroep: string;
  favorieteFormats: string[];
  geaccepteerdeConcepten: string[];
  afgekeurdeConcepten: string[];
  voorkeuren: string[];
  creatieveBeperkingen: string[];
  gewensteUitstraling: string;
};

const toLines = (a: string[]) => a.join("\n");
const fromLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</span>
      {children}
    </label>
  );
}

export function DnaForm({ clientId, dna, manualNotes }: { clientId: string; dna: DnaView; manualNotes: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ok, setOk] = useState(false);
  const [f, setF] = useState({
    toneOfVoice: dna.toneOfVoice,
    doelgroep: dna.doelgroep,
    gewensteUitstraling: dna.gewensteUitstraling,
    favorieteFormats: toLines(dna.favorieteFormats),
    voorkeuren: toLines(dna.voorkeuren),
    creatieveBeperkingen: toLines(dna.creatieveBeperkingen),
    geaccepteerdeConcepten: toLines(dna.geaccepteerdeConcepten),
    afgekeurdeConcepten: toLines(dna.afgekeurdeConcepten),
    manualNotes,
  });

  function save() {
    setOk(false);
    start(async () => {
      await updateDna({
        clientId,
        profile: {
          toneOfVoice: f.toneOfVoice,
          doelgroep: f.doelgroep,
          gewensteUitstraling: f.gewensteUitstraling,
          favorieteFormats: fromLines(f.favorieteFormats),
          voorkeuren: fromLines(f.voorkeuren),
          creatieveBeperkingen: fromLines(f.creatieveBeperkingen),
          geaccepteerdeConcepten: fromLines(f.geaccepteerdeConcepten),
          afgekeurdeConcepten: fromLines(f.afgekeurdeConcepten),
        },
        manualNotes: f.manualNotes,
      });
      setOk(true);
      router.refresh();
    });
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="sc-card space-y-4 p-5">
      <p className="text-sm text-[var(--color-ink-muted)]">
        Het Content DNA stuurt hoe de AI ideeën bedenkt. Het wordt automatisch bijgewerkt na elk onderzoek en bij favoriet/afwijzen — en je kunt het hier handmatig aanscherpen.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tone of voice"><input className="sc-input w-full" value={f.toneOfVoice} onChange={set("toneOfVoice")} /></Field>
        <Field label="Doelgroep"><input className="sc-input w-full" value={f.doelgroep} onChange={set("doelgroep")} /></Field>
      </div>
      <Field label="Gewenste uitstraling"><input className="sc-input w-full" value={f.gewensteUitstraling} onChange={set("gewensteUitstraling")} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Favoriete formats (één per regel)"><textarea className="sc-input h-24 w-full" value={f.favorieteFormats} onChange={set("favorieteFormats")} /></Field>
        <Field label="Voorkeuren (één per regel)"><textarea className="sc-input h-24 w-full" value={f.voorkeuren} onChange={set("voorkeuren")} /></Field>
        <Field label="Geaccepteerde concepten"><textarea className="sc-input h-24 w-full" value={f.geaccepteerdeConcepten} onChange={set("geaccepteerdeConcepten")} /></Field>
        <Field label="Afgekeurd — niet voorstellen"><textarea className="sc-input h-24 w-full" value={f.afgekeurdeConcepten} onChange={set("afgekeurdeConcepten")} /></Field>
      </div>
      <Field label="Creatieve beperkingen (één per regel)"><textarea className="sc-input h-20 w-full" value={f.creatieveBeperkingen} onChange={set("creatieveBeperkingen")} /></Field>
      <Field label="Handmatige aantekeningen"><textarea className="sc-input h-24 w-full" value={f.manualNotes} onChange={set("manualNotes")} /></Field>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className={buttonClass({ variant: "primary", size: "md" })}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Opslaan
        </button>
        {ok ? <span className="text-sm text-[var(--color-good)]">Opgeslagen.</span> : null}
      </div>
    </div>
  );
}
