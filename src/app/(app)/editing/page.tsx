import { redirect } from "next/navigation";

/**
 * Editing en Video's zijn samengevoegd tot één pagina (op /videos, getiteld
 * "Editing"). Deze oude route stuurt door zodat bestaande links blijven werken.
 */
export default function EditingRedirect() {
  redirect("/videos");
}
