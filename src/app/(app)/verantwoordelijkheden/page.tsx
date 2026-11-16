import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { Settings2 } from "lucide-react";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { LinkButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { requireInternal, isOwner, viewerForUser } from "@/server/auth/context";
import { getVerantwoordelijkheden } from "@/server/verantwoordelijkheden";
import { getLiveStand } from "@/server/verantwoordelijkheden-live";
import { MEDEWERKERS, VERANTWOORDELIJKEN } from "@/lib/verantwoordelijkheden/data";
import { rolVoor } from "@/lib/verantwoordelijkheden/rol";
import { Weergave } from "./weergave";
import { getVisieVoor } from "@/server/visie";

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
  // Milou, Jiska en Rutger zien alleen hun eigen pagina. Jarno heeft sinds 16 nov ook een eigen
  // directiepagina (standaard bij openen) en bekijkt de pagina's van het team als beheerder.
  // Teamleden kunnen de directiepagina niet openen, ook niet via de URL.
  const jarno = MEDEWERKERS.find((m) => m.email === "jarno@shortclips.nl")!;
  const keuzes = owner ? [jarno, ...VERANTWOORDELIJKEN] : [];
  const medewerker = owner ? (keuzes.find((m) => m.email === param) ?? jarno) : eigen;
  if (!medewerker) notFound();
  const rol = rolVoor(medewerker.email);
  if (!rol) notFound();

  const config = await getVerantwoordelijkheden();
  // Onze visie (centrale bron): principe per onderdeel, Verder dan de taak en de meetpunten.
  const visie = await getVisieVoor(viewer);

  // De persoon over wie de pagina gaat: de ingelogde medewerker, of (voor Jarno) de gekozen collega.
  let subject = owner ? null : viewer;
  let naam: string = owner ? medewerker.naam : voornaam(viewer.fullName, medewerker.naam);
  if (owner && medewerker.email === jarno.email) {
    // De directiepagina gaat over de ingelogde eigenaar zelf.
    subject = viewer;
    naam = voornaam(viewer.fullName, jarno.naam);
  } else if (owner) {
    const [u] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(sql`lower(${users.email}) = ${medewerker.email}`)
      .limit(1);
    subject = u ? await viewerForUser(u.id) : null;
    naam = voornaam(u?.fullName, medewerker.naam);
  }
  if (!subject) notFound();

  // Actuele stand: KPI's, eigen klanten of opnamedagen en signalen (allemaal bestaande portaaldata).
  const live = await getLiveStand(subject, rol, { trusted: owner });
  const functie = rol.functie ?? config.profielen?.[medewerker.email]?.functie ?? medewerker.functie;

  return (
    <div className="mx-auto max-w-[1180px] pb-10">
      {owner ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Bekijk als</span>
          {keuzes.map((m) => (
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
          <LinkButton href="/verantwoordelijkheden/beheer" variant="secondary">
            <Settings2 className="size-4" /> Beheer
          </LinkButton>
        </div>
      ) : null}

      <Weergave config={config} email={medewerker.email} naam={naam} functie={functie} rol={rol} live={live} markeer={owner} visie={visie} />
    </div>
  );
}
