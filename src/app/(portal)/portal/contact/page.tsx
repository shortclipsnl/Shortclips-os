import { redirect } from "next/navigation";

/** Contact is samengevoegd in Samenwerking (tab Team). */
export default function PortalContactRedirect() {
  redirect("/portal/samenwerking?tab=team");
}
