"use client";

import { useState, useTransition, type ReactNode } from "react";
import { ChevronDown, Plus, RotateCcw, Save, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  FREQUENTIES, KOPPELINGEN, MEDEWERKERS, NIVEAUS, naamVan,
  type Beslissing, type Config, type Controle, type Frequentie, type Koppeling, type Niveau, type Profiel, type Verantwoordelijkheid,
} from "@/lib/verantwoordelijkheden/data";
import {
  herstelVoorstel, keurVerantwoordelijkhedenGoed, opslaanVerantwoordelijkheden, zetVerantwoordelijkhedenOpConcept,
} from "@/server/actions/verantwoordelijkheden";

const nieuwId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const regels = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
const NIVEAU_KLEUR: Record<Niveau, string> = {
  zelf: "border-[#bfe3cf] bg-[var(--color-good-soft)] text-[#1d6b4c]",
  overleg: "border-[#f1d2a8] bg-[var(--color-warn-soft)] text-[#8a5300]",
  escaleren: "border-[#f0c3bf] bg-[var(--color-bad-soft)] text-[#a3271c]",
};
const ALLE_PERSONEN = MEDEWERKERS.map((m) => ({ email: m.email, naam: m.naam }));
const paren = (t: string) => regels(t).map((r) => { const [a, ...rest] = r.split("|"); return [a.trim(), rest.join("|").trim()] as const; }).filter(([a]) => a);

function Sectie({ titel, sub, actie, children }: { titel: string; sub?: string; actie?: ReactNode; children: ReactNode }) {
  return (
    <section className="sc-card mb-5 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-ink)]">{titel}</h2>
          {sub ? <p className="text-sm text-[var(--color-ink-muted)]">{sub}</p> : null}
        </div>
        {actie}
      </div>
      {children}
    </section>
  );
}

