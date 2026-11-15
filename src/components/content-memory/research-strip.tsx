import Link from "next/link";
import { FileSearch } from "lucide-react";
import { getViewer, isEditorRole, isFreelanceVideographer } from "@/server/auth/context";
import { researchStatusFor } from "@/server/client-research/view";

const nl = (d: Date | null) => (d ? d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }) : "");

/**
 * Verwijzing van het Contentgeheugen naar het klantonderzoek. Het onderzoek is
 * het startpunt (wie is de klant, wat deden ze tot nu toe); het Contentgeheugen
 * neemt het over zodra er eigen resultaten zijn. Alleen voor het interne team.
 */
export async function ResearchStrip({ clientId, clientSlug, thin }: { clientId: string; clientSlug: string; thin: boolean }) {
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser || isEditorRole(viewer) || isFreelanceVideographer(viewer)) return null;
  const s = await researchStatusFor(clientId).catch(() => null);
  if (!s || s.status === "geen" || s.status === "mislukt") return null;
  const text =
    s.status === "goedgekeurd"
      ? `Klantonderzoek goedgekeurd op ${nl(s.date)}. ${thin ? "Zolang er weinig eigen resultaten zijn, is dat het startpunt voor scripts en opnames." : "Doelgroep, concurrenten en het eerste strategieadvies staan in het dossier."}`
      : s.status === "controle"
        ? "Het klantonderzoek staat klaar voor controle. Na goedkeuring wordt het gekoppeld aan de klantkennis."
        : "Het klantonderzoek voor deze klant loopt.";
  return (
    <Link href={`/clients/${clientSlug}?tab=onderzoek`} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-sm hover:border-[var(--color-line-strong)]">
      <FileSearch className="size-4 shrink-0 text-[var(--color-ink-muted)]" />
      <span className="min-w-0 flex-1 text-[var(--color-ink-muted)]">{text}</span>
      <span className="shrink-0 font-medium text-[var(--color-brand-600)]">Dossier openen</span>
    </Link>
  );
}
