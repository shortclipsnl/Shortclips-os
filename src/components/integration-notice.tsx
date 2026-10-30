import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { integrationHealth } from "@/server/integrations/registry";
import { INTEGRATION_LABEL } from "@/lib/statuses";

/**
 * Nette melding wanneer een centrale koppeling (Google Drive of Frame.io) niet
 * beschikbaar is — niet geconfigureerd, nog niet gesynct, verouderd of met
 * fouten. Zo zien medewerkers een duidelijke reden i.p.v. een stil-lege lijst.
 *
 * De koppelingen draaien centraal onder één bedrijfs-service-account; alleen de
 * eigenaar (Jarno) kan ze vernieuwen. Daarom krijgt de eigenaar een directe link
 * naar de koppelingenpagina en het team een duidelijke "vraag Jarno"-instructie.
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

  const label = INTEGRATION_LABEL[provider] ?? (provider === "frameio" ? "Frame.io" : "Google Drive");
  const reason =
    health.status === "not_configured"
      ? "is nog niet ingesteld"
      : health.status === "never_synced"
        ? "is nog niet gesynchroniseerd"
        : health.status === "error"
          ? "geeft fouten (mogelijk is de toegang verlopen)"
          : "is verouderd (mogelijk is de toegang verlopen)";

  return (
    <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)] px-3.5 py-2.5 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
      <div className="min-w-0">
        <p className="font-semibold text-[#8a5300]">
          De koppeling met {label} {reason} — {what} worden nu mogelijk niet (volledig) getoond.
        </p>
        {isOwner ? (
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {health.missing?.length ? `Ontbrekend: ${health.missing.join(", ")}. ` : ""}
            <Link href="/settings/integrations" className="font-semibold underline">
              Vernieuw de koppeling
            </Link>{" "}
            op de koppelingenpagina.
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            Vraag Jarno om de koppeling te vernieuwen. Zodra dat gebeurd is, verschijnen de {what} vanzelf weer.
          </p>
        )}
      </div>
    </div>
  );
}
