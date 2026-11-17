import "server-only";
import { imapLeads } from "@/server/integrations/imap-leads";
import { MissingCredentialsError } from "@/server/integrations/types";
import { knownMessageIds, loadIntakeContext, processLeadMail } from "@/server/leads/intake";
import { runJob } from "./runner";

/** Hoeveel nog niet verwerkte mails één run maximaal oppakt; de rest volgt in de volgende run. */
const MAX_NEW_PER_RUN = 60;

/**
 * Leest de IMAP-map "LEADS - SHORTCLIPS" van info@shortclips.nl en verwerkt
 * elke nog niet verwerkte mail precies één keer.
 *
 * - Alleen-lezen in de mailbox: er wordt niets verplaatst, gemarkeerd of verwijderd.
 * - De hele map wordt nagelopen (niet alleen de recentste mails), zodat een
 *   aanvraag nooit buiten beeld raakt als de synchronisatie een tijd stil lag.
 * - Welke mails al verwerkt zijn staat in het register (lead_mail_events), op
 *   Message-ID. Opnieuw draaien levert dus nooit dubbele leads op.
 * - Per mail: nieuwe lead, contactmoment bij een bestaande lead, of twijfelgeval
 *   voor handmatige beoordeling (zie src/server/leads/intake.ts).
 * - Ontbreekt de koppeling, dan is dat een fout (status "niet ingesteld") en
 *   geen geslaagde run. Mislukt één mail, dan telt de run als "gedeeltelijk" en
 *   wordt die mail de volgende keer opnieuw geprobeerd.
 * - Draait elk uur via de cron en via de knop "Nu synchroniseren".
 */
export async function runLeadImapSync() {
  return runJob("gmail", "leads.sync_mailbox", {}, async (ctx) => {
    if (!imapLeads.isConfigured) {
      throw new MissingCredentialsError("gmail", ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"]);
    }

    const all = await imapLeads.listMessageIds();
    const known = await knownMessageIds(all.map((m) => m.messageId));
    const todo = all.filter((m) => !known.has(m.messageId));
    const batch = todo.slice(0, MAX_NEW_PER_RUN);
    ctx.counters.processed = batch.length;

    if (!batch.length) {
      ctx.log(`${all.length} mails in map "${imapLeads.folderName}", alles was al verwerkt.`);
      return;
    }

    const messages = await imapLeads.fetchByUids(batch.map((m) => m.uid));
    const intake = await loadIntakeContext();
    let attached = 0;
    let review = 0;
    let ignored = 0;

    for (const msg of messages) {
      try {
        const outcome = await processLeadMail(
          { messageId: msg.messageId, from: msg.from, replyTo: msg.replyTo, subject: msg.subject, date: msg.date, body: msg.body },
          intake,
        );
        if (outcome === "created") ctx.counters.created++;
        else if (outcome === "attached") { attached++; ctx.counters.updated++; }
        else if (outcome === "review") review++;
        else if (outcome === "ignored") ignored++;
      } catch (error) {
        ctx.counters.failed++;
        ctx.log(`Mail ${msg.messageId} niet verwerkt: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    }
    // Opgehaald aantal kan lager zijn dan gevraagd (bericht intussen verplaatst).
    const missing = batch.length - messages.length;
    if (missing > 0) ctx.log(`${missing} mail(s) konden niet worden opgehaald en volgen in de volgende run.`, "warn");

    ctx.log(
      `${all.length} mails in map "${imapLeads.folderName}", ${batch.length} nieuw: ${ctx.counters.created} nieuwe lead(s), ` +
        `${attached} bij bestaande lead, ${review} ter beoordeling, ${ignored} overgeslagen, ${ctx.counters.failed} mislukt` +
        (todo.length > batch.length ? `. Nog ${todo.length - batch.length} te gaan in de volgende run.` : "."),
    );
  });
}
