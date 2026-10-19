import { getViewer, canAuthorKennisbank } from "@/server/auth/context";
import { finalizeAsset } from "@/server/kennisbank-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || !canAuthorKennisbank(viewer)) return Response.json({ ok: false, message: "Alleen de eigenaar en projectcoördinatoren mogen bestanden uploaden." }, { status: 403 });
  const { id } = await ctx.params;
  const res = await finalizeAsset(id);
  return Response.json(res, { status: res.ok ? 200 : 400 });
}
