import { redirect } from "next/navigation";

/** Werkwijze is samengevoegd in Samenwerking (tab Werkwijze). */
export default function PortalWerkwijzeRedirect() {
  redirect("/portal/samenwerking?tab=werkwijze");
}