function Veld({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="sc-label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function KoppelingKiezer({ waarde, onChange }: { waarde: Koppeling | null; onChange: (k: Koppeling | null) => void }) {
  return (
    <select className="sc-input w-full" value={waarde?.href ?? ""} onChange={(e) => onChange(KOPPELINGEN.find((k) => k.href === e.target.value) ?? null)}>
      <option value="">Geen koppeling</option>
      {KOPPELINGEN.map((k) => <option key={k.href} value={k.href}>{k.label}</option>)}
    </select>
  );
}

function PersoonKiezer({ waarde, onChange, zonder }: { waarde: string | null; onChange: (e: string | null) => void; zonder: string }) {
  return (
    <select className="sc-input w-full" value={waarde ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Niemand</option>
      {MEDEWERKERS.filter((m) => m.email !== zonder).map((m) => <option key={m.email} value={m.email}>{m.naam}</option>)}
    </select>
  );
}

export function Beheer({ start }: { start: Config }) {
  const [config, setConfig] = useState<Config>(start);
  const [persoon, setPersoon] = useState<string>(MEDEWERKERS[0].email);
  const [open, setOpen] = useState<string | null>(null);
  const [gewijzigd, setGewijzigd] = useState(false);
  const [melding, setMelding] = useState<{ tekst: string; fout?: boolean } | null>(null);
  const [bezig, start_] = useTransition();

  const wijzig = (f: (c: Config) => Config) => { setConfig((c) => f(c)); setGewijzigd(true); };
  const zetV = (id: string, p: Partial<Verantwoordelijkheid>) =>
    wijzig((c) => ({ ...c, verantwoordelijkheden: c.verantwoordelijkheden.map((r) => (r.id === id ? { ...r, ...p } : r)) }));
  const zetB = (id: string, p: Partial<Beslissing>) =>
    wijzig((c) => ({ ...c, beslissingen: c.beslissingen.map((r) => (r.id === id ? { ...r, ...p } : r)) }));
  const zetC = (id: string, p: Partial<Controle>) =>
    wijzig((c) => ({ ...c, controles: c.controles.map((r) => (r.id === id ? { ...r, ...p } : r)) }));

  const voer = (actie: (c: Config) => Promise<{ ok: true; config: Config } | { ok: false; fout: string }>, ok: string, bevestig?: string) => {
    if (bevestig && !window.confirm(bevestig)) return;
    start_(async () => {
      const r = await actie(config);
      if (r.ok) { setConfig(r.config); setGewijzigd(false); setMelding({ tekst: ok }); }
      else setMelding({ tekst: r.fout, fout: true });
      window.setTimeout(() => setMelding(null), 3000);
    });
  };

  const items = config.verantwoordelijkheden.filter((r) => r.persoon === persoon);
  const besl = config.beslissingen.filter((r) => r.persoon === persoon);
  const ctrl = config.controles.filter((r) => r.persoon === persoon);
  const afw = config.afwezigheid[persoon] ?? { doorloopt: [], beslisser: "", vervanger: null };
  const prof: Profiel = config.profielen?.[persoon] ?? { functie: MEDEWERKERS.find((m) => m.email === persoon)?.functie ?? "", doel: "", kpis: [], samenwerking: [], bron: "" };
  const zetP = (x: Partial<Profiel>) => wijzig((c) => ({ ...c, profielen: { ...c.profielen, [persoon]: { ...prof, ...x } } }));
  const goedgekeurd = config.status === "goedgekeurd";

  return (
    <div>
      {/* Status en acties */}
      <div className="sticky top-0 z-10 -mx-1 mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5 shadow-sm">
        <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", goedgekeurd ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[#fff4c2] text-[#7a5a00]")}>
          {goedgekeurd ? "Goedgekeurd: het team ziet dit" : "Concept: het team ziet dit nog niet"}
        </span>
        {gewijzigd && <span className="text-xs text-[var(--color-ink-muted)]">Niet opgeslagen wijzigingen</span>}
        {melding && <span className={cn("text-xs font-medium", melding.fout ? "text-[#a3271c]" : "text-[#1d6b4c]")}>{melding.tekst}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" disabled={bezig} onClick={() => voer(() => herstelVoorstel(), "Voorstel teruggezet", "Alles terugzetten naar het oorspronkelijke voorstel? Je wijzigingen gaan verloren en de pagina wordt weer concept.")}>
            <RotateCcw className="size-4" /> Voorstel herstellen
          </Button>
          {goedgekeurd ? (
            <Button variant="secondary" size="sm" disabled={bezig} onClick={() => voer(zetVerantwoordelijkhedenOpConcept, "Terug naar concept", "Terug naar concept? Het team ziet de pagina dan tijdelijk niet.")}>
              <Undo2 className="size-4" /> Terug naar concept
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={bezig} onClick={() => voer(keurVerantwoordelijkhedenGoed, "Goedgekeurd: het team ziet zijn pagina", "Verdeling goedkeuren? Het team ziet daarna direct de eigen pagina.")}>
              <ShieldCheck className="size-4" /> Goedkeuren en activeren
            </Button>
          )}
          <Button size="sm" disabled={bezig || !gewijzigd} onClick={() => voer(opslaanVerantwoordelijkheden, "Opgeslagen")}>
            <Save className="size-4" /> Opslaan
          </Button>
        </div>
      </div>

      {/* Open punten */}
      <Sectie titel="Te bevestigen" sub="Onduidelijkheden tussen de opdracht en wat al in het portaal staat. Alleen jij ziet dit. Gele tekst op de pagina is een voorstel.">
        <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm text-[var(--color-ink)]">
          {config.openPunten.map((p) => <li key={p}>{p}</li>)}
        </ol>
        <details>
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-ink-muted)]">Punten bewerken (één per regel)</summary>
          <textarea
            key={config.bijgewerktOp ?? "voorstel"}
            className="sc-input mt-2 min-h-[140px] w-full"
            defaultValue={config.openPunten.join("\n")}
            onBlur={(e) => wijzig((c) => ({ ...c, openPunten: regels(e.target.value) }))}
          />
        </details>
      </Sectie>

      {/* Medewerker */}
      <div className="mb-4 flex flex-wrap gap-2">
        {MEDEWERKERS.map((m) => (
          <button
            key={m.email}
            type="button"
            onClick={() => { setPersoon(m.email); setOpen(null); }}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-medium transition",
              m.email === persoon ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white" : "border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
            )}
          >
            {m.naam}
          </button>
        ))}
      </div>

      {/* Rol, KPI's en samenwerking */}
      <Sectie titel="Rol, KPI's en samenwerking" sub="De kop van de persoonlijke pagina. Houd dit gelijk aan Kennisbank › Team Shortclips.">
        <div key={`${persoon}-${config.bijgewerktOp ?? "voorstel"}-profiel`} className="grid gap-3 md:grid-cols-2">
          <Veld label="Functie"><input className="sc-input w-full" defaultValue={prof.functie} onBlur={(e) => zetP({ functie: e.target.value })} /></Veld>
          <Veld label="Bron in de kennisbank"><input className="sc-input w-full" defaultValue={prof.bron} onBlur={(e) => zetP({ bron: e.target.value })} /></Veld>
          <Veld label="Rol in het kort" className="md:col-span-2"><textarea className="sc-input w-full" rows={2} defaultValue={prof.doel} onBlur={(e) => zetP({ doel: e.target.value })} /></Veld>
          <Veld label="KPI's (één per regel: KPI | norm)">
            <textarea className="sc-input w-full" rows={6} defaultValue={prof.kpis.map((k) => `${k.titel} | ${k.norm}`).join("\n")}
              onBlur={(e) => zetP({ kpis: paren(e.target.value).map(([titel, norm]) => ({ titel, norm })) })} />
          </Veld>
          <Veld label="Samenwerking (één per regel: met wie | wanneer)">
            <textarea className="sc-input w-full" rows={6} defaultValue={prof.samenwerking.map((k) => `${k.met} | ${k.wanneer}`).join("\n")}
              onBlur={(e) => zetP({ samenwerking: paren(e.target.value).map(([met, wanneer]) => ({ met, wanneer })) })} />
          </Veld>
        </div>
      </Sectie>

      {/* Verantwoordelijkheden */}
      <Sectie
        titel="Verantwoordelijkheden"
        sub="Klik om te wijzigen. Uitgezet betekent: blijft bewaard, maar staat niet op de pagina."
        actie={
          <Button variant="secondary" size="sm" onClick={() => {
            const id = nieuwId("v");
            wijzig((c) => ({ ...c, verantwoordelijkheden: [...c.verantwoordelijkheden, {
              id, persoon, titel: "Nieuwe verantwoordelijkheid", wat: "", wanneer: "", verwachting: "", afgerond: "",
              betrokken: [], bevoegdheden: [], escalatie: "", vervanger: null, actief: true, koppeling: null,
            }] }));
            setOpen(id);
          }}>
            <Plus className="size-4" /> Toevoegen
          </Button>
        }
      >
        <div className="divide-y divide-[var(--color-line)]">
          {items.map((r) => (
            <div key={r.id} className="py-2">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ChevronDown className={cn("size-4 shrink-0 text-[var(--color-ink-faint)] transition", open === r.id && "rotate-180")} />
                  <span className={cn("truncate text-sm font-medium", r.actief ? "text-[var(--color-ink)]" : "text-[var(--color-ink-faint)] line-through")}>{r.titel}</span>
                  {r.vervanger && <span className="hidden shrink-0 text-xs text-[var(--color-ink-faint)] sm:inline">vervanger {naamVan(r.vervanger)}</span>}
                </button>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
                  <input type="checkbox" checked={r.actief} onChange={(e) => zetV(r.id, { actief: e.target.checked })} /> Actief
                </label>
              </div>
              {open === r.id && (
                <div className="mt-3 grid gap-3 pb-2 pl-6 md:grid-cols-2">
                  <Veld label="Titel" className="md:col-span-2"><input className="sc-input w-full" value={r.titel} onChange={(e) => zetV(r.id, { titel: e.target.value })} /></Veld>
                  <Veld label="Wat moet ik regelen?" className="md:col-span-2"><textarea className="sc-input w-full" rows={2} value={r.wat} onChange={(e) => zetV(r.id, { wat: e.target.value })} /></Veld>
                  <Veld label="Wanneer?"><input className="sc-input w-full" value={r.wanneer} onChange={(e) => zetV(r.id, { wanneer: e.target.value })} /></Veld>
                  <Veld label="Wat wordt verwacht?"><input className="sc-input w-full" value={r.verwachting} onChange={(e) => zetV(r.id, { verwachting: e.target.value })} /></Veld>
                  <Veld label="Wanneer is het goed afgerond?" className="md:col-span-2"><input className="sc-input w-full" value={r.afgerond} onChange={(e) => zetV(r.id, { afgerond: e.target.value })} /></Veld>
                  <Veld label="Bevoegdheden (één per regel)">
                    <textarea className="sc-input w-full" rows={3} defaultValue={r.bevoegdheden.join("\n")} onBlur={(e) => zetV(r.id, { bevoegdheden: regels(e.target.value) })} />
                  </Veld>
                  <Veld label="Wanneer moet Jarno erbij?">
                    <textarea className="sc-input w-full" rows={3} value={r.escalatie} onChange={(e) => zetV(r.id, { escalatie: e.target.value })} />
                  </Veld>
                  <Veld label="Vervanger bij afwezigheid"><PersoonKiezer waarde={r.vervanger} zonder={persoon} onChange={(x) => zetV(r.id, { vervanger: x })} /></Veld>
                  <Veld label="Gekoppeld aan"><KoppelingKiezer waarde={r.koppeling} onChange={(k) => zetV(r.id, { koppeling: k })} /></Veld>
                  <div className="md:col-span-2">
                    <span className="sc-label mb-1 block">Betrokken collega&apos;s</span>
                    <div className="flex flex-wrap gap-3">
                      {ALLE_PERSONEN.filter((p) => p.email !== persoon).map((p) => (
                        <label key={p.email} className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={r.betrokken.includes(p.email)}
                            onChange={(e) => zetV(r.id, { betrokken: e.target.checked ? [...r.betrokken, p.email] : r.betrokken.filter((x) => x !== p.email) })}
                          /> {p.naam}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <Button variant="ghost" size="sm" className="text-[#a3271c]" onClick={() => {
                      if (!window.confirm(`"${r.titel}" verwijderen?`)) return;
                      wijzig((c) => ({ ...c, verantwoordelijkheden: c.verantwoordelijkheden.filter((x) => x.id !== r.id) }));
                    }}>
                      <Trash2 className="size-4" /> Verwijderen
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Sectie>

      {/* Beslissingsmatrix */}
      <Sectie
        titel="Beslissingsmatrix"
        sub="Groen: zelf beslissen (niveau 1 en 2). Oranje: eerst intern overleggen (niveau 3). Rood: altijd naar Jarno (niveau 4)."
        actie={
          <Button variant="secondary" size="sm" onClick={() => wijzig((c) => ({ ...c, beslissingen: [...c.beslissingen, { id: nieuwId("b"), persoon, situatie: "Nieuwe situatie", niveau: "zelf", actief: true }] }))}>
            <Plus className="size-4" /> Situatie
          </Button>
        }
      >
        <div className="space-y-2">
          {besl.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input className={cn("sc-input min-w-0 flex-1", !r.actief && "opacity-50")} value={r.situatie} onChange={(e) => zetB(r.id, { situatie: e.target.value })} />
              <select className={cn("sc-input w-[190px] border font-medium", NIVEAU_KLEUR[r.niveau])} value={r.niveau} onChange={(e) => zetB(r.id, { niveau: e.target.value as Niveau })}>
                {(Object.keys(NIVEAUS) as Niveau[]).map((n) => <option key={n} value={n}>{NIVEAUS[n].label}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
                <input type="checkbox" checked={r.actief} onChange={(e) => zetB(r.id, { actief: e.target.checked })} /> Actief
              </label>
              <button type="button" aria-label="Verwijderen" className="p-1 text-[var(--color-ink-faint)] hover:text-[#a3271c]" onClick={() => wijzig((c) => ({ ...c, beslissingen: c.beslissingen.filter((x) => x.id !== r.id) }))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </Sectie>

      {/* Controlemomenten */}
      <Sectie
        titel="Werkzaamheden (dagelijks, wekelijks, maandelijks)"
        sub="Koppel aan een bestaande pagina, dan telt het portaal live wat er openstaat. Er worden geen extra taken aangemaakt."
        actie={
          <Button variant="secondary" size="sm" onClick={() => wijzig((c) => ({ ...c, controles: [...c.controles, { id: nieuwId("c"), persoon, frequentie: "wekelijks", titel: "Nieuwe controle", koppeling: null, actief: true }] }))}>
            <Plus className="size-4" /> Controle
          </Button>
        }
      >
        <div className="space-y-2">
          {ctrl.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input className={cn("sc-input min-w-0 flex-1", !r.actief && "opacity-50")} value={r.titel} onChange={(e) => zetC(r.id, { titel: e.target.value })} />
              <select className="sc-input w-[140px]" value={r.frequentie} onChange={(e) => zetC(r.id, { frequentie: e.target.value as Frequentie })}>
                {FREQUENTIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <div className="w-[170px]"><KoppelingKiezer waarde={r.koppeling} onChange={(k) => zetC(r.id, { koppeling: k })} /></div>
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
                <input type="checkbox" checked={r.actief} onChange={(e) => zetC(r.id, { actief: e.target.checked })} /> Actief
              </label>
              <button type="button" aria-label="Verwijderen" className="p-1 text-[var(--color-ink-faint)] hover:text-[#a3271c]" onClick={() => wijzig((c) => ({ ...c, controles: c.controles.filter((x) => x.id !== r.id) }))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </Sectie>

      {/* Afwezigheid */}
      <Sectie titel="Als Jarno afwezig is" sub={`Wat ${naamVan(persoon)} zelfstandig doorzet en wie dan beslist.`}>
        <div key={`${persoon}-${config.bijgewerktOp ?? "voorstel"}`} className="grid gap-3 md:grid-cols-2">
          <Veld label="Dit loopt door (één per regel)">
            <textarea className="sc-input w-full" rows={5} defaultValue={afw.doorloopt.join("\n")}
              onBlur={(e) => wijzig((c) => ({ ...c, afwezigheid: { ...c.afwezigheid, [persoon]: { ...afw, doorloopt: regels(e.target.value) } } }))} />
          </Veld>
          <div className="space-y-3">
            <Veld label="Wie beslist">
              <textarea className="sc-input w-full" rows={3} value={afw.beslisser}
                onChange={(e) => wijzig((c) => ({ ...c, afwezigheid: { ...c.afwezigheid, [persoon]: { ...afw, beslisser: e.target.value } } }))} />
            </Veld>
            <Veld label={`Vervanger als ${naamVan(persoon)} zelf afwezig is`}>
              <PersoonKiezer waarde={afw.vervanger} zonder={persoon}
                onChange={(x) => wijzig((c) => ({ ...c, afwezigheid: { ...c.afwezigheid, [persoon]: { ...afw, vervanger: x } } }))} />
            </Veld>
          </div>
        </div>
      </Sectie>
    </div>
  );
}
