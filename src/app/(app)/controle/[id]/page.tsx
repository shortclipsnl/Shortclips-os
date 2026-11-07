import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { opsControlItems } from "@/db/schema";
import { requireInternal } from "@/server/auth/context";

export const dynamic = "force-dynamic";

/**
 * Doorklik vanuit een controletaak of -melding: stuurt direct naar de plek waar
 * het probleem staat (video, opname, scriptsessie, klant). Editors hebben hier
 * niets te zoeken: de controle gaat alleen over het interne team.
 */
export default async function ControleRedirect({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInternal();
  if (viewer.isEditorOnly) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [it] = await db.select({ href: opsControlItems.href }).from(opsControlItems).where(eq(opsControlItems.id, id)).limit(1);
  if (!it) notFound();
  redirect(it.href && it.href.startsWith("/") ? it.href : "/tasks");
}
