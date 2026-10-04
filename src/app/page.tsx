import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth/context";

export default async function IndexPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  redirect(viewer.isPortalUser ? "/portal" : "/dashboard");
}
