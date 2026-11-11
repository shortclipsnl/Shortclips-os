import "server-only";
import { desc, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { vermogenDocs } from "@/db/schema";
import { aiConfigured, aiModelStrong, runPrompt } from "@/server/ai/client";
import { putVermogenDoc } from "./store";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  controleerGetallen,
  parseAdvies,
  type Advies,
  type Feitenblad,
  type Profiel,
} from "./adviseur-core";

/**
 * Mijn Vermogensadviseur: leest het feitenblad dat het vermogensdashboard heeft
 * berekend, laat Claude het maandadvies schrijven, controleert elk getal en
 * bewaart het resultaat als `v/advies/<id>`. Alleen voor de eigenaar; de
 * route-handler en de geplande taak doen de toegangscontrole.
 */

export type AdviesDoc = {
  id: string;
  datum: string; // ISO-tijd van de analyse
  maand: string; // YYYY-MM
  feitenDatum: string;
  model: string | null;
  status: "ok" | "geblokkeerd" | "fout";
  reden: "maand" | "handmatig";
  advies: Advies | null;
  controle: { fouten: string[]; pogingen: number };
  melding?: string;
};

async function leesDoc<T>(path: string): Promise<T | null> {
  const [r] = await db.select({ data: vermogenDocs.data }).from(vermogenDocs).where(eq(vermogenDocs.path, path));
  return (r?.data as T | undefined) ?? null;
}

export async function laatsteAdvies(): Promise<AdviesDoc | null> {
  const rows = await db
    .select({ data: vermogenDocs.data })
    .from(vermogenDocs)
    .where(like(vermogenDocs.path, "v/advies/%"))
    .orderBy(desc(vermogenDocs.path))
    .limit(10);
  const docs = rows.map((r) => r.data as AdviesDoc).filter((d) => d?.status === "ok");
  return docs[0] ?? null;
}

export async function heeftAdviesVoorMaand(maand: string): Promise<boolean> {
  const rows = await db.select({ data: vermogenDocs.data }).from(vermogenDocs).where(like(vermogenDocs.path, `v/advies/${maand}%`));
  return rows.some((r) => (r.data as AdviesDoc | null)?.status === "ok");
}

function nuAmsterdam() {
  const d = new Date();
  const lokaal = d.toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }); // "2026-11-10 14:05:00"
  return { iso: d.toISOString(), dag: lokaal.slice(0, 10), maand: lokaal.slice(0, 7), stempel: `${lokaal.slice(0, 19).replace(/[ :]/g, "-")}-${Math.random().toString(36).slice(2, 5)}` };
}

export async function maakAdvies(reden: AdviesDoc["reden"]): Promise<AdviesDoc> {
  const nu = nuAmsterdam();
  const feiten = await leesDoc<Feitenblad>("v/feiten");
  const cfg = await leesDoc<{ profiel?: Profiel }>("v/cfg");
  const profiel = cfg?.profiel ?? null;
  const basis = { id: nu.stempel, datum: nu.iso, maand: nu.maand, reden, feitenDatum: feiten?.datum ?? "" };

  if (!feiten?.feiten?.length) {
    return { ...basis, model: null, status: "fout", advies: null, controle: { fouten: [], pogingen: 0 }, melding: "Nog geen feitenblad. Open je vermogenspagina één keer, dan worden de cijfers berekend." };
  }
  if (!aiConfigured()) {
    return { ...basis, model: null, status: "fout", advies: null, controle: { fouten: [], pogingen: 0 }, melding: "De Claude-koppeling staat niet aan (ANTHROPIC_API_KEY ontbreekt)." };
  }

  const vorig = (await laatsteAdvies())?.advies ?? null;
  const user = buildUserPrompt(feiten, profiel, vorig);
  const model = aiModelStrong();

  let fouten: string[] = [];
  let advies: Advies | null = null;
  let pogingen = 0;
  let extra = "";
  let melding: string | undefined;
  while (pogingen < 2) {
    pogingen++;
    const res = await runPrompt({ system: SYSTEM_PROMPT, user: user + extra, model, maxTokens: 8000, cacheSystem: true });
    if (!res.ok) {
      melding = res.reason === "no_provider" ? "De Claude-koppeling staat niet aan." : `De analyse lukte niet: ${res.error ?? "onbekende fout"}`;
      break;
    }
    try {
      advies = parseAdvies(res.text);
    } catch (e) {
      fouten = [`Antwoord was geen geldige JSON (${String(e).slice(0, 80)})`];
      extra = "\n\nJe vorige antwoord was geen geldige JSON. Antwoord uitsluitend met het JSON-object.";
      continue;
    }
    fouten = controleerGetallen(advies, feiten, profiel);
    if (!fouten.length) break;
    extra = `\n\nIn je vorige antwoord stonden getallen die niet in het feitenblad of de regels staan:\n- ${fouten.join("\n- ")}\nGebruik alleen getallen die letterlijk in het feitenblad of de regels staan, of laat het getal weg. Schrijf het hele JSON-object opnieuw.`;
  }

  const status: AdviesDoc["status"] = !advies ? "fout" : fouten.length ? "geblokkeerd" : "ok";
  const doc: AdviesDoc = {
    ...basis,
    model,
    status,
    advies,
    controle: { fouten, pogingen },
    melding: melding ?? (status === "geblokkeerd" ? "Het advies is geblokkeerd: niet elk getal kwam overeen met je cijfers. Probeer opnieuw." : undefined),
  };
  await putVermogenDoc(`v/advies/${doc.id}`, doc);
  return doc;
}

/**
 * Geplande maandtaak: maakt het advies als er deze maand nog geen goed advies is
 * en het feitenblad van deze maand is (Jarno heeft na zijn maandexport de
 * vermogenspagina geopend). Anders een herinnering om de pagina te openen.
 */
export async function maandAdviesTaak(): Promise<{ status: string; melding?: string }> {
  const nu = nuAmsterdam();
  if (await heeftAdviesVoorMaand(nu.maand)) return { status: "al gedaan" };
  const feiten = await leesDoc<Feitenblad>("v/feiten");
  if (!feiten?.datum || feiten.datum.slice(0, 7) !== nu.maand) return { status: "wacht op cijfers", melding: "Het feitenblad is nog van een vorige maand." };
  const doc = await maakAdvies("maand");
  return { status: doc.status, melding: doc.melding };
}
