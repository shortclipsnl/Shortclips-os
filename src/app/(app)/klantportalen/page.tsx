import { redirect } from "next/navigation";

/**
 * Klantportalen is samengevoegd met Klantenbeheer tot één "Klanten"-pagina met
 * twee tabbladen. Oude links blijven werken via deze redirect.
 */
export default function KlantportalenRedirect() {
  redirect("/klantenbeheer?tab=portalen");
}
