import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { ArrowLeft, Eye } from "lucide-react";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { getPortalResultsForClient } from "@/server/portal";
import { Logo } from "@/components/logo";
import { PortalResultsView } from "@/app/(portal)/portal/resultaten/results-view";

export const metadata: Metadata = { title: "Klantportaal — voorbeeld" };
export const dynamic = "force-dynamic";

/**
 * Interne voorbeeldweergave van het klantportaal (resultaten): zo ziet de klant
 * zijn eigen resultaten in het portaal. Zelfde component en cijfers als het echte
 * portaal, in de donkere portaalstijl, maar zonder dat je als klant hoeft in te
 * loggen. Hard gescoped op klanttoegang.
 */
export default async function KlantportaalVoorbeeldPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ periode?: string }>;
}) {
  const viewer = await requirePermission("analytics:read");
  const { slug } = await params;
  const { periode } = await searchParams;
  const days = periode === "90" ? 90 : 30;

  const [client] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(and(eq(clients.slug, slug), isNull(clients.deletedAt)))
    .limit(1);
  if (!client) notFound();

  const r = await getPortalResultsForClient(viewer, client.id, days);

  return (
    <div className="mx-auto max-w-[1100px]">
      <Link href={`/analytics/${slug}`} className="inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
        <ArrowLeft className="size-4" /> Terug naar resultaten van {client.name}
      </Link>

      <div className="mt-2 mb-3 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[var(--color-info-soft)]/60 px-4 py-2.5 text-sm text-[var(--color-ink)]">
        <Eye className="mt-0.5 size-4 shrink-0 text-[var(--color-info)]" strokeWidth={1.75} />
        <p>
          <strong>Voorbeeld van het klantportaal.</strong> Zo ziet <strong>{client.name}</strong> de eigen resultaten
          wanneer de klant inlogt — zelfde cijfers en opmaak. Alleen voor intern gebruik; de klant ziet deze pagina niet.
        </p>
      </div>

      {/* De echte portaalstijl (donker) zodat het voorbeeld 1-op-1 klopt. */}
      <div className="portal-studio overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line-strong)] bg-[var(--color-canvas)]">
        <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-[rgba(5,6,29,0.65)] px-5 py-3.5">
          <Logo size={26} onDark />
          <span className="text-sm text-white/70">{client.name}</span>
        </div>
        <div className="p-5 sm:p-7">
          <PortalResultsView r={r} days={days} hrefForDays={(d) => `/analytics/${slug}/klantportaal?periode=${d}`} />
        </div>
      </div>
    </div>
  );
}
