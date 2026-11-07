import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notify } from "@/server/notifications";
import { runJob } from "./runner";

const rows = <T,>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[];

/**
 * Dagelijkse bewaking van de financiële bronnen. Meldt de eigenaar wanneer:
 *  - de Knab-transacties de vorige maand na de 4e nog niet volledig dekken;
 *  - een ingelezen afschrift niet aansluit op het banksaldo;
 *  - de omzet uit DigiBoox of de Kostenmonitor de vorige maand nog niet compleet heeft.
 * Eén melding per probleem per maand (dedupe), zodat het geen ruis wordt.
 */
export async function runFinanceSyncHealth() {
  return runJob("system", "finance.sync_health", {}, async (ctx) => {
    const nu = new Date();
    const lokaal = nu.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
    const dag = Number(lokaal.slice(8, 10));
    const d = new Date(Date.UTC(Number(lokaal.slice(0, 4)), Number(lokaal.slice(5, 7)) - 2, 1));
    const vorige = d.toISOString().slice(0, 7);
    const eindVorige = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);

    const problemen: { key: string; titel: string; tekst: string }[] = [];

    const [bank] = rows<{ dekt: boolean; laatst: string | null }>(
      await db.execute(sql`select
        exists(select 1 from bank_afschriften where van <= ${vorige + "-01"} and tot >= ${eindVorige}) dekt,
        (select max(tot)::text from bank_afschriften) laatst`),
    );
    if (dag >= 4 && !bank?.dekt) {
      problemen.push({
        key: `bank:${vorige}`,
        titel: `Knab-transacties van ${vorige} ontbreken`,
        tekst: `De bankgegevens lopen t/m ${bank?.laatst ?? "nog niets"}. Exporteer in de Knab-app de CAMT.053 van de zakelijke rekening t/m ${eindVorige} en synchroniseer op Financiën, Maandcontrole.`,
      });
    }

    const fout = rows<{ iban: string; van: string; tot: string; controle: string }>(
      await db.execute(sql`select iban, van::text, tot::text, controle from bank_afschriften where controle not like 'sluit%' order by imported_at desc limit 3`),
    );
    for (const f of fout) {
      problemen.push({ key: `aansluiting:${f.iban}:${f.van}:${f.tot}`, titel: "Bankafschrift sluit niet aan", tekst: `${f.iban} ${f.van} t/m ${f.tot}: ${f.controle}` });
    }

    const [boek] = rows<{ at: string | null }>(await db.execute(sql`select max(book_imported_at)::text at from company_finance_months where period = ${vorige}`));
    if (dag >= 4 && (!boek?.at || boek.at.slice(0, 10) <= eindVorige)) {
      problemen.push({ key: `digiboox:${vorige}`, titel: `Omzet ${vorige} uit DigiBoox is niet compleet`, tekst: "Exporteer in DigiBoox de Mutaties over dit jaar en upload die op Financiën." });
    }
    const [kost] = rows<{ at: string | null }>(await db.execute(sql`select max(bijgewerkt)::text at from kosten_regels where maand = ${vorige} and leverancier not like '% (Revolut)'`));
    if (dag >= 4 && (!kost?.at || kost.at <= eindVorige)) {
      problemen.push({ key: `kosten:${vorige}`, titel: `Kosten ${vorige} zijn nog voorlopig`, tekst: "De maandafsluiting van de Kostenmonitor is nog niet verwerkt (wacht op het Knab-afschrift)." });
    }

    let sent = 0;
    for (const p of problemen) {
      sent += await notify({
        roles: ["owner"],
        type: "finance_sync_health",
        level: "warning",
        title: p.titel,
        body: p.tekst,
        href: `/financien/maand?maand=${vorige}`,
        dedupeKey: `finance_sync:${p.key}`,
      });
    }
    ctx.counters.updated += sent;
    ctx.log(problemen.length ? `${problemen.length} probleem/problemen, ${sent} melding(en) verstuurd.` : "Alle financiële bronnen actueel.");
  });
}
