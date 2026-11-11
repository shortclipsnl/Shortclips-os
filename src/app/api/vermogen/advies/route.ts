import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { maakAdvies } from "@/server/vermogen/adviseur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Mijn Vermogensadviseur: nieuwe analyse op het actuele feitenblad.
 * Alleen voor de eigenaar (zelfde controle als de andere vermogensroutes).
 */
export async function POST() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  if (!isOwner(viewer)) return NextResponse.json({ error: "Alleen voor de eigenaar." }, { status: 403 });

  const doc = await maakAdvies("handmatig");
  return NextResponse.json(doc, { status: doc.status === "fout" && !doc.advies ? 422 : 200 });
}
