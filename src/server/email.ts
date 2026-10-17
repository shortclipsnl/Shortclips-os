import "server-only";
import { env } from "@/lib/env";

/**
 * Eén plek voor uitgaande e-mail. Bewust env-gated: zolang er geen
 * RESEND_API_KEY + MAIL_FROM staat, blijft e-mail slapend en geeft de verzender
 * netjes `{ sent: false, reason: "no_provider" }` terug. Zo kan de rest van het
 * platform (notificaties in het portaal) gewoon draaien zonder mailprovider, en
 * gaat mail pas live zodra de sleutel is gezet.
 *
 * Provider: Resend (https://resend.com) via hun HTTP-API — geen extra
 * npm-dependency nodig.
 */

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  /** Platte tekst (verplicht, altijd meegestuurd als fallback). */
  text: string;
  /** Optionele HTML-versie. */
  html?: string;
  /** Reply-to, bijv. de coördinator. */
  replyTo?: string;
};

export type SendEmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: "no_provider" | "error"; error?: string };

export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    return { sent: false, reason: "no_provider" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, reason: "error", error: `${res.status} ${body}`.trim() };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: data.id ?? "" };
  } catch (error) {
    return { sent: false, reason: "error", error: String(error) };
  }
}

/**
 * Simpele, merkvaste HTML-wikkel voor klantmails. Houdt het sober: logo-tekst,
 * titel, bericht en één duidelijke knop naar het portaal.
 */
export function portalEmailHtml(opts: {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}): string {
  const navy = "#00003b";
  const orange = "#FF6A00";
  return `<!doctype html><html lang="nl"><body style="margin:0;background:#f4f5f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:${navy};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;max-width:480px;width:100%;">
        <tr><td style="background:${navy};padding:20px 28px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">ShortClips</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${navy};">${escapeHtml(opts.heading)}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(opts.body)}</p>
          <a href="${escapeAttr(opts.ctaUrl)}" style="display:inline-block;background:${orange};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:10px;">${escapeHtml(opts.ctaLabel)}</a>
        </td></tr>
        <tr><td style="padding:0 28px 28px;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">Je ontvangt deze mail omdat je toegang hebt tot het ShortClips-portaal.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
