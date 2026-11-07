/**
 * Indeling van bankmutaties in de 17 vaste Kostenmonitor-categorieën.
 *
 * Volgorde:
 *  1. Leveranciers die al in de Kostenmonitor staan houden hun bekende
 *     categorie (zelfde naam = zelfde categorie, zodat cijfers aansluiten).
 *  2. Daarna de vaste regels (overgenomen uit kostenmonitor.py).
 *  3. Wat niet herkend wordt komt in "Nog controleren" — nooit stilletjes
 *     als kosten of omzet meegeteld.
 *
 * Geen `server-only`: ook gebruikt door scripts en tests.
 */

export type Indeling = {
  categorie: string;
  /** personeel, editors, freelancers, marketing, vast, operationeel, controle,
   *  prive, belasting, intern (geen kosten), ontvangst (bijschrijving). */
  groep: string;
  soort: "vast" | "variabel" | "eenmalig" | "controle" | "geen";
};

const R = (pat: string, categorie: string, groep: string, soort: Indeling["soort"]) => ({ re: new RegExp(pat, "i"), i: { categorie, groep, soort } });

const INTERN = "klijnsma|jksocials|^shortclips(\\.nl)?$|spaarrekening|eigen woning|inkomstenbelasting opzij|overboeking voor|btw aangifte overboeking|prive overboeking|noodbuffer|btw q\\d";

const AF_REGELS = [
  R(INTERN, "Interne overboeking", "intern", "geen"),
  R("loonaangifte", "Loonheffing", "personeel", "vast"),
  R("belastingdienst.*(h-073|jgd-84|kenteken|motorrijtuig)|h-073-kv|jgd-84-n", "Auto en vervoer", "operationeel", "variabel"),
  R("belastingdienst", "Btw en inkomstenbelasting", "belasting", "geen"),
  R("2421 ventures|zwennes|joybuy|interlinie|j\\.j\\. visser|overeem", "Nog controleren", "controle", "controle"),
  R("hettema|sjoerdsma|batema", "Lonen", "personeel", "vast"),
  R("fabian media|quinn borghart|van den esker|sem van tilburg", "Editors", "editors", "variabel"),
  R("studiopries|hero media|responz|mangre|bureau bont|pillar media|rovideocreations", "Freelancers", "freelancers", "variabel"),
  R("kom beheer|terwisga|mkb coffee|koffievoordeel", "Huur en kantoor", "vast", "vast"),
  R("digiboox|dropbox|wetransfer|moneybird|monday|anthropic|claude|openai|chatgpt|frame\\.io|metricool|pandadoc|atlassian|vimeo|microsoft|google|framer|canva|calendly|heygen|tactiq|skool|vercel|supabase|github", "Software en tools", "vast", "vast"),
  R("de friesland|spotify|viaplay|whoop|sunspot|rimowa|etq amsterdam", "Privé en reserveringen", "prive", "geen"),
  R("allianz|nh1816|turien|centraal beheer|das ned|asr betalings", "Verzekeringen", "vast", "vast"),
  R("boekhalder|^knab|pakketkosten|transactiekosten|revolut", "Boekhouding en bank", "vast", "vast"),
  R("vodafone|youfone|simpel|simyo|odido|kpn", "Telefoon en internet", "vast", "vast"),
  R("esso|shell|tinq|tango|\\bbp\\b|supertank|\\btotal\\b|argos|gulf|avia|texaco|fieten olie|tanqyou|agip|q8|fieldoo|flitsmeister|q.?park|parking|parkeer|carwash", "Auto en vervoer", "operationeel", "variabel"),
  R("vno-ncw|rocket leads|\\bmeta\\b|facebook|linkedin", "Marketing en leads", "marketing", "variabel"),
  R("klm|lufthansa|booking|\\buber\\b|snackbar|grand ?cafe|\\bvati\\b|brasserie|restaurant|febo|jumbo|lidl|albert heijn|\\bhema\\b|stoker|chefke|catering|vieren bij fier", "Reizen en horeca", "operationeel", "variabel"),
  R("coolblue|ikea|gamma|karwei|praxis|\\baction\\b|jysk|bol\\.com|amazon|temu|kabelshop|lumenxl|lampen24|cameranu|easyplants|afium|neon company|horeca bazaar|vendrig|partywinkel|disposable|cookinglife|createyourhome|finexhome|outlet", "Apparatuur en inkopen", "operationeel", "eenmalig"),
];

const BIJ_REGELS = [
  R(INTERN, "Interne overboeking", "intern", "geen"),
  R("belastingdienst", "Belastingteruggave", "belasting", "geen"),
];

/** Bekende leverancier → indeling, opgebouwd uit de Kostenmonitor-historie. */
export type LeverancierIndex = Map<string, Indeling>;

export const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.,]+$/g, "").trim();

export function deelIn(
  t: { bedrag: number; tegenpartij: string; omschrijving: string },
  bekend?: LeverancierIndex,
): Indeling {
  const naam = norm(t.tegenpartij);
  const tekst = `${naam} ${t.omschrijving.toLowerCase()}`;
  if (t.bedrag >= 0) {
    for (const r of BIJ_REGELS) if (r.re.test(naam) || r.re.test(tekst)) return r.i as Indeling;
    return { categorie: "Ontvangst", groep: "ontvangst", soort: "geen" };
  }
  // Interne overboekingen eerst, zodat een bekende naam (bijv. Shortclips) nooit als kosten telt.
  if (AF_REGELS[0]!.re.test(naam) || AF_REGELS[0]!.re.test(tekst)) return AF_REGELS[0]!.i as Indeling;
  const known = naam ? bekend?.get(naam) : undefined;
  if (known) return known;
  for (const r of AF_REGELS) if (r.re.test(naam) || r.re.test(tekst)) return r.i as Indeling;
  return { categorie: "Nog controleren", groep: "controle", soort: "controle" };
}

/** Telt deze afschrijving als bedrijfskosten (zelfde regel als de Kostenmonitor)? */
export const isBedrijfskostGroep = (groep: string) =>
  ["personeel", "editors", "freelancers", "marketing", "vast", "operationeel"].includes(groep);
