import { and, desc, eq, isNull } from "drizzle-orm";
import { Card } from "@/components/ui";
import { db } from "@/db/client";
import { clientContacts } from "@/db/schema";
import { listAttentionTeam } from "@/server/attention";
import { getExitInterview } from "@/server/exit-interview";
import { ExitInterviewForm } from "./exit-interview-form";

const nlDate = (iso: string) => new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

/** De gesprekskaart (alleen de vragen) die het team tijdens het telefoongesprek gebruikt. */
export const EXIT_CALL_SHEET = "/docs/exitgesprek-gesprekskaart.pdf";

/**
 * Exitgesprek bij een gestopte of gepauzeerde klant. Het gesprek gaat altijd
 * telefonisch, met de gesprekskaart ernaast; antwoorden en conclusie worden
 * direct hier ingevuld, zodat alle data op één plek staat.
 */
export async function ExitInterviewTab({ clientId }: { clientId: string }) {
  const [view, team, contacts] = await Promise.all([
    getExitInterview(clientId),
    listAttentionTeam(),
    db.select({ id: clientContacts.id, name: clientContacts.fullName, role: clientContacts.role, phone: clientContacts.phone, isPrimary: clientContacts.isPrimary })
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, clientId), isNull(clientContacts.deletedAt)))
      .orderBy(desc(clientContacts.isPrimary)),
  ]);
  const savedLabel = view.updatedAt ? `Laatst opgeslagen${view.updatedBy ? ` door ${view.updatedBy}` : ""} op ${nlDate(view.updatedAt)}` : null;
  const withPhone = contacts.filter((c) => c.phone?.trim());

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        {!view.exists ? (
          <p className="mb-6 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
            Nog geen exitgesprek vastgelegd. Bel de klant met de gesprekskaart ernaast en vul hier tijdens of direct na het gesprek de antwoorden en de conclusie in.
          </p>
        ) : null}
        <ExitInterviewForm
          clientId={clientId}
          initial={view.data}
          team={team.map((t) => ({ id: t.id, name: t.name }))}
          savedLabel={savedLabel}
        />
      </Card>

      {/* Belblok: blijft in beeld tijdens het invullen. */}
      <aside className="space-y-5 lg:sticky lg:top-20">
        <Card>
          <h2 className="text-base font-semibold text-[var(--color-ink)]">Bel de klant</h2>
          <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">
            Voer het exitgesprek altijd telefonisch, nooit via mail. Aan de telefoon hoor je de echte reden en kun je doorvragen. Het kost je 5 tot 10 minuten en daarna niets extra: je vult alles hier direct in.
          </p>

          <div className="mt-4 space-y-2">
            {withPhone.length ? withPhone.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-ink)]">{c.name}</p>
                  {c.role ? <p className="truncate text-xs text-[var(--color-ink-muted)]">{c.role}</p> : null}
                  <p className="text-xs tabular-nums text-[var(--color-ink)]">{c.phone}</p>
                </div>
                <a href={telHref(c.phone!)} className="h-8 shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 text-[13px] font-medium leading-8 text-white hover:brightness-110">
                  Bellen
                </a>
              </div>
            )) : (
              <p className="rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[#8a5300]">
                Geen telefoonnummer bekend. Vul het aan onder het tabblad Contactpersoon.
              </p>
            )}
          </div>

          <a
            href={EXIT_CALL_SHEET}
            target="_blank"
            rel="noopener"
            className="mt-4 flex h-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-ink-muted)]"
          >
            Gesprekskaart openen (PDF)
          </a>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">Zo werkt het</h3>
          <ol className="mt-2 space-y-1.5 text-sm text-[var(--color-ink-muted)]">
            <li><span className="mr-1.5 font-medium text-[var(--color-ink)]">1.</span>Open de gesprekskaart.</li>
            <li><span className="mr-1.5 font-medium text-[var(--color-ink)]">2.</span>Bel de klant en loop de zeven vragen door.</li>
            <li><span className="mr-1.5 font-medium text-[var(--color-ink)]">3.</span>Typ aantekeningen en klik scores en redenen aan.</li>
            <li><span className="mr-1.5 font-medium text-[var(--color-ink)]">4.</span>Vul direct na het gesprek de conclusie in en sla op.</li>
          </ol>
        </Card>
      </aside>
    </div>
  );
}
