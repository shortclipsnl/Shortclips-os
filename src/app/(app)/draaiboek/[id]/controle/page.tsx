import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInternal } from "@/server/auth/context";
import { getDraaiboekForControl, videographerOptions } from "@/server/draaiboek/service";
import { ControleView } from "./controle-ui";

export const metadata: Metadata = { title: "Draaiboek controleren" };
export const dynamic = "force-dynamic";
// Genereren leest de script-PDF en vraagt korte shotaanwijzingen aan de AI.
export const maxDuration = 180;

export default async function DraaiboekControlePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInternal();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const view = await getDraaiboekForControl(viewer, id);
  if (!view) notFound();
  const options = await videographerOptions();
  return <ControleView view={view} videographers={options} />;
}
