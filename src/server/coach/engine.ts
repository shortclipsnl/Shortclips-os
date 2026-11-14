import "server-only";
import { aiConfigured, aiModelStrong, runPrompt } from "@/server/ai/client";
import { agenda, contracten, leadsOverzicht, offerteBewegingen, openOffertes, veilig } from "./data";
import { getDag, getWeek, mergeDag, putDoc, recenteDagen, recenteWeken } from "./store";
import { addDaysIso, isoWeekId, mondayOf } from "./time";
import { WEGING, gewogenScore, type Avond, type CoachDag, type CoachWeek, type EigenInput, type Ochtend, type Onderdeel } from "./types";

const SYSTEEM = `Je bent de persoonlijke businesscoach en groeicontroller van Jarno Klijnsma, eigenaar van Shortclips: een externe short video afdeling voor bedrijven (strategie, concepten, scripts, opnames, editing, resultaten), met vestigingen in Sneek en Amsterdam.

Doel: Shortclips iedere dag winstgevender, commerciëler, efficiënter en schaalbaarder maken. Maandomzetdoel €75.000 tot €80.000; tussendoel €55.000 structureel. Jarno moet uit de operatie (opnamedagen, editing, QC, interne bouwprojecten) en naar sales, positionering, sleutelrelaties en schaal.

Hoofdregel: iedere werkdag moet bijdragen aan winst, sales of structurele vooruitgang. Druk zijn is geen prestatie. Beoordeel op zakelijke impact, niet op hoeveelheid werk.

Houding: eerlijk, zakelijk, kritisch, resultaatgericht. Geen complimenten voor hard werken. Confronteer als tijd naar details of interne systemen gaat terwijl commerciële kansen blijven liggen. Geef bij kritiek altijd de betere actie. Dwing prioriteiten af.

Feitelijkheid: gebruik uitsluitend de aangeleverde gegevens en wat Jarno zelf invult. Verzin nooit cijfers, namen, gesprekken of uitkomsten. Wat niet blijkt is "onbekend" of "impact niet bewezen". Een verstuurde offerte is geen omzet. Scheid activiteit, commerciële voortgang en gerealiseerd resultaat. De agenda bevat ook afspraken van teamleden: noem geen privédetails van medewerkers.

Stijl: Nederlands, informeel maar zakelijk, kort en concreet, geen emoji, geen gedachtestreepjes (geen em dash of en dash). Antwoord uitsluitend met geldige JSON volgens het gevraagde schema, zonder tekst eromheen.`;

function parseJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Geen JSON in het antwoord van de coach.");
  return JSON.parse(text.slice(start, end + 1)) as T;
}

const zonderStreepjes = (s: unknown) => String(s ?? "").replace(/\s*[–—]\s*/g, ", ").trim();

async function vraag<T>(user: string, maxTokens = 6000): Promise<{ data: T; model: string }> {
  if (!aiConfigured()) throw new Error("De Claude-koppeling staat niet aan (ANTHROPIC_API_KEY ontbreekt).");
  const model = aiModelStrong();
  let laatsteFout = "";
  for (let poging = 0; poging < 2; poging++) {
    const res = await runPrompt({ system: SYSTEEM, user: poging ? `${user}\n\nLet op: je vorige antwoord was geen geldige JSON. Geef alleen het JSON-object.` : user, model, maxTokens, cacheSystem: true });
    if (!res.ok) throw new Error(res.error ?? "Coach kon geen antwoord maken.");
    try {
      return { data: parseJson<T>(res.text), model: res.model };
    } catch (e) {
      laatsteFout = e instanceof Error ? e.message : "ongeldige JSON";
    }
  }
  throw new Error(laatsteFout);
}

function compactDag(d: CoachDag) {
  return {
    datum: d.datum,
    acties: d.ochtend?.acties?.map((a) => ({ wat: a.wat, klaarAls: a.klaarAls, status: a.status ?? "open" })),
    score: d.avond?.gewogen ?? null,
    status: d.avond?.status ?? null,
    verspild: d.avond?.verspild,
    gemisteKans: d.avond?.gemisteKans,
    actieMorgen: d.avond?.actieMorgen,
    eigenInput: d.input ? { gedaan: d.input.gedaan, uitkomsten: d.input.uitkomsten } : null,
  };
}

/* ------------------------------ Ochtend ------------------------------ */

