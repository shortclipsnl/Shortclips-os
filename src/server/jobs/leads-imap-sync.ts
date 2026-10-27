import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { salesLeads, users } from "@/db/schema";
import { imapLeads } from "@/server/integrations/imap-leads";
import { parseLeadEmail } from "@/server/leads/mail-parser";
import { dispatch } from "@/server/automation";
import { runJob } from "./runner";

/** Hoeveel berichten per run uit de map worden gelezen (dedup voorkomt dubbel). */
const MAX_PER_RUN = 80;

/**
 * Leest de IMAP-serverfolder "LEADS - SHORTCLIPS" van info@shortclips.nl
 * (Cloud86/Plesk, mail.shortclips.nl) en zet contactformulier-mails om in leads
 * op de Leads-pagina.
 *
 * - Alleen-lezen: er wordt niets verplaatst, gemarkeerd of verwijderd.
 * - Dubbele import voorkomen via de unieke Message-ID (externalId) + onConflictDoNothing.
 * - Nieuwe leads krijgen status "lead", bron "Website contactformulier" en worden
 *   toegewezen aan de eigenaar. Bestaande leads blijven onaangeroerd.
 * - Verzint niets: ontbrekende velden blijven leeg.
 * - Draait via de cron en via de knop "Nu synchroniseren".
 */
export async function runLeadImapSync() {
  return runJob("gmail", "leads.sync_mailbox", {}, async (ctx) => {
    if (!imapLeads.isConfigured) {
      ctx.log("IMAP-koppeling niet geconfigureerd (IMAP_HOST/IMAP_USER/IMAP_PASSWORD). Lead-import overgeslagen.");
      return;
    }

    // Verantwoordelijke voor nieuwe leads = de eigenaar (rolgebaseerd).
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt)))
      .limit(1);
    const ownerId = owner?.id ?? null;

    const messages = await imapLeads.fetchFolderMessages(MAX_PER_RUN);
    ctx.counters.processed = messages.length;

    for (const msg of messages) {
      const parsed = parseLeadEmail({ subject: msg.subject, body: msg.body, fromName: msg.fromName, fromEmail: msg.fromEmail });

      // Zonder enig bruikbaar gegeven slaan we het bericht over (geen lege leads).
      if (!parsed.company && !parsed.email && !parsed.phone && !parsed.contactName) continue;

      const company = (parsed.company ?? parsed.contactName ?? (parsed.email ? parsed.email.split("@")[1] ?? "Onbekende lead" : "Onbekende lead")).slice(0, 200);
      const contactName = parsed.contactName && parsed.contactName.toLowerCase() !== company.toLowerCase() ? parsed.contactName : null;
      const firstContactOn = (msg.date && !isNaN(msg.date.getTime()) ? msg.date : new Date()).toISOString().slice(0, 10);

      const inserted = await db
        .insert(salesLeads)
        .values({
          company,
          contactName,
          email: parsed.email,
          phone: parsed.phone,
          website: parsed.website,
          source: "Website contactformulier",
          status: "lead",
          segment: String(new Date().getFullYear()),
          note: parsed.message ?? "Automatisch geïmporteerd uit de mailbox (contactformulier).",
          firstContactOn,
          ownerId,
          externalId: msg.messageId,
        })
        .onConflictDoNothing()
        .returning({ id: salesLeads.id });

      // Leeg = al eerder geïmporteerd (dedup op Message-ID) → overslaan.
      if (!inserted[0]) continue;
      ctx.counters.created++;

      // Nieuwe lead → melding naar de eigenaar + bovenaan het overzicht.
      await dispatch({
        trigger: "lead.created",
        entityType: "sales_lead",
        entityId: inserted[0].id,
        data: { to: "lead", href: "/leads" },
      }).catch(() => {});
    }

    ctx.log(`${messages.length} mails bekeken, ${ctx.counters.created} nieuwe lead(s) geïmporteerd uit map "${imapLeads.folderName}".`);
  });
}
