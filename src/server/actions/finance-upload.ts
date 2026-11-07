"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requirePermission, ForbiddenError } from "@/server/auth/context";
import { readXlsx } from "@/lib/xlsx";
import { isCamt053 } from "@/server/bank/camt";
import { importCamtBestand } from "@/server/bank/import";
import { parseRevolutAfschriftTekst, parseRevolutCsv, revolutNaarKosten, type RevolutTx } from "@/server/bank/revolut";
import { importDigibooxSheets } from "@/server/bank/digiboox-core";
import { werkAfgeleideCijfersBij } from "@/server/bank/afgeleid";

export type FinanceUploadResult = { ok: boolean; regels: string[]; fouten: string[] };

const MAX_BYTES = 15 * 1024 * 1024;
const PADEN = ["/financien", "/financien/maand", "/kosten", "/winstgevendheid", "/dashboard/vermogen"];

/**
 * Eén ingang voor alle financiële exports. Herkent zelf het soort bestand:
 *  - Knab CAMT.053 (.xml)            → transacties, saldi, Kostenmonitor van afgesloten maanden
 *  - Revolut afschrift (PDF of CSV)  → zakelijke abonnementen als kosten, saldo in vermogen
 *  - DigiBoox (.xlsx)                → omzet per maand, balans (debiteuren, crediteuren, btw)
 * Daarna worden vermogensdashboard en omzetprognose bijgewerkt. Alles idempotent:
 * hetzelfde bestand opnieuw toevoegen verandert niets. Uitsluitend de eigenaar.
 */
export async function importFinancieleExports(formData: FormData): Promise<FinanceUploadResult> {
  let viewer;
  try {
    viewer = await requirePermission("finance:write");
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, regels: [], fouten: [e.message] };
    throw e;
  }
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, regels: [], fouten: ["Geen bestand gekozen."] };

  const regels: string[] = [];
  const fouten: string[] = [];
  const camt: { naam: string; inhoud: string }[] = [];
  const revolut: RevolutTx[] = [];
  let revolutSaldo: { bedrag: number; datum: string } | null = null;
  const digiboox: { name: string; sheets: ReturnType<typeof readXlsx> }[] = [];

  for (const f of files) {
    const naam = f.name.replace(/\.revolut-tekst\.txt$/i, "");
    if (f.size > MAX_BYTES) {
      fouten.push(`${naam}: te groot.`);
      continue;
    }
    try {
      if (/\.revolut-tekst\.txt$/i.test(f.name)) {
        const r = parseRevolutAfschriftTekst(await f.text());
        revolut.push(...r.tx);
        if (r.eindsaldo != null && r.einddatum && (!revolutSaldo || r.einddatum > revolutSaldo.datum)) revolutSaldo = { bedrag: r.eindsaldo, datum: r.einddatum };
        fouten.push(...r.waarschuwingen.map((w) => `${naam}: ${w}`));
        regels.push(`${naam}: Revolut-afschrift, ${r.tx.length} transacties gelezen.`);
      } else if (/\.xml$/i.test(f.name)) {
        const inhoud = await f.text();
        if (!isCamt053(inhoud)) throw new Error("geen Knab CAMT.053-bestand.");
        camt.push({ naam, inhoud });
      } else if (/\.csv$/i.test(f.name)) {
        const tx = parseRevolutCsv(await f.text());
        revolut.push(...tx);
        regels.push(`${naam}: Revolut CSV, ${tx.length} transacties gelezen.`);
      } else if (/\.xlsx$/i.test(f.name)) {
        digiboox.push({ name: naam, sheets: readXlsx(Buffer.from(await f.arrayBuffer())) });
      } else if (/\.txt$/i.test(f.name) && /^\{1:|^:20:/m.test((await f.text()).slice(0, 200))) {
        regels.push(`${naam}: MT940 overgeslagen. Gebruik de CAMT.053-export van Knab, die bevat dezelfde boekingen met unieke referenties.`);
      } else if (/\.pdf$/i.test(f.name)) {
        fouten.push(`${naam}: deze PDF kon niet worden gelezen. Alleen het Revolut-afschrift wordt als PDF ondersteund.`);
      } else {
        fouten.push(`${naam}: onbekend bestandstype.`);
      }
    } catch (err) {
      fouten.push(`${naam}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 1. Bank eerst: daarop bouwen de Kostenmonitor en de saldi.
  for (const c of camt) {
    try {
      const r = await importCamtBestand(db, c.naam, c.inhoud);
      for (const a of r.afschriften) {
        regels.push(`Knab ${a.rekeningNaam || ""} ${a.iban} ${a.van} t/m ${a.tot}: ${a.nieuw} nieuw, ${a.alAanwezig} al aanwezig, ${a.controle}.`);
      }
      for (const k of r.kosten) if (k.regels) regels.push(`Kostenmonitor ${k.maand}: bijgewerkt uit de bank (${k.regels} regels).`);
    } catch (err) {
      fouten.push(`${c.naam}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // 2. Revolut: alleen zakelijke software telt mee.
  if (revolut.length) {
    for (const r of await revolutNaarKosten(db, revolut)) regels.push(`Revolut ${r.maand}: ${r.regels} zakelijke abonnementen, ${r.totaal} euro.`);
  }
  // 3. DigiBoox: omzet en balans.
  if (digiboox.length) {
    const r = await importDigibooxSheets(db, digiboox, viewer.id);
    if (r.months.length) regels.push(`DigiBoox: omzet bijgewerkt voor ${r.months.length} maanden (${r.months[0]!.period} t/m ${r.months.at(-1)!.period}).`);
    if (r.balans) regels.push("DigiBoox: balans opgeslagen (openstaande facturen, crediteuren, btw).");
    for (const f of r.files) if (!r.months.length && !r.balans) fouten.push(`${f.name}: ${f.warnings.join(" ") || "geen bruikbare gegevens."}`);
  }
  // 4. Alles wat ervan afhangt.
  if (camt.length || revolut.length || digiboox.length) {
    regels.push(...(await werkAfgeleideCijfersBij(db, { revolut: revolutSaldo })));
  }

  for (const p of PADEN) revalidatePath(p);
  return { ok: regels.length > 0 && fouten.length === 0, regels, fouten };
}