export async function maakOchtend(datum: string): Promise<Ochtend> {
  const [offertes, leads, agendaItems, contract, vorige] = await Promise.all([
    veilig("Offertes", openOffertes),
    veilig("Leads", () => leadsOverzicht(addDaysIso(datum, -6), datum)),
    veilig("Agenda", () => agenda(datum, addDaysIso(datum, 1))),
    veilig("Contracten", contracten),
    recenteDagen(6),
  ]);
  const user = `OCHTENDCONTROLE voor ${datum}.

Gegevens uit het portaal (JSON):
${JSON.stringify({ openOffertes: offertes, leads, agendaVandaagEnMorgen: agendaItems, contracten: contract, vorigeDagen: vorige.filter((d) => d.datum !== datum).map(compactDag) })}

Opdracht: kies de drie acties die vandaag de grootste bijdrage leveren aan winst, omzet of strategische groei, gerangschikt. Elke actie concreet en meetbaar (klaar-als = wat er vandaag aantoonbaar moet staan). Neem de "actieMorgen" van gisteren mee als die nog niet gedaan is. Benoem welke prospects of offertes vandaag opgevolgd moeten worden, welke beslissingen al langer openstaan en de groei blokkeren, en welke operationele blokken in de agenda naar het team kunnen. Is de agenda vooral operationeel, zeg dat hard in "waarschuwing".

Schema:
{"kern": "één zin waar de dag om draait",
 "acties": [{"wat": "...", "waarom": "zakelijke impact in één zin", "klaarAls": "meetbaar resultaat vandaag", "tijd": "geschatte tijd"}],
 "opvolging": "korte alinea met namen en reden",
 "blokkades": "korte alinea",
 "delegeren": "korte alinea",
 "waarschuwing": "lege string of één harde zin"}`;
  const { data, model } = await vraag<Omit<Ochtend, "gemaaktOp" | "model">>(user);
  const ochtend: Ochtend = {
    kern: zonderStreepjes(data.kern),
    acties: (data.acties ?? []).slice(0, 3).map((a) => ({ wat: zonderStreepjes(a.wat), waarom: zonderStreepjes(a.waarom), klaarAls: zonderStreepjes(a.klaarAls), tijd: zonderStreepjes(a.tijd), status: "open" as const })),
    opvolging: zonderStreepjes(data.opvolging),
    blokkades: zonderStreepjes(data.blokkades),
    delegeren: zonderStreepjes(data.delegeren),
    waarschuwing: zonderStreepjes(data.waarschuwing) || undefined,
    gemaaktOp: new Date().toISOString(),
    model,
  };
  await mergeDag(datum, { ochtend });
  return ochtend;
}

/* ------------------------------- Avond ------------------------------- */

type AvondAntwoord = {
  scores: Record<Onderdeel, { score: number; bewijs: string }>;
  actieStatus: Avond["actieStatus"];
  bereikt: string;
  verspild: string;
  gemisteKans: string;
  actieMorgen: string;
  patroon?: string;
  vragen?: string[];
};

