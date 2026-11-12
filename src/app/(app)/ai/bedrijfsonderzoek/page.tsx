import { redirect } from "next/navigation";

// Sales Research is uit het portaal gehaald (12 nov 2026, besluit Jarno).
// De onderliggende data blijft bewaard in de database; de pagina is voor niemand meer bereikbaar.
export const dynamic = "force-dynamic";

export default function SalesResearchPage() {
  redirect("/dashboard");
}
