import type { Metadata } from "next";
import { requireOperationalManager } from "@/server/auth/context";

export const metadata: Metadata = { title: "Prijslijst 2027" };
export const dynamic = "force-dynamic";

/**
 * Interne prijslijst 2027 (bron: Shortclips Prijslijst 2027, PDF, 17 pagina's).
 *
 * Eén pagina binnen de portaalschil met eigen tabbladen (overzicht, afdelingen,
 * Partnerjaar en Creator, extra kosten, klant adviseren, vergelijken). Het
 * document zelf staat in data/prijslijst/ en wordt via /prijslijst/embed
 * uitgeleverd, net als het vermogensdashboard.
 *
 * Fase 1 (nov 2026): alleen Jarno en Milou (manageOperations). Uitrol naar het
 * hele team na akkoord van Jarno: verruim de guard hier en in de embed-route,
 * en de vlag in nav-config.
 */
export default async function PrijslijstPage() {
  await requireOperationalManager();
  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col">
      <iframe
        src="/prijslijst/embed"
        title="Prijslijst 2027"
        allow="clipboard-write"
        className="w-full flex-1 rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[#f4f5f9]"
      />
    </div>
  );
}
