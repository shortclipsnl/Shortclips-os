import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { canManageDraaiboek, getDraaiboekForVideographer } from "@/server/draaiboek/service";
import { DraaiboekMobile } from "./draaiboek-mobile";

export const metadata: Metadata = { title: "Draaiboek" };
export const dynamic = "force-dynamic";

export default async function DraaiboekSessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ video?: string }> }) {
  const viewer = await requireInternal();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const view = await getDraaiboekForVideographer(viewer, id);
  if (!view || !view.content) notFound();
  const { video } = await searchParams;
  return <DraaiboekMobile view={view} initialVideo={video} canManage={canManageDraaiboek(viewer)} viewerId={viewer.id} />;
}
