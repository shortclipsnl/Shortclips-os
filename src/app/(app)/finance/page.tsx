import { redirect } from "next/navigation";

// Finance is op verzoek uit het dashboard gehaald. De onderliggende financiële
// gegevens blijven in de database bewaard; alleen de weergave is verwijderd.
export const dynamic = "force-dynamic";

export default function FinanceRemoved() {
  redirect("/dashboard");
}
