import type { Metadata } from "next";
import { requireFinanceOwner } from "@/server/auth/finance-guard";
import { Prijslijst } from "./prijslijst";

export const metadata: Metadata = { title: "Interne prijslijst 2027" };
export const dynamic = "force-dynamic";

/**
 * Interne prijslijst 2027 (bron: interne prijslijst v1.0, PDF).
 *
 * Fase 1 (nov 2026): uitsluitend voor de eigenaar. Teamleden, editors en
 * klanten krijgen "pagina niet gevonden" en zien het menu-item niet
 * (ownerOnly in nav-config). Uitrol naar het team pas na akkoord van Jarno:
 * vervang dan requireFinanceOwner door requireInternal + editors weren, en
 * zet in nav-config `ownerOnly` om naar de juiste rollen.
 */
export default async function PrijslijstPage() {
  await requireFinanceOwner();
  return <Prijslijst />;
}
