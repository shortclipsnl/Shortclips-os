import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import { integrationHealth } from "@/server/integrations/registry";
import { INTEGRATION_LABEL } from "@/lib/statuses";

/**
 * Melding wanneer een centrale koppeling (Google Drive of Frame.io) niet goed
 * werkt.
 *
 * - Eigenaar (Jarno): technische melding met de reden en een directe link naar
 *   Koppelingsbewaking, waar staat wat er mis is, sinds wanneer en wat te doen.
 * - Team en editors: geen technische details. Alleen een korte, rustige regel
 *   als hun werk erdoor geraakt kan worden, met de vervolgstap (niets doen,
 *   Jarno is automatisch op de hoogte). Bij een koppeling die nog niet is
 *   ingesteld krijgt het team niets te zien.
 *
 * De gegevens zelf blijven zichtbaar: het portaal toont de laatst bekende
 * stand uit de eigen database, dus het werk kan gewoon doorgaan.
 */
export async function IntegrationNotice({
  provider,
  isOwner,
  what = "bestanden",
}: {
  provider: "google_drive" | "frameio";
  isOwner: boolean;
  /** Waar het hier om gaat, bv. "scripts", "video's", "bestanden". */
  what?: string;
}) {
  let health;
  try {
    health = (await integrationHealth()).find((h) => h.spec.provider === provider);
  } catch {
    return null; // een statuscheck mag nooit de pagina breken
  }
  if (!health || health.status === "connected") return null;

  if (!isOwner) {
    // Alleen tonen als er echt iets kan ontbreken; nooit bij "nog niet ingesteld".
    if (health.status === "not_configured" || health.status === "never_synced") return null;
    return (
      <p className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
        <Info className="size-3.5 shrink-0" />
        Nieuwe {what} kunnen tijdelijk later verschijnen. Jarno is automatisch op de hoogte; je kunt gewoon verder werken.
      </p>
    );
  }

  const label = INTEGRATION_LABEL[provider] ?? (provider === "frameio" ? "Frame.io" : "Google Drive");
  const reason =
    health.status === "not_configured"
      ? "is nog niet ingesteld"
      : health.status === "never_synced"
        ? "is nog niet gesynchroniseerd"
        : health.status === "stale"
          ? "is verouderd"
          : "werkt niet";

  return (
    <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-3.5 py-2.5 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
      <div className="min-w-0">
        <p className="font-semibold text-[#8a5300]">
          Alleen zichtbaar voor jou: de koppeling met {label} {reason}.
        </p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {health.lastErrorMessage ? `${health.lastErrorMessage}. ` : ""}
          {health.missing?.length ? `Ontbrekend: ${health.missing.join(", ")}. ` : ""}
          Het team ziet alleen dat nieuwe {what} later kunnen verschijnen.{" "}
          <Link href="/settings/koppelingsbewaking" className="font-semibold underline">
            Bekijk oorzaak en actie
          </Link>
        </p>
      </div>
    </div>
  );
}
