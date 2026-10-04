import { NextResponse } from "next/server";
import { getViewer } from "@/server/auth/context";
import { universalSearch } from "@/server/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.isPortalUser) {
    return NextResponse.json({ hits: [] }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const hits = await universalSearch(viewer, q);
  return NextResponse.json({ hits });
}
