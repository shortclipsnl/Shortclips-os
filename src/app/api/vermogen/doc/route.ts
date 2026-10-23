import { NextResponse } from "next/server";
import { getViewer, isOwner } from "@/server/auth/context";
import { deleteVermogenDoc, isValidVermogenPath, putVermogenDoc } from "@/server/vermogen/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-check voor beide methodes; geeft de foutrespons terug of null. */
async function guard(): Promise<NextResponse | null> {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  if (!isOwner(viewer)) return NextResponse.json({ error: "Alleen voor de eigenaar." }, { status: 403 });
  return null;
}

function pathOf(request: Request): string | null {
  const p = new URL(request.url).searchParams.get("path");
  return isValidVermogenPath(p) ? p : null;
}

/** Eén document opslaan. Body = het volledige document (JSON). */
export async function PUT(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  const path = pathOf(request);
  if (!path) return NextResponse.json({ error: "Ongeldig pad; moet met 'v/' beginnen." }, { status: 400 });

  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON in de body." }, { status: 400 });
  }

  await putVermogenDoc(path, data);
  return NextResponse.json({ ok: true });
}

/** Eén document verwijderen. */
export async function DELETE(request: Request) {
  const denied = await guard();
  if (denied) return denied;

  const path = pathOf(request);
  if (!path) return NextResponse.json({ error: "Ongeldig pad; moet met 'v/' beginnen." }, { status: 400 });

  await deleteVermogenDoc(path);
  return NextResponse.json({ ok: true });
}
