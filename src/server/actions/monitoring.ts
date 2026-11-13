"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireOwner } from "@/server/auth/context";
import { auditLog } from "@/server/audit";
import { runMonitorWatch } from "@/server/monitoring/watch";
import { sendAlertMail } from "@/server/monitoring/mailer";

export type MonitorActionResult = { ok: boolean; message: string };

/**
 * "Nu controleren": meet alles opnieuw en probeert storingen direct te
 * herstellen (zonder de wachttijd af te wachten). Veilig: dezelfde vergrendeling
 * als de geplande ronde, nooit een sync die al loopt, en alle syncs zijn idempotent.
 */
export async function checkIntegrationsNow(): Promise<MonitorActionResult> {
  try {
    const viewer = await requireOwner();
    const r = await runMonitorWatch({ force: true, trigger: "knop" });
    await auditLog({ viewer, action: "monitoring.check_now", entityType: "integration", changes: { level: r.level, recoveries: r.recoveries.length } });
    revalidatePath("/settings/koppelingsbewaking");
    if (r.skipped === "locked") return { ok: true, message: "Er loopt al een controle. Ververs de pagina over een minuut." };
    const rec = r.recoveries.length
      ? ` ${r.recoveries.filter((x) => x.ok).length} van ${r.recoveries.length} herstelpoging(en) gelukt.`
      : "";
    return { ok: true, message: `Controle afgerond.${rec}` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    return { ok: false, message: "De controle kon niet worden uitgevoerd. Details staan in de systeemstatus." };
  }
}

/** Testmelding naar de beheerder, om het meldingskanaal te controleren. */
export async function sendTestAlert(): Promise<MonitorActionResult> {
  try {
    const viewer = await requireOwner();
    const r = await sendAlertMail({
      subject: "Testmelding Koppelingsbewaking",
      heading: "Testmelding Koppelingsbewaking",
      lines: [
        "Dit is een testmelding. Komt deze mail aan, dan bereiken storingsmeldingen van het Shortclips-portaal je ook als je niet bent ingelogd.",
      ],
    });
    await auditLog({ viewer, action: "monitoring.test_alert", entityType: "integration", changes: { ok: r.ok } });
    revalidatePath("/settings/koppelingsbewaking");
    return r.ok
      ? { ok: true, message: "Testmelding verstuurd. Kijk in je mailbox (ook in de spammap)." }
      : { ok: false, message: `Versturen mislukt: ${r.error}` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    return { ok: false, message: "Versturen mislukt." };
  }
}
