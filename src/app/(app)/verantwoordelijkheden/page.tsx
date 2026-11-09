import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Settings2 } from "lucide-react";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { LinkButton, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { requireInternal, isOwner, viewerForUser } from "@/server/auth/context";
import { getWorkOverview } from "@/server/werkoverzicht";
import { getVerantwoordelijkheden, telPerCategorie } from "@/server/verantwoordelijkheden";
import { MEDEWERKERS } from "@/lib/verantwoordelijkheden/data";
import { Weergave } from "./weergave";

export const metadata: Metadata = { title: "Mijn verantwoordelijkheden" };
export const dynamic = "force-dynamic";

const INTRO =
  "Dit zijn jouw verantwoordelijkheden binnen Shortclips. Hier zie je wat je zelfstandig regelt, welke beslissingen je mag nemen en wanneer je Jarno moet inschakelen.";

export default async function VerantwoordelijkhedenPage({ searchParams }: { searchParams: Promise<{ persoon?: string }> }) {
  const viewer = await requireInternal();
  if (viewer.isEditorOnly) notFound();

  const owner = isOwner(viewer);
  const param = (await searchParams).persoon?.toLowerCase();
  const eigen = MEDEWERKERS.find((m) => m.email === viewer.email.toLowerCase());
  // De eigenaar bekijkt de pagina van een medewerker; het team ziet alleen de eigen pagina.
  const medewerker = owner ? (MEDEWERKERS.find((m) => m.email === param) ?? MEDEWERKERS[0]) : eigen;

  const config = await getVerantwoordelijkheden();

  if (!medewerker) {
    return (
      <div className="mx-auto max-w-[1100px]">
        <PageHeader title="Mijn verantwoordelijkheden" description={INTRO} />
        <div className="sc-card p-6 text-sm text-[var(--color-ink-muted)]">Voor jou zijn nog geen verantwoordelijkheden vastgelegd.</div>
      </div>
    );
  }

  // De verantwoordelijkheden zijn direct zichtbaar voor het team — geen aparte
  // goedkeurstap meer. Elke wijziging die Jarno in Beheer opslaat is meteen live.

  // Live tellingen uit het bestaande werkoverzicht (dezelfde bron als Vandaag).
  let subject = owner ? null : viewer;
  if (owner) {
    const [u] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${medewerker.email}`).limit(1);
    subject = u ? await viewerForUser(u.id) : null;
  }
  const work = subject ? await getWorkOverview(subject, { trusted: owner }).catch(() => null) : null;
  const tellingen = telPerCategorie(work);

  return (
    <div className="mx-auto max-w-[1100px] pb-10">
      <PageHeader
        title="Mijn verantwoordelijkheden"
        description={INTRO}
        actions={owner ? (
          <LinkButton href="/verantwoordelijkheden/beheer" variant="secondary">
            <Settings2 className="size-4" /> Beheer
          </LinkButton>
        ) : undefined}
      />

      {owner && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Bekijk als</span>
          {MEDEWERKERS.map((m) => (
            <Link
              key={m.email}
              href={`/verantwoordelijkheden?persoon=${encodeURIComponent(m.email)}`}
              className={cn(
                "rounded-full border px-3 py-1 text-sm font-medium transition",
                m.email === medewerker.email
                  ? "border-[var(--color-indigo-ink)] bg-[var(--color-indigo-ink)] text-white"
                  : "border-[var(--color-line)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
              )}
            >
              {m.naam}
            </Link>
          ))}
          <span
            className={cn(
              "ml-auto rounded-full px-3 py-1 text-xs font-semibold",
              config.status === "goedgekeurd" ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[#fff4c2] text-[#7a5a00]",
            )}
          >
            {config.status === "goedgekeurd" ? "Goedgekeurd · zichtbaar voor het team" : "Concept · ook direct zichtbaar voor het team"}
          </span>
        </div>
      )}

      <Weergave config={config} email={medewerker.email} markeer={owner} tellingen={tellingen} />
    </div>
  );
}
