import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { env } from "@/lib/env";
import { IntegrationError, MissingCredentialsError, type ConnectionTest } from "./types";

/**
 * Lead-import via IMAP — info@shortclips.nl (Cloud86/Plesk, mail.shortclips.nl).
 *
 * De website-leads (Framer-contactformulier, Rocket Leads) komen binnen op
 * info@shortclips.nl en worden in de serverfolder "LEADS - SHORTCLIPS" gesorteerd.
 * Deze koppeling leest die map en zet nieuwe mails om in leads. Alleen-lezen: er
 * wordt niets verplaatst, gemarkeerd of verwijderd in de mailbox.
 *
 * Dedup gebeurt op Message-ID (salesLeads.externalId) in de job zelf.
 */
const DEFAULT_FOLDER = "LEADS - SHORTCLIPS";

export type ImapLeadMessage = {
  messageId: string;
  from: string | null;
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  date: Date | null;
  body: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export class ImapLeadsService {
  constructor(
    private host = env.IMAP_HOST,
    private port = env.IMAP_PORT ?? 993,
    private user = env.IMAP_USER,
    private password = env.IMAP_PASSWORD,
    private folder = env.IMAP_LEADS_FOLDER || DEFAULT_FOLDER,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.host && this.user && this.password);
  }

  /** De doelmapnaam (voor meldingen). */
  get folderName(): string {
    return this.folder || DEFAULT_FOLDER;
  }

  private newClient(): ImapFlow {
    if (!this.isConfigured) {
      throw new MissingCredentialsError("gmail", ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"]);
    }
    const port = this.port ?? 993;
    return new ImapFlow({
      host: this.host!,
      port,
      secure: port === 993, // 993 = TLS; 143 = STARTTLS (wordt automatisch opgewaardeerd)
      auth: { user: this.user!, pass: this.password! },
      logger: false,
      socketTimeout: 20_000,
    });
  }

  /** Zoekt de map hoofdletterongevoelig; geeft het echte pad terug of null. */
  private async resolveFolder(client: ImapFlow): Promise<{ path: string | null; available: string[] }> {
    const list = await client.list();
    const available = list.map((m) => m.path);
    const target = this.folderName.toLowerCase();
    const path =
      available.find((n) => n.toLowerCase() === target) ??
      available.find((n) => n.toLowerCase().endsWith(`/${target}`)) ??
      null;
    return { path, available };
  }

  async testConnection(): Promise<ConnectionTest> {
    if (!this.isConfigured) {
      return { ok: false, message: "Nog niet ingesteld: IMAP_HOST, IMAP_USER en IMAP_PASSWORD ontbreken." };
    }
    const client = this.newClient();
    try {
      await client.connect();
      const { path, available } = await this.resolveFolder(client);
      if (!path) {
        const shown = available.slice(0, 12).join(", ");
        return {
          ok: false,
          message: `Verbonden met ${this.user}, maar map "${this.folderName}" niet gevonden. Beschikbare mappen: ${shown}${available.length > 12 ? "…" : ""}. Pas IMAP_LEADS_FOLDER aan.`,
        };
      }
      const lock = await client.getMailboxLock(path);
      try {
        const count = typeof client.mailbox === "object" ? client.mailbox.exists : 0;
        return { ok: true, message: `Verbonden met ${this.user} · map "${path}" (${count} bericht(en)).` };
      } finally {
        lock.release();
      }
    } catch (e) {
      return { ok: false, message: this.toUserMessage(e), detail: { error: e instanceof Error ? e.message : String(e) } };
    } finally {
      await client.logout().catch(() => {});
    }
  }

  /** De recentste berichten uit de leadsmap (nieuwste eerst), als platte tekst. */
  async fetchFolderMessages(max = 80): Promise<ImapLeadMessage[]> {
    if (!this.isConfigured) {
      throw new MissingCredentialsError("gmail", ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"]);
    }
    const client = this.newClient();
    const out: ImapLeadMessage[] = [];
    try {
      await client.connect();
      const { path } = await this.resolveFolder(client);
      if (!path) {
        throw new IntegrationError("gmail", `Map "${this.folderName}" niet gevonden in de mailbox.`, 404, false);
      }
      const lock = await client.getMailboxLock(path);
      try {
        const total = typeof client.mailbox === "object" ? client.mailbox.exists : 0;
        if (!total) return [];
        // De laatste `max` berichten op volgnummer (hoogste = nieuwste).
        const start = Math.max(1, total - max + 1);
        for await (const msg of client.fetch(`${start}:*`, { source: true, uid: false })) {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const addr = parsed.from?.value?.[0];
          const body = parsed.text && parsed.text.trim() ? parsed.text : parsed.html ? stripHtml(parsed.html) : "";
          out.push({
            messageId: (parsed.messageId ?? `imap:${path}:${msg.seq}`).trim(),
            from: parsed.from?.text ?? null,
            fromName: addr?.name || null,
            fromEmail: addr?.address || null,
            subject: parsed.subject ?? null,
            date: parsed.date ?? null,
            body,
          });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
    out.reverse(); // nieuwste eerst
    return out;
  }

  private toUserMessage(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e);
    if (/authenticat|login|credential|AUTHENTICATIONFAILED/i.test(m)) {
      return "Inloggen op de mailbox mislukt. Controleer IMAP_USER en IMAP_PASSWORD (gebruik een mail-/app-wachtwoord uit Plesk).";
    }
    if (/certificate|self.signed|tls|ssl/i.test(m)) {
      return "Beveiligde verbinding mislukt. Controleer IMAP_HOST en IMAP_PORT (993 voor TLS).";
    }
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|getaddrinfo/i.test(m)) {
      return "Kon de mailserver niet bereiken. Controleer IMAP_HOST en IMAP_PORT.";
    }
    return "Verbinden met de mailbox mislukt. Controleer de IMAP-instellingen.";
  }
}

export const imapLeads = new ImapLeadsService();
