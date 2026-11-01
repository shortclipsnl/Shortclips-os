import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal, isOwner } from "@/server/auth/context";
import type { Rol } from "@/lib/beslissingshulp/data";
import { gemisteZoekopdrachten, type GemisteZoekopdracht } from "@/server/beslissingshulp";
import { Beslissingshulp } from "./beslissingshulp";

export const metadata: Metadata = { title: "Beslissingshulp" };
export const dynamic = "force-dynamic";

/**
 * Beslissingshulp: wat mag je zelf beslissen, wat los je zelf op en wat gaat
 * naar Jarno. Voor het hele interne team (Content Creatives, videograaf,
 * eigenaar). Editors zien de pagina niet.
 */
export default async function BeslissingshulpPage() {
  const viewer = await requireInternal();
  if (viewer.primaryRole === "editor") notFound();

  const owner = isOwner(viewer);
  // Startweergave per rol: de videograaf ziet direct zijn eigen situaties,
  // de eigenaar ziet waar hij over beslist, de rest start als Content Creative.
  const startRol: Rol = owner ? "bi" : viewer.primaryRole === "videographer" ? "vg" : "cc";

  // Alleen de eigenaar ziet welke zoekopdrachten niets opleverden (in Beheer).
  let gemist: GemisteZoekopdracht[] = [];
  if (owner) {
    try { gemist = await gemisteZoekopdrachten(); } catch { gemist = []; }
  }

  return <Beslissingshulp owner={owner} startRol={startRol} gemist={gemist} />;
}
