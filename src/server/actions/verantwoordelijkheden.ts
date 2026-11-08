"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/server/auth/context";
import { recordActivity } from "@/server/audit";
import { saveVerantwoordelijkheden } from "@/server/verantwoordelijkheden";
import { normaliseer, standaardConfig, type Config } from "@/lib/verantwoordelijkheden/data";

type Resultaat = { ok: true; config: Config } | { ok: false; fout: string };

async function bewaar(config: Config, titel: string): Promise<Resultaat> {
  const viewer = await requireOwner();
  try {
    const opgeslagen = await saveVerantwoordelijkheden(config, viewer.id);
    await recordActivity({
      clientId: null,
      type: "verantwoordelijkheden.bijgewerkt",
      entityType: "verantwoordelijkheden",
      title: titel,
      metadata: { status: opgeslagen.status },
      actor: { id: viewer.id, fullName: viewer.fullName },
      isClientVisible: false,
    }).catch(() => undefined);
    revalidatePath("/verantwoordelijkheden");
    return { ok: true, config: opgeslagen };
  } catch {
    return { ok: false, fout: "Opslaan is niet gelukt. Probeer het opnieuw." };
  }
}

/** Wijzigingen opslaan. Is de verdeling al goedgekeurd, dan ziet het team ze direct. */
export async function opslaanVerantwoordelijkheden(input: Config): Promise<Resultaat> {
  return bewaar(normaliseer(input), "Verantwoordelijkheden bijgewerkt");
}

/** Jarno keurt de verdeling goed: vanaf nu ziet het team zijn eigen pagina. */
export async function keurVerantwoordelijkhedenGoed(input: Config): Promise<Resultaat> {
  const config = normaliseer(input);
  config.status = "goedgekeurd";
  config.goedgekeurdOp = new Date().toISOString();
  return bewaar(config, "Verantwoordelijkheden goedgekeurd");
}

/** Terug naar concept: het team ziet de pagina tijdelijk niet. */
export async function zetVerantwoordelijkhedenOpConcept(input: Config): Promise<Resultaat> {
  const config = normaliseer(input);
  config.status = "concept";
  return bewaar(config, "Verantwoordelijkheden terug naar concept");
}

/** Het oorspronkelijke voorstel terugzetten (als concept). */
export async function herstelVoorstel(): Promise<Resultaat> {
  return bewaar(standaardConfig(), "Verantwoordelijkheden teruggezet naar voorstel");
}
