import { Card } from "@/components/ui";
import { listAttentionTeam } from "@/server/attention";
import { getExitInterview } from "@/server/exit-interview";
import { ExitInterviewForm } from "./exit-interview-form";

const nlDate = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });

/**
 * Exitgesprek bij een gestopte of gepauzeerde klant. Het gesprek zelf voert
 * het team met de gesprekskaart (PDF, alleen vragen); de antwoorden en
 * conclusie staan hier, zodat alle data op één plek blijft.
 */
export async function ExitInterviewTab({ clientId }: { clientId: string }) {
  const [view, team] = await Promise.all([getExitInterview(clientId), listAttentionTeam()]);
  const savedLabel = view.updatedAt ? `Laatst opgeslagen${view.updatedBy ? ` door ${view.updatedBy}` : ""} op ${nlDate(view.updatedAt)}` : null;
  return (
    <div className="max-w-4xl">
      <Card>
        {!view.exists ? (
          <p className="mb-6 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
            Nog geen exitgesprek vastgelegd. Voer het gesprek met de gesprekskaart en vul hier de antwoorden en de conclusie in.
          </p>
        ) : null}
        <ExitInterviewForm
          clientId={clientId}
          initial={view.data}
          team={team.map((t) => ({ id: t.id, name: t.name }))}
          savedLabel={savedLabel}
        />
      </Card>
    </div>
  );
}
