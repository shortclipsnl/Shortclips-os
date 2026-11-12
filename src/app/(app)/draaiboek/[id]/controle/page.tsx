import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ForbiddenError, requireInternal } from "@/server/auth/context";
import { getDraaiboekForControl, videographerOptions } from "@/server/draaiboek/service";
import { ControleView } from "./controle-ui";

export const metadata: Metadata = { title: "Draaiboek controleren" };
function NoAccess({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
      <p className="text-base font-semibold text-[var(--color-ink)]">Geen toegang</p>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{message}</p>
      <Link href="/draaiboek" className="mt-4 inline-block text-sm font-medium text-[var(--color-ink)] underline">Naar mijn opnames</Link>
    </div>
  );
}

export const dynamic = "force-dynamic";
// Genereren leest de script-PDF en vraagt korte shotaanwijzingen aan de AI.
export const maxDuration = 180;

export default async function DraaiboekControlePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireInternal();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let view;
  try {
    view = await getDraaiboekForControl(viewer, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <NoAccess message={e.message} />;
    throw e;
  }
  if (!view) notFound();
  const options = await videographerOptions();
  return <ControleView view={view} videographers={options} />;
}
