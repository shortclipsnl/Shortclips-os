import { redirect } from "next/navigation";

// Het Scripts-onderdeel wordt niet meer in dit dashboard beheerd (dat gebeurt
// elders, in de script-engine). De pagina is uit de navigatie gehaald en stuurt
// hier door naar het dashboard. Losse scriptlinks vanuit een video of klant
// blijven werken via /scripts/[id].
export const dynamic = "force-dynamic";

export default function ScriptsRedirect() {
  redirect("/dashboard");
}
