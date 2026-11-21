"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireLeadsAccess, ForbiddenError } from "@/server/auth/context";
import {
  completePhase,
  saveCentralLink,
  saveDefaultMessage,
  saveLeadLink,
  saveLeadMessage,
  setAssignee,
  setPhaseStatus,
  syncJourneyTasks,
  toggleCheck,
} from "@/server/lead-journey";

type Result = { ok: boolean; message?: string };

async function run(leadId: string | null, fn: () => Promise<Result>): Promise<Result> {
  try {
    const r = await fn();
    if (leadId) revalidatePath(`/leads/${leadId}`);
    revalidatePath("/leads");
    if (r.ok) revalidatePath("/tasks");
    return r;
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: e.message };
    console.error("[lead-journey]", e);
    return { ok: false, message: "Er ging iets mis. Probeer het opnieuw." };
  }
}

const ids = z.object({ leadId: z.string().uuid(), phaseKey: z.string().max(40) });

export async function toggleCheckAction(input: { leadId: string; phaseKey: string; itemKey: string; value: boolean }) {
  const p = ids.extend({ itemKey: z.string().max(40), value: z.boolean() }).parse(input);
  return run(p.leadId, () => toggleCheck(p.leadId, p.phaseKey, p.itemKey, p.value));
}

export async function setPhaseStatusAction(input: { leadId: string; phaseKey: string; status: "nog_niet" | "bezig" | "wacht_klant" | "klaar" }) {
  const p = ids.extend({ status: z.enum(["nog_niet", "bezig", "wacht_klant", "klaar"]) }).parse(input);
  return run(p.leadId, () => setPhaseStatus(p.leadId, p.phaseKey, p.status));
}

export async function completePhaseAction(input: { leadId: string; phaseKey: string }) {
  const p = ids.parse(input);
  return run(p.leadId, () => completePhase(p.leadId, p.phaseKey));
}

export async function setAssigneeAction(input: { leadId: string; phaseKey: string; assigneeId: string | null }) {
  const p = ids.extend({ assigneeId: z.string().uuid().nullable() }).parse(input);
  return run(p.leadId, () => setAssignee(p.leadId, p.phaseKey, p.assigneeId));
}

export async function startJourneyAction(leadId: string) {
  const id = z.string().uuid().parse(leadId);
  return run(id, async () => {
    const v = await requireLeadsAccess();
    // Eerste klik: reis bestaat vanaf nu, de huidige fase komt als taak in het overzicht.
    await setPhaseStatus(id, "binnen", "bezig");
    void v;
    await syncJourneyTasks(id);
    return { ok: true };
  });
}

export async function saveLeadMessageAction(input: { leadId: string; key: string; text: string | null }) {
  const p = z.object({ leadId: z.string().uuid(), key: z.string().max(40), text: z.string().max(6000).nullable() }).parse(input);
  return run(p.leadId, () => saveLeadMessage(p.leadId, p.key, p.text));
}

export async function saveDefaultMessageAction(input: { key: string; text: string | null }) {
  const p = z.object({ key: z.string().max(40), text: z.string().max(6000).nullable() }).parse(input);
  return run(null, async () => {
    const v = await requireLeadsAccess();
    return saveDefaultMessage(p.key, p.text, v.id);
  });
}

export async function saveCentralLinkAction(input: { key: string; url: string | null }) {
  const p = z.object({ key: z.string().max(40), url: z.string().max(500).nullable() }).parse(input);
  return run(null, async () => {
    const v = await requireLeadsAccess();
    return saveCentralLink(p.key, p.url, v.id);
  });
}

export async function saveLeadLinkAction(input: { leadId: string; key: string; url: string | null }) {
  const p = z.object({ leadId: z.string().uuid(), key: z.string().max(40), url: z.string().max(500).nullable() }).parse(input);
  return run(p.leadId, () => saveLeadLink(p.leadId, p.key, p.url));
}
