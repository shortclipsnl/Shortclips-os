import "server-only";
import nodemailer from "nodemailer";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { appSettings, users } from "@/db/schema";
import { env } from "@/lib/env";
import { redact } from "@/lib/monitoring-rules";
import { emailConfigured, portalEmailHtml, sendEmail } from "@/server/email";

/**
 * Meldingskanaal van de Koppelingsbewaking: e-mail naar de hoofdbeheerder.
 *
 * Bewust via de eigen mailserver van shortclips.nl (SMTP) en niet via Google:
 * het kanaal mag niet afhangen van de koppeling die het bewaakt. Werkt SMTP
 * niet en is Resend wél ingesteld, dan gaat de mail via Resend.
 *
 * Ontvangers zijn uitsluitend de eigenaar(s) of het vaste adres in
 * MONITOR_ALERT_EMAIL. Klanten, editors en medewerkers krijgen deze mails nooit.
 */

const STATE_KEY = "monitoring.mail";

type MailState = { lastOkAt?: string | null; lastError?: string | null; lastErrorAt?: string | null };

function smtpConfig() {
  const host = env.SMTP_HOST ?? env.IMAP_HOST;
  const user = env.SMTP_USER ?? env.IMAP_USER;
  const pass = env.SMTP_PASSWORD ?? env.IMAP_PASSWORD;
  if (!host || !user || !pass) return null;
  const port = env.SMTP_PORT ?? 465;
  return { host, port, secure: port === 465, auth: { user, pass }, from: user };
}

export async function alertRecipients(): Promise<string[]> {
  if (env.MONITOR_ALERT_EMAIL) {
    return env.MONITOR_ALERT_EMAIL.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const owners = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.primaryRole, "owner"), eq(users.status, "active"), isNull(users.deletedAt)));
  return owners.map((o) => o.email).filter(Boolean);
}

function mask(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "de beheerder";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

async function readState(): Promise<MailState> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, STATE_KEY)).limit(1);
  return (row?.value as MailState) ?? {};
}

async function writeState(patch: MailState): Promise<void> {
  const value = { ...(await readState()), ...patch };
  await db
    .insert(appSettings)
    .values({ key: STATE_KEY, value, category: "monitoring", description: "Status van het meldingskanaal van de Koppelingsbewaking" })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function mailChannel() {
  const [state, recipients] = await Promise.all([readState(), alertRecipients().catch(() => [] as string[])]);
  const configured = Boolean(smtpConfig() || emailConfigured()) && recipients.length > 0;
  return {
    configured,
    via: smtpConfig() ? "mailserver shortclips.nl" : emailConfigured() ? "Resend" : null,
    recipientMasked: recipients.length ? recipients.map(mask).join(", ") : "niemand",
    lastOkAt: state.lastOkAt ?? null,
    lastError: state.lastError ?? null,
    lastErrorAt: state.lastErrorAt ?? null,
  };
}

export type AlertMail = {
  subject: string;
  heading: string;
  /** Regels platte tekst; worden geredigeerd vóór verzending. */
  lines: string[];
  ctaLabel?: string;
  ctaPath?: string;
};

export async function sendAlertMail(mail: AlertMail): Promise<{ ok: boolean; error?: string }> {
  const to = await alertRecipients();
  if (to.length === 0) return { ok: false, error: "Geen ontvanger (geen actieve eigenaar)." };

  const lines = mail.lines.map(redact);
  const url = `${env.APP_URL}${mail.ctaPath ?? "/settings/koppelingsbewaking"}`;
  const text = `${lines.join("\n\n")}\n\n${mail.ctaLabel ?? "Open de Koppelingsbewaking"}: ${url}\n\nDeze mail gaat alleen naar de beheerder van het Shortclips-portaal.`;
  const html = portalEmailHtml({
    heading: mail.heading,
    body: lines.join("\n\n"),
    ctaLabel: mail.ctaLabel ?? "Open de Koppelingsbewaking",
    ctaUrl: url,
  }).replace(
    // Regelovergangen zichtbaar maken in de mail.
    /(<p style="margin:0 0 24px;[^>]*>)([\s\S]*?)(<\/p>)/,
    (_m, a: string, body: string, c: string) => `${a}${body.replace(/\n/g, "<br>")}${c}`,
  ).replace(
    "Je ontvangt deze mail omdat je toegang hebt tot het ShortClips-portaal.",
    "Deze mail gaat alleen naar de beheerder van het Shortclips-portaal.",
  );

  let lastError = "";
  const smtp = smtpConfig();
  if (smtp) {
    try {
      const transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.auth,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 20_000,
      });
      await transport.sendMail({
        from: `Shortclips Portaal <${smtp.from}>`,
        to: to.join(", "),
        subject: mail.subject,
        text,
        html,
        headers: { "X-Shortclips-Monitor": "1" },
      });
      await writeState({ lastOkAt: new Date().toISOString(), lastError: null, lastErrorAt: null });
      return { ok: true };
    } catch (error) {
      // Nooit het wachtwoord of serverdetails in de status: alleen een korte reden.
      lastError = smtpReason(error);
    }
  }

  if (emailConfigured()) {
    const results = await Promise.all(to.map((addr) => sendEmail({ to: addr, subject: mail.subject, html, text })));
    if (results.every((r) => r.sent)) {
      await writeState({ lastOkAt: new Date().toISOString(), lastError: null, lastErrorAt: null });
      return { ok: true };
    }
    lastError = lastError || "Resend weigerde de mail.";
  }

  const error = lastError || "Geen mailkanaal ingesteld.";
  await writeState({ lastError: error, lastErrorAt: new Date().toISOString() });
  return { ok: false, error };
}

function smtpReason(error: unknown): string {
  const e = error as { code?: string; responseCode?: number; command?: string };
  if (e.code === "EAUTH" || e.responseCode === 535) return "inloggen op de mailserver geweigerd (gebruikersnaam of wachtwoord).";
  if (e.code === "ETIMEDOUT" || e.code === "ESOCKET" || e.code === "ECONNECTION") return "mailserver niet bereikbaar (time-out of verbinding geweigerd).";
  if (e.responseCode && e.responseCode >= 500) return `mailserver weigerde het bericht (code ${e.responseCode}).`;
  return "versturen mislukt (onbekende fout).";
}
