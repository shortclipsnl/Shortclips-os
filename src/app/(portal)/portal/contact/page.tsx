import type { Metadata } from "next";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { requirePortal } from "@/server/auth/context";
import { getPortalContact, type PortalContactPerson } from "@/server/portal";
import { Avatar, buttonClass, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Contact" };
export const dynamic = "force-dynamic";

/** +31 6 12 34 56 78 → 31612345678 voor een wa.me-link. */
function waNumber(phone: string): string {
  return phone.replace(/[^\d]/g, "").replace(/^0/, "31");
}

function ContactCard({ person, focus }: { person: PortalContactPerson; focus?: string }) {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <Avatar name={person.name} size={52} />
        <div className="min-w-0">
          <p className="text-base font-semibold text-[var(--color-ink)]">{person.name}</p>
          <p className="text-sm text-[var(--color-ink-muted)]">{person.role}</p>
        </div>
      </div>
      {focus ? (
        <p className="mt-3 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink-muted)]">
          {focus}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        {person.email ? (
          <a href={`mailto:${person.email}`} className={buttonClass({ variant: "primary", size: "sm" })}>
            <Mail className="size-4" /> E-mail
          </a>
        ) : null}
        {person.phone ? (
          <>
            <a href={`tel:${person.phone}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
              <Phone className="size-4" /> Bellen
            </a>
            <a
              href={`https://wa.me/${waNumber(person.phone)}`}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          </>
        ) : null}
      </div>
    </Card>
  );
}

export default async function PortalContactPage() {
  const viewer = await requirePortal();
  const { coordinator, videographer } = await getPortalContact(viewer);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Contact</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Wie je waarvoor kunt bereiken bij ShortClips.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {coordinator ? (
          <ContactCard person={coordinator} focus="Voor planning, scripts, feedback, resultaten en alles rond de samenwerking." />
        ) : (
          <ContactCard
            person={{ name: "ShortClips", role: "Je team", email: "info@shortclips.nl", phone: null }}
            focus="Voor planning, scripts, feedback, resultaten en alles rond de samenwerking."
          />
        )}
        {videographer ? (
          <ContactCard person={videographer} focus="Voor vragen rondom een aankomende opnamedag en de opnames zelf." />
        ) : null}
      </div>

      <p className="text-xs text-[var(--color-ink-muted)]">
        Vragen over je video&apos;s, planning of samenwerking? Je vaste contactpersoon helpt je graag.
      </p>
    </div>
  );
}
