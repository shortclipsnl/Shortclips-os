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
import { VERANTWOORDELIJKEN } from "@/lib/verantwoordelijkheden/data";
import { Weergave } from "./weergave";

export const metadata: Metadata = { title: "Mijn verantwoordelijkheden" };
export const dynamic = "force-dynamic";

/** Voornaam uit het account waarmee is ingelogd; valt terug op de vaste naam. */
function voornaam(fullName: string | null | undefined, terugval: string): string {
  const v = (fullName ?? "").trim().split(/\s+/)[0];
  return v || terugval;
}

export default async function VerantwoordelijkhedenPage({ searchParams }: { searchParams: Promise<{ persoon?: string }> }) {
  const viewer = await requireInternal();
  if (viewer.isEditorOnly) notFound();

  const owner = isOwner(viewer);
  const param = (await searchParams).persoon?.toLowerCase();
  const eigen = VERANTWOORDELIJKEN.find((m) => m.email === viewer.email.toLowerCase());
  // Alleen Milou, Jiska en Rutger hebben deze pagina. Jarno bekijkt hun pagina als beheerder;
  // ieder ander teamlid krijgt hem niet te zien (ook niet via de URL).
  const medewerker = owner ? (VERANTWOORDELIJKEN.find((m) => m.email === param) ?? VERANTWOORDELIJKEN[0]) : eigen;
  if (!medewerker) notFound();

  const config = await getVerantwoordelijkheden();

  // Live tellingen uit het bestaande werkoverzicht (zelfde bron als Vandaag).
  let subject = owner ? null : viewer;
  let naam: string = owner ? medewerker.naam : voornaam(viewer.fullName, medewerker.naam);
  if (owner) {
    const [u] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(sql`lower(${users.email}) = ${medewerker.email}`)
      .limit(1);
    subject = u ? await viewerForUser(u.id) : null;
    naam = voornaam(u?.fullName, medewerker.naam);
  }
  const work = subject ? await getWorkOverview(subject, { trusted: owner }).catch(() => null) : null;
  const tellingen = telPerCategorie(work);
  const functie = config.profielen?.[medewerker.email]?.functie ?? medewerker.functie;

  return (
    <div className="mx-auto max-w-[1100px] pb-10">
      <PageHeader
        title={`Ik, ${naam}, ben verantwoordelijk voor:`}
        description={functie}
        actions={owner ? (
          <LinkButton href="/verantwoordelijkheden/beheer" variant="secondary">
            <Settings2 className="size-4" /> Beheer
          </LinkButton>
        ) : undefined}
      />

      {owner && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Bekijk als</span>
          {VERANTWOORDELIJKEN.map((m) => (
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

      <Weergave config={config} email={medewerker.email} markeer={owner} tellingen={tellingen} liveBeschikbaar={work !== null} />
    </div>
  );
}
