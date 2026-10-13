import type { Metadata } from "next";
import { requireOwner } from "@/server/auth/context";
import { listCouplings, listAvailableGoogleCalendars, AGENDA_COLORS } from "@/server/calendar-couplings";
import { PageHeader, Card, InfoNote } from "@/components/ui";
import { AgendasManager } from "./agendas-ui";

export const metadata: Metadata = { title: "Agenda's" };
export const dynamic = "force-dynamic";

export default async function AgendasPage() {
  await requireOwner();
  const [couplings, available] = await Promise.all([listCouplings(), listAvailableGoogleCalendars()]);

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Gekoppelde agenda's"
        description="Kies welke Google-agenda's ShortClips OS meeneemt in de opnameplanning. Elke agenda krijgt een eigen kleur, en dezelfde afspraak in meerdere agenda's wordt automatisch als één opname geteld."
      />

      <div className="mb-4">
        <InfoNote>
          Afspraken worden pas zichtbaar na de eerstvolgende agenda-synchronisatie (automatisch &apos;s nachts, of handmatig via Beheer → Koppelingen). Een agenda ontkoppelen laat eerder gesynchroniseerde afspraken staan.
        </InfoNote>
      </div>

      <Card padded={false}>
        <AgendasManager
          couplings={couplings.map((c) => ({ id: c.id, calendarId: c.calendarId, label: c.label, color: c.color, enabled: c.enabled }))}
          available={available}
          colors={[...AGENDA_COLORS]}
        />
      </Card>
    </div>
  );
}
