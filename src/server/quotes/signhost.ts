import "server-only";
import { env } from "@/lib/env";

/**
 * Signhost/Evidos (Entrust Signhost) — gekwalificeerde e-handtekening (QES).
 *
 * Flow (zie developer.signhost.com): transactie aanmaken met een signer en een
 * postback-URL → het offerte-PDF uploaden → transactie starten (stuurt de
 * uitnodiging) → de signer naar de SignUrl sturen. Signhost meldt de voortgang
 * via de postback (webhook); bij Status 30 (signed) halen we het ondertekende
 * document + het ontvangstbewijs op. We pollen níet.
 *
 * LET OP: de exacte velden/paden moeten in de sandbox geverifieerd worden
 * voordat dit live gaat — dit is nog niet tegen een echte Signhost-omgeving
 * getest. Zonder SIGNHOST_API_KEY/SIGNHOST_APP_KEY is de koppeling uit en valt
 * de offerte terug op alleen digitaal accepteren.
 */

const BASE = "https://api.signhost.com";

export function signhostConfigured(): boolean {
  return !!(env.SIGNHOST_API_KEY && env.SIGNHOST_APP_KEY);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `APIKey ${env.SIGNHOST_API_KEY}`,
    Application: `APPKey ${env.SIGNHOST_APP_KEY}`,
    ...extra,
  };
}

export type SignhostStart = { transactionId: string; fileId: string; signUrl: string | null };

/**
 * Maakt een transactie met één signer (de contactpersoon), upload het offerte-
 * PDF, start de transactie en geeft de SignUrl terug om de klant heen te sturen.
 */
export async function startSignhostSigning(input: {
  pdf: Uint8Array | Buffer;
  fileName: string;
  signerEmail: string;
  signerName?: string;
  postbackUrl: string;
  requireQualified?: boolean;
}): Promise<SignhostStart> {
  if (!signhostConfigured()) throw new Error("Signhost is niet geconfigureerd.");
  const fileId = `offerte-${Date.now()}`;

  // 1) Transactie aanmaken (signer + postback). QES via identiteitsverificatie.
  const createRes = await fetch(`${BASE}/api/transaction`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      Signers: [
        {
          Email: input.signerEmail,
          ...(input.signerName ? { SignerName: input.signerName } : {}),
          SendSignRequest: false, // wij sturen de klant zelf naar de SignUrl
          // QES vereist identiteitsverificatie; in de sandbox te kalibreren.
          ...(input.requireQualified ? { Verifications: [{ Type: "Consent" }] } : {}),
        },
      ],
      PostbackUrl: input.postbackUrl,
    }),
  });
  if (!createRes.ok) throw new Error(`Signhost: transactie aanmaken mislukt (${createRes.status})`);
  const tx = (await createRes.json()) as { Id: string; Signers?: Array<{ Id?: string; SignUrl?: string }> };

  // 2) PDF uploaden op de transactie.
  const upRes = await fetch(`${BASE}/api/transaction/${tx.Id}/file/${encodeURIComponent(fileId)}`, {
    method: "PUT",
    headers: headers({ "Content-Type": "application/pdf" }),
    body: Buffer.from(input.pdf),
  });
  if (!upRes.ok) throw new Error(`Signhost: PDF uploaden mislukt (${upRes.status})`);

  // 3) Transactie starten (verstuurt de uitnodiging / activeert de SignUrl).
  const startRes = await fetch(`${BASE}/api/transaction/${tx.Id}/start`, { method: "PUT", headers: headers() });
  if (!startRes.ok) throw new Error(`Signhost: transactie starten mislukt (${startRes.status})`);
  const started = (await startRes.json().catch(() => tx)) as { Signers?: Array<{ SignUrl?: string }> };

  const signUrl = started.Signers?.[0]?.SignUrl ?? tx.Signers?.[0]?.SignUrl ?? null;
  return { transactionId: tx.Id, fileId, signUrl };
}

/** Haalt het ondertekende PDF + ontvangstbewijs op (na Status 30 = signed). */
export async function fetchSignhostSignedFiles(transactionId: string, fileId: string): Promise<{ signedPdf: Buffer | null; receipt: Buffer | null }> {
  if (!signhostConfigured()) return { signedPdf: null, receipt: null };
  const [docRes, recRes] = await Promise.all([
    fetch(`${BASE}/api/transaction/${transactionId}/file/${encodeURIComponent(fileId)}`, { headers: headers() }),
    fetch(`${BASE}/api/file/receipt/${transactionId}`, { headers: headers() }),
  ]);
  const signedPdf = docRes.ok ? Buffer.from(await docRes.arrayBuffer()) : null;
  const receipt = recRes.ok ? Buffer.from(await recRes.arrayBuffer()) : null;
  return { signedPdf, receipt };
}

/** Signhost-statuscodes die we gebruiken. 30 = Signed, 40/50 = geannuleerd/verlopen. */
export const SIGNHOST_STATUS_SIGNED = 30;