export async function maakAvond(datum: string, input?: EigenInput): Promise<Avond> {
  const dag = (await getDag(datum)) ?? { datum };
  const eigen = input ?? dag.input;
  const [beweging, agendaItems, leads, vorige] = await Promise.all([
    veilig("Offertebewegingen", () => offerteBewegingen(datum, datum)),
    veilig("Agenda", () => agenda(datum, datum)),
    veilig("Leads", () => leadsOverzicht(datum, datum)),
    recenteDagen(7),
  ]);
  const user = `AVONDCONTROLE voor ${datum}.

Ochtendacties van vandaag: ${JSON.stringify(dag.ochtend?.acties ?? "geen ochtendcontrole gemaakt")}
Eigen input van Jarno: ${eigen ? JSON.stringify(eigen) : "nog niet ingevuld"}
Gegevens uit het portaal: ${JSON.stringify({ offertesVandaag: beweging, agendaVandaag: agendaItems, leadsVandaag: leads && "periode" in leads ? leads.periode : leads })}
Vorige dagen (voor patronen): ${JSON.stringify(vorige.filter((d) => d.datum !== datum).map(compactDag))}

Opdracht: geef per onderdeel een score 1 tot 10 met in één zin het bewijs: sales (Sales en nieuwe omzet: leads benaderd, gesprekken, offertes opgevolgd, kansen, omzet), winst (marges, kosten, prijzen, omzet per klant), strategie (positionering, onderscheidend vermogen, nieuwe groeimogelijkheden), team (processen, overdracht, minder afhankelijkheid van Jarno), effectiviteit (tijd aan de hoogste impact). Zonder bewijs: lage score en "impact niet bewezen". Beoordeel elke ochtendactie. Benoem concreet waar tijd is verspild en wie het had moeten doen. Noem een patroon als het in vorige dagen terugkomt. Ontbreekt de eigen input, stel maximaal drie gerichte vragen.

Schema:
{"scores": {"sales": {"score": 1-10, "bewijs": "..."}, "winst": {...}, "strategie": {...}, "team": {...}, "effectiviteit": {...}},
 "actieStatus": [{"wat": "...", "status": "gehaald|deels|niet|onbekend", "toelichting": "..."}],
 "bereikt": "...", "verspild": "...", "gemisteKans": "...", "actieMorgen": "de ene actie met de meeste impact morgen",
 "patroon": "lege string of patroon", "vragen": ["..."]}`;
  const { data, model } = await vraag<AvondAntwoord>(user);
  const scores = {} as Avond["scores"];
  for (const k of Object.keys(WEGING) as Onderdeel[]) {
    const s = data.scores?.[k];
    scores[k] = { score: Math.max(1, Math.min(10, Math.round(Number(s?.score ?? 1)))), bewijs: zonderStreepjes(s?.bewijs || "Impact niet bewezen.") };
  }
  const avond: Avond = {
    scores,
    gewogen: gewogenScore(scores),
    actieStatus: (data.actieStatus ?? []).map((a) => ({ ...a, wat: zonderStreepjes(a.wat), toelichting: zonderStreepjes(a.toelichting) })),
    bereikt: zonderStreepjes(data.bereikt),
    verspild: zonderStreepjes(data.verspild),
    gemisteKans: zonderStreepjes(data.gemisteKans),
    actieMorgen: zonderStreepjes(data.actieMorgen),
    patroon: zonderStreepjes(data.patroon) || undefined,
    vragen: eigen ? [] : (data.vragen ?? []).slice(0, 3).map(zonderStreepjes),
    status: eigen ? "definitief" : "voorlopig",
    gemaaktOp: new Date().toISOString(),
    model,
  };
  // Status van de ochtendacties bijwerken op basis van de beoordeling.
  const ochtend = dag.ochtend
    ? {
        ...dag.ochtend,
        acties: dag.ochtend.acties.map((a, i) => {
          const st = avond.actieStatus[i]?.status;
          return st && st !== "onbekend" ? { ...a, status: st } : a;
        }),
      }
    : undefined;
  await mergeDag(datum, { avond, ...(input ? { input } : {}), ...(ochtend ? { ochtend } : {}) });
  return avond;
}

/* -------------------------------- Week ------------------------------- */

type WeekAntwoord = {
  rapport: Array<{ titel: string; tekst: string }>;
  prioriteiten: Array<{ wat: string; klaarAls: string }>;
  waarheid: string;
  aanvullingCijfers?: Array<{ laag: "activiteit" | "voortgang" | "gerealiseerd"; label: string; waarde: string }>;
};

