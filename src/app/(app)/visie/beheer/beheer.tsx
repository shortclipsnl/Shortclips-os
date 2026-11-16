"use client";

import { useState, useTransition, type ReactNode } from "react";
import { RotateCcw, Save, ShieldCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { FUNCTIES, type Functie, type FunctieVisie, type Principe, type Visie } from "@/lib/visie/data";
import { herstelVisieVoorstel, opslaanVisie, stelVisieVast, zetVisieOpVoorstel } from "@/server/actions/visie";

const regels = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

function Sectie({ titel, sub, children }: { titel: string; sub?: string; children: ReactNode }) {
  return (
    <details className="group sc-card mb-4 overflow-hidden" open={titel.startsWith("1.")}>
      <summary className="cursor-pointer list-none px-4 py-3 hover:bg-[var(--color-neutral-soft)] sm:px-5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-base font-semibold text-[var(--color-ink)]">{titel}</h2>
        {sub ? <p className="text-sm text-[var(--color-ink-muted)]">{sub}</p> : null}
      </summary>
      <div className="space-y-3 border-t border-[var(--color-line)] p-4 sm:p-5">{children}</div>
    </details>
  );
}

function Veld({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="sc-label mb-1 block">{label}</span>
      <textarea className="sc-input w-full" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const FUNCTIE_VELDEN: [keyof FunctieVisie, string][] = [
  ["titel", "Kernzin"], ["betekenis", "Waarom deze functie bestaat"], ["verantwoordelijkheid", "Verantwoordelijkheid"],
  ["standaard", "Kwaliteitsstandaard"], ["bijdrage", "Bijdrage aan klantresultaat"], ["proactief", "Proactief waarde toevoegen"],
  ["wel", "Gedrag: wel"], ["niet", "Gedrag: niet"],
];
const PRINCIPE_VELDEN: [keyof Principe, string][] = [
  ["titel", "Titel"], ["uitleg", "Uitleg"], ["praktijk", "In de praktijk"], ["wel", "Past bij ons"], ["niet", "Past niet"],
];

export function VisieBeheer({ start }: { start: Visie }) {
  const [v, setV] = useState<Visie>(start);
  const [melding, setMelding] = useState<{ ok: boolean; tekst: string } | null>(null);
  const [bezig, startTransition] = useTransition();
  const zet = (patch: Partial<Visie>) => setV((x) => ({ ...x, ...patch }));

  const voer = (actie: () => Promise<{ ok: true; visie: Visie } | { ok: false; fout: string }>, klaar: string) =>
    startTransition(async () => {
      setMelding(null);
      const r = await actie();
      if (r.ok) { setV(r.visie); setMelding({ ok: true, tekst: klaar }); } else setMelding({ ok: false, tekst: r.fout });
    });

  const definitief = v.status === "definitief";
  const open = v.openBesluiten.filter((b) => !b.besloten).length;

  return (
    <div>
      <div className={cn("sticky top-2 z-10 mb-5 flex flex-wrap items-center gap-2 rounded-[var(--radius-lg)] border px-4 py-3 shadow-sm", definitief ? "border-[var(--color-good)]/30 bg-[var(--color-good-soft)]" : "border-[#e6c94f]/50 bg-[#fff4c2]")}>
        <div className="min-w-0 flex-1 text-sm">
          <strong className={cn("font-semibold", definitief ? "text-[var(--color-ink)]" : "text-[#5c4400]")}>
            {definitief ? "Vastgesteld: zichtbaar voor het hele team." : "Voorstel: alleen zichtbaar voor jou."}
          </strong>{" "}
          <span className={definitief ? "text-[var(--color-ink-muted)]" : "text-[#5c4400]"}>
            {open > 0 ? `${open} besluiten staan nog open.` : "Alle besluiten zijn genomen."} Tekst tussen [[dubbele haken]] ziet alleen jij gemarkeerd.
          </span>
        </div>
        <Button variant="secondary" size="sm" disabled={bezig} onClick={() => voer(() => opslaanVisie(v), "Opgeslagen.")}><Save className="size-4" /> Opslaan</Button>
        {definitief ? (
          <Button variant="secondary" size="sm" disabled={bezig} onClick={() => voer(() => zetVisieOpVoorstel(v), "Terug naar voorstel. Het team ziet de visie nu niet.")}><Undo2 className="size-4" /> Terug naar voorstel</Button>
        ) : (
          <Button size="sm" disabled={bezig} onClick={() => voer(() => stelVisieVast(v), "Vastgesteld. Het team ziet de visie nu overal in het portaal.")}><ShieldCheck className="size-4" /> Vaststellen voor het team</Button>
        )}
      </div>
      {melding ? <p className={cn("mb-4 text-sm font-medium", melding.ok ? "text-[#1d6b4c]" : "text-[#a3271c]")}>{melding.tekst}</p> : null}

      <Sectie titel="1. Besluiten die nog openstaan" sub="Vink af wat je hebt besloten. Vaststellen kan ook als er nog besluiten openstaan; de gemarkeerde tekst blijft dan voor jou zichtbaar.">
        {v.openBesluiten.map((b, i) => (
          <label key={b.id} className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] px-3 py-2.5 text-sm">
            <input type="checkbox" className="mt-1" checked={b.besloten} onChange={(e) => zet({ openBesluiten: v.openBesluiten.map((x, j) => (j === i ? { ...x, besloten: e.target.checked } : x)) })} />
            <span>
              <span className={cn("font-semibold text-[var(--color-ink)]", b.besloten && "line-through opacity-60")}>{b.vraag}</span>
              {b.voorstel ? <span className="block text-[var(--color-ink-muted)]">Voorstel: {b.voorstel}</span> : null}
            </span>
          </label>
        ))}
      </Sectie>

      <Sectie titel="2. Positionering, missie en visie">
        <Veld label="Positionering" value={v.positionering} onChange={(x) => zet({ positionering: x })} />
        <Veld label="Centrale gedachte" value={v.centraleGedachte} onChange={(x) => zet({ centraleGedachte: x })} />
        <Veld label="Missie" value={v.missie} onChange={(x) => zet({ missie: x })} rows={3} />
        <Veld label="Visie" value={v.visie} onChange={(x) => zet({ visie: x })} rows={3} />
        <Veld label="Waarom Shortclips bestaat (conclusie)" value={v.waarom.conclusie} onChange={(x) => zet({ waarom: { ...v.waarom, conclusie: x } })} rows={3} />
      </Sectie>

      <Sectie titel="3. De kernprincipes" sub="Het principe van de week op Vandaag wisselt automatisch op maandag.">
        {v.principes.map((p, i) => (
          <div key={p.nr} className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
            <div className="mb-2 text-sm font-semibold text-[var(--color-ink)]">Principe {p.nr}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {PRINCIPE_VELDEN.map(([k, label]) => (
                <Veld key={k} label={label} value={String(p[k])} onChange={(x) => zet({ principes: v.principes.map((y, j) => (j === i ? { ...y, [k]: x } : y)) })} />
              ))}
            </div>
          </div>
        ))}
      </Sectie>

      <Sectie titel="4. Wat de visie betekent per functie">
        {FUNCTIES.map((f: Functie) => (
          <div key={f} className="rounded-[var(--radius-md)] border border-[var(--color-line)] p-3">
            <div className="mb-2 text-sm font-semibold text-[var(--color-ink)]">{v.functies[f].label}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {FUNCTIE_VELDEN.map(([k, label]) => (
                <Veld key={k} label={label} value={v.functies[f][k]} onChange={(x) => zet({ functies: { ...v.functies, [f]: { ...v.functies[f], [k]: x } } })} />
              ))}
            </div>
          </div>
        ))}
      </Sectie>

      <Sectie titel="5. Verder dan de taak" sub="Eén regel per verantwoordelijkheid op Mijn verantwoordelijkheden. cc = Milou en Jiska, ru = Rutger.">
        {Object.entries(v.verderDanDeTaak).map(([k, x]) => (
          <div key={k} className="grid gap-2 sm:grid-cols-[150px_90px_1fr] sm:items-start">
            <span className="pt-2 text-xs font-semibold text-[var(--color-ink-muted)]">{k}</span>
            <select className="sc-input" value={x.principe} onChange={(e) => zet({ verderDanDeTaak: { ...v.verderDanDeTaak, [k]: { ...x, principe: Number(e.target.value) } } })}>
              {v.principes.map((p) => <option key={p.nr} value={p.nr}>Principe {p.nr}</option>)}
            </select>
            <textarea className="sc-input w-full" rows={2} value={x.tekst} onChange={(e) => zet({ verderDanDeTaak: { ...v.verderDanDeTaak, [k]: { ...x, tekst: e.target.value } } })} />
          </div>
        ))}
      </Sectie>

      <Sectie titel="6. Kwaliteitsvragen en beloftes" sub="Eén regel per punt.">
        <Veld label="Scripting: vragen in de kwaliteitscheck" rows={4} value={v.kwaliteitsvragen.scripting.join("\n")} onChange={(x) => zet({ kwaliteitsvragen: { ...v.kwaliteitsvragen, scripting: regels(x) } })} />
        <Veld label="Editing: voordat je exporteert (editorbriefing)" rows={4} value={v.kwaliteitsvragen.editing.join("\n")} onChange={(x) => zet({ kwaliteitsvragen: { ...v.kwaliteitsvragen, editing: regels(x) } })} />
        <Veld label="Opnames: extra waarde op locatie (draaiboek)" rows={4} value={v.kwaliteitsvragen.opname.join("\n")} onChange={(x) => zet({ kwaliteitsvragen: { ...v.kwaliteitsvragen, opname: regels(x) } })} />
        <Veld label="Wat wij onze klanten beloven" rows={6} value={v.beloftes.join("\n")} onChange={(x) => zet({ beloftes: regels(x) })} />
        <Veld label="Wat de klant zelf doet" rows={5} value={v.klantDoet.join("\n")} onChange={(x) => zet({ klantDoet: regels(x) })} />
        <Veld label="Wat wij van elke medewerker verwachten" rows={6} value={v.verwachtingen.join("\n")} onChange={(x) => zet({ verwachtingen: regels(x) })} />
        <Veld label="Klant van de week: vragen in de teammeeting" rows={5} value={v.klantVanDeWeek.join("\n")} onChange={(x) => zet({ klantVanDeWeek: regels(x) })} />
      </Sectie>

      <Sectie titel="7. Meetpunten" sub="De normen zijn voorstellen. Haal de dubbele haken weg zodra een norm is vastgelegd.">
        {v.meetpunten.map((m, i) => (
          <div key={m.key} className="grid gap-2 sm:grid-cols-[150px_1fr_1fr_140px] sm:items-start">
            <span className="pt-2 text-sm font-semibold text-[var(--color-ink)]">{m.titel}</span>
            <textarea className="sc-input w-full" rows={2} value={m.meting} onChange={(e) => zet({ meetpunten: v.meetpunten.map((y, j) => (j === i ? { ...y, meting: e.target.value } : y)) })} />
            <textarea className="sc-input w-full" rows={2} value={m.bron} onChange={(e) => zet({ meetpunten: v.meetpunten.map((y, j) => (j === i ? { ...y, bron: e.target.value } : y)) })} />
            <input className="sc-input w-full" value={m.norm} onChange={(e) => zet({ meetpunten: v.meetpunten.map((y, j) => (j === i ? { ...y, norm: e.target.value } : y)) })} />
          </div>
        ))}
      </Sectie>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button disabled={bezig} onClick={() => voer(() => opslaanVisie(v), "Opgeslagen.")}><Save className="size-4" /> Opslaan</Button>
        <Button variant="secondary" disabled={bezig} onClick={() => voer(() => herstelVisieVoorstel(), "De tekst uit het Visie Voorstel is teruggezet, als voorstel.")}><RotateCcw className="size-4" /> Terug naar de tekst uit het Visie Voorstel</Button>
      </div>
    </div>
  );
}
