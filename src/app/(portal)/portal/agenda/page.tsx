import { redirect } from "next/navigation";

/** Agenda is samengevoegd met Contentplanning tot één Planning-tijdlijn. */
export default function PortalAgendaRedirect() {
  redirect("/portal/planning");
}