export async function maakWeek(datum: string): Promise<CoachWeek> {
  const van = mondayOf(datum);
  const tot = addDaysIso(van, 4);
  const id = isoWeekId(datum);
  const dagen = (await recenteDagen(14)).filter((d) => d.datum >= van && d.datum <= tot).sort((a, b) => a.datum.localeCompare(b.datum));
  const [beweging, leads, open, contract, vorigeWeken] = await Promise.all([
    veilig("Offertebewegingen", () => offerteBewegingen(van, tot)),
    veilig("Leads", () => leadsOverzicht(van, tot)),
    veilig("Offertes", openOffertes),
    veilig("Contracten", contracten),
    recenteWeken(5),
  ]);

  const dagscores = dagen.map((d) => ({ datum: d.datum, score: d.avond?.gewogen ?? null }));
  const gescoord = dagscores.filter((d) => d.score != null) as Array<{ datum: string; score: number }>;
  const gemiddelde = gescoord.length ? Math.round((gescoord.reduce((s, d) => s + d.score, 0) / gescoord.length) * 10) / 10 : null;

  const b = "fout" in beweging ? null : beweging;
  const l = "fout" in leads ? null : leads;
  const c = "fout" in contract ? null : contract;
  const o = "fout" in open ? null : open;
  const sumInput = (k: "salesgesprekken" | "offertesOpgevolgd") => {
    const vals = dagen.map((d) => d.input?.[k]).filter((v): v is number => typeof v === "number");
    return vals.length ? String(vals.reduce((s, v) => s + v, 0)) + (vals.length < dagen.length ? " (niet elke dag ingevuld)" : "") : "onbekend, vul aan";
  };
  const fmt = (n: number) => `€${n.toLocaleString("nl-NL")}`;
  const cijfers: CoachWeek["cijfers"] = {
    activiteit: [
      { label: "Nieuwe leads", waarde: l ? String(l.periode.nieuweLeads) : "onbekend" },
      { label: "Gevoerde salesgesprekken", waarde: sumInput("salesgesprekken") },
      { label: "Verzonden offertes", waarde: b ? `${b.verzonden.aantal} (${fmt(b.verzonden.bedrag)} excl. btw)` : "onbekend" },
      { label: "Opgevolgde offertes", waarde: sumInput("offertesOpgevolgd") },
    ],
    voortgang: [
      { label: "Openstaande offertes", waarde: o ? `${o.length} (${fmt(o.reduce((s, q) => s + q.bedragExBtw, 0))} excl. btw)` : "onbekend" },
      { label: "Open leads in de pijplijn", waarde: l ? String(l.open.length) : "onbekend" },
      { label: "Contracten binnenkort aflopend", waarde: c ? String(c.binnenkortAflopend) : "onbekend" },
    ],
    gerealiseerd: [
      { label: "Getekende offertes", waarde: b ? `${b.getekend.aantal} (${fmt(b.getekend.bedrag)} excl. btw)` : "onbekend" },
      { label: "Nieuwe klanten (lead gewonnen)", waarde: l ? String(l.periode.gewonnen) : "onbekend" },
      { label: "Verloren leads of klanten", waarde: l ? String(l.periode.verloren) : "onbekend" },
      { label: "Totale terugkerende omzet (contracten)", waarde: c ? `${fmt(c.maandelijkseContractomzet)} p/m` : "onbekend" },
      { label: "Brutomarge", waarde: "onbekend, zie Winstgevendheid" },
    ],
  };

  const user = `WEKELIJKS ONDERNEMERSRAPPORT ${id} (${van} t/m ${tot}).

Dagen van deze week: ${JSON.stringify(dagen.map(compactDag))}
Gemiddelde score: ${gemiddelde ?? "onbekend"}
Salescijfers (berekend uit het portaal en Jarno's eigen input): ${JSON.stringify(cijfers)}
Offertebewegingen: ${JSON.stringify(beweging)}
Contracten: ${JSON.stringify(contract)}
Vorige weken: ${JSON.stringify(vorigeWeken.filter((w) => w.id !== id).map((w) => ({ id: w.id, score: w.gemiddeldeScore, prioriteiten: w.prioriteiten, waarheid: w.waarheid })))}

Opdracht: schrijf het rapport in precies deze tien onderdelen, elk een korte alinea: 1 Gemiddelde ondernemersscore (met vergelijking met vorige weken), 2 Drie belangrijkste zakelijke resultaten, 3 Omzetgroei en commerciële voortgang, 4 Verbeteringen in winstgevendheid, 5 Structurele verbeteringen (scheid korte termijn omzet en lange termijn bedrijfswaarde), 6 Tijdverspilling en afleiding, 7 Taken die gedelegeerd hadden moeten worden, 8 Kansen die zijn blijven liggen, 9 Belangrijkste les van de week, 10 Drie hoogste prioriteiten voor volgende week. Toets de prioriteiten van vorige week. Sluit af met één ongemakkelijke waarheid, onderbouwd met bewijs.

Schema:
{"rapport": [{"titel": "1 Gemiddelde ondernemersscore", "tekst": "..."}, ... tien items],
 "prioriteiten": [{"wat": "...", "klaarAls": "..."}],
 "waarheid": "..."}`;
  const { data, model } = await vraag<WeekAntwoord>(user, 8000);
  const week: CoachWeek = {
    id,
    van,
    tot,
    gemiddeldeScore: gemiddelde,
    dagscores,
    cijfers,
    rapport: (data.rapport ?? []).map((r) => ({ titel: zonderStreepjes(r.titel), tekst: zonderStreepjes(r.tekst) })),
    prioriteiten: (data.prioriteiten ?? []).slice(0, 3).map((p) => ({ wat: zonderStreepjes(p.wat), klaarAls: zonderStreepjes(p.klaarAls) })),
    waarheid: zonderStreepjes(data.waarheid),
    gemaaktOp: new Date().toISOString(),
    model,
  };
  await putDoc(`week/${id}`, week);
  return week;
}

export { getDag, getWeek };
