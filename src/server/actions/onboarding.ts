"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner, requirePermission, ForbiddenError } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import {
  convertLead,
  getConvertForm,
  runDriveStep,
  runOnboardingAutomation,
  refreshOnboarding,
  saveWelcomeMessage,
  type ConvertForm,
} from "@/server/onboarding";

function forbidden(e: unknown): { ok: false; message: string } | null {
  if (e instanceof ForbiddenError) return { ok: false, message: e.message };
  return null;
}

/** Gegevens voor het controlevenster "Omzetten naar klant". */
export async function loadConvertForm(leadId: string): Promise<{ ok: true; form: ConvertForm } | { ok: false; message: string }> {
  try {
    await requireOwner();
    const form = await getConvertForm(leadId);
    if (!form) return { ok: false, message: "Lead niet gevonden." };
    return { ok: true, form };
  } catch (e) {
    return forbidden(e) ?? { ok: false, message: "Gegevens ophalen mislukt. Probeer het opnieuw." };
  }
}

const convertSchema = z.object({
  leadId: z.string().uuid(),
  company: z.string().min(1).max(160),
  contactName: z.string().max(160).nullable(),
  email: z.string().max(320).nullable(),
  phone: z.string().max(40).nullable(),
  pakket: z.enum(["org6", "org8", "ads6", "ads8", "anders"]),
  shortsPerMonth: z.number().int().min(0).max(60),
  contentFocus: z.enum(["organisch", "advertentie"]),
  monthlyRevenue: z.string().max(20).nullable(),
  startOn: z.string().max(10).nullable(),
  contractMonths: z.number().int().min(1).max(60).nullable(),
  coordinatorId: z.string().uuid(),
  publisher: z.enum(["shortclips", "klant"]),
  notes: z.string().max(2000).nullable(),
  confirmSimilar: z.boolean(),
  linkToClientId: z.string().uuid().nullable().optional(),
});

export type ConvertActionResult =
  | { ok: true; slug: string; existing: boolean; drive: { ok: boolean; message?: string }; tasks: number }
  | { ok: false; message: string; similar?: { slug: string; name: string }[] };

/**
 * Bevestigen in het controlevenster: klant aanmaken (één transactie, lead
 * vergrendeld) en daarna de automatische stappen. Er gaat niets naar de klant.
 */
export async function convertLeadWithOnboarding(raw: unknown): Promise<ConvertActionResult> {
  try {
    const viewer = await requireOwner();
    const parsed = convertSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: "Niet alle velden zijn goed ingevuld." };

    const res = await convertLead({ id: viewer.id, email: viewer.email }, parsed.data);
    if (!res.ok) return res;

    if (res.existing && !parsed.data.linkToClientId) {
      // Al eerder omgezet: niets opnieuw doen, alleen doorsturen.
      return { ok: true, slug: res.slug, existing: true, drive: { ok: true }, tasks: 0 };
    }

    await auditLog({
      viewer,
      action: "client.onboarding_started",
      entityType: "client",
      entityId: res.clientId,
      clientId: res.clientId,
      changes: { leadId: parsed.data.leadId, coordinatorId: parsed.data.coordinatorId, pakket: parsed.data.pakket },
    }).catch(() => undefined);

    const auto = await runOnboardingAutomation(res.clientId);
    // Bewust geen revalidatePath("/leads"): dat ververst de leadslijst meteen en
    // sluit dan het venster met de samenvatting. De lijst ververst bij sluiten.
    revalidatePath("/clients");
    revalidatePath(`/clients/${res.slug}`);
    revalidatePath("/dashboard");
    revalidatePath("/tasks");
    return { ok: true, slug: res.slug, existing: res.existing, drive: { ok: auto.drive.ok, message: auto.drive.message }, tasks: auto.tasks };
  } catch (e) {
    console.error("[onboarding.convert]", e);
    return forbidden(e) ?? { ok: false, message: "Omzetten is niet gelukt. Er is niets dubbel aangemaakt; probeer het opnieuw." };
  }
}

/** "Opnieuw proberen" bij een mislukte stap. Veilig: maakt nooit iets dubbel. */
export async function retryOnboardingStep(clientId: string, slug: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await requirePermission("clients:write");
    const res = await runDriveStep(clientId);
    await runOnboardingAutomation(clientId);
    revalidatePath(`/clients/${slug}`);
    return res.ok ? { ok: true } : { ok: false, message: res.message ?? "Opnieuw mislukt." };
  } catch (e) {
    return forbidden(e) ?? { ok: false, message: "Opnieuw proberen mislukt." };
  }
}

export async function refreshOnboardingAction(clientId: string, slug: string): Promise<{ ok: boolean }> {
  try {
    await requirePermission("clients:write");
    await refreshOnboarding(clientId);
    revalidatePath(`/clients/${slug}`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function saveWelcomeMessageAction(clientId: string, slug: string, text: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await requirePermission("clients:write");
    if (!text.trim()) return { ok: false, message: "Het bericht is leeg." };
    await saveWelcomeMessage(clientId, text);
    revalidatePath(`/clients/${slug}`);
    return { ok: true };
  } catch (e) {
    return forbidden(e) ?? { ok: false, message: "Opslaan mislukt." };
  }
}
