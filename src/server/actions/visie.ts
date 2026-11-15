"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/server/auth/context";
import { recordActivity } from "@/server/audit";
import { saveVisie } from "@/server/visie";
import { normaliseer, standaardVisie, type Visie } from "@/lib/visie/data";

type Resultaat = { ok: true; visie: Visie } | { ok: false; fout: string };

async function bewaar(visie: Visie, titel: string): Promise<Resultaat> {
  const viewer = await requireOwner();
  try {
    const opgeslagen = await saveVisie(visie, viewer.id);
    await recordActivity({
      clientId: null,
      type: "visie.bijgewerkt",
      entityType: "visie",
      title: titel,
      metadata: { status: opgeslagen.status },
      actor: { id: viewer.id, fullName: viewer.fullName },
      isClientVisible: false,
    }).catch(() => undefined);
    for (const p of ["/visie", "/dashboard", "/verantwoordelijkheden", "/scripting", "/meetings", "/kennisbank"]) revalidatePath(p);
    return { ok: true, visie: opgeslagen };
  } catch {
    return { ok: false, fout: "Opslaan is niet gelukt. Probeer het opnieuw." };
  }
}

/** Wijzigingen opslaan. Is de visie al vastgesteld, dan ziet het team ze direct. */
export async function opslaanVisie(input: Visie): Promise<Resultaat> {
  return bewaar(normaliseer(input), "Onze visie bijgewerkt");
}

/** Jarno stelt de visie vast: vanaf nu zichtbaar voor het hele team. */
export async function stelVisieVast(input: Visie): Promise<Resultaat> {
  const visie = normaliseer(input);
  visie.status = "definitief";
  visie.vastgesteldOp = new Date().toISOString();
  return bewaar(visie, "Onze visie vastgesteld");
}

/** Terug naar voorstel: het team ziet de visie tijdelijk niet. */
export async function zetVisieOpVoorstel(input: Visie): Promise<Resultaat> {
  const visie = normaliseer(input);
  visie.status = "voorstel";
  return bewaar(visie, "Onze visie terug naar voorstel");
}

/** De oorspronkelijke tekst uit het Visie Voorstel terugzetten (als voorstel). */
export async function herstelVisieVoorstel(): Promise<Resultaat> {
  return bewaar(standaardVisie(), "Onze visie teruggezet naar het voorstel");
}
