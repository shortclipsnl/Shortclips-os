import "server-only";
import { notify } from "@/server/notifications";
import { maandAdviesTaak } from "@/server/vermogen/adviseur";
import { runJob } from "./runner";

/**
 * Maandelijks (de 5e, na de maandexports): maakt het vermogensadvies voor Jarno
 * en meldt dat het klaarstaat. Staan de cijfers nog op een vorige maand, dan een
 * herinnering om de vermogenspagina te openen (daar wordt het feitenblad berekend).
 */
export async function runVermogenAdvies() {
  let uitkomst: { status: string; melding?: string } = { status: "" };
  await runJob("system", "vermogen.advies_maand", {}, async (ctx) => {
    uitkomst = await maandAdviesTaak();
    ctx.log(`Vermogensadvies: ${uitkomst.status}${uitkomst.melding ? ` (${uitkomst.melding})` : ""}`);
    const maand = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }).slice(0, 7);
    if (uitkomst.status === "ok") {
      await notify({ roles: ["owner"], type: "vermogen_advies", level: "info", title: "Je maandadvies over je vermogen staat klaar", body: "Bekijk wat de adviseur deze maand zou doen.", href: "/dashboard/vermogen", dedupeKey: `vermogen_advies:${maand}` });
    } else if (uitkomst.status === "wacht op cijfers") {
      await notify({ roles: ["owner"], type: "vermogen_advies", level: "info", title: "Open je vermogenspagina voor je maandadvies", body: "Voeg je maandexports toe en open Vermogen; dan maakt de adviseur het advies van deze maand.", href: "/dashboard/vermogen", dedupeKey: `vermogen_advies_wacht:${maand}` });
    } else if (uitkomst.status !== "al gedaan") {
      await notify({ roles: ["owner"], type: "vermogen_advies", level: "warning", title: "Maandadvies vermogen lukte niet", body: uitkomst.melding ?? uitkomst.status, href: "/dashboard/vermogen", dedupeKey: `vermogen_advies_fout:${maand}` });
    }
  });
  return uitkomst;
}
