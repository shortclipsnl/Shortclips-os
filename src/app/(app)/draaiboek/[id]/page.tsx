import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ForbiddenError, requireInternal } from "@/server/auth/context";
import { canManageDraaiboek, getDraaiboekForVideographer } from "@/server/draaiboek/service";
import { DraaiboekMobile } from "./draaiboek-mobile";

export const metadata: Metadata = { title: "Draaiboek" };
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

export default async function DraaiboekSessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ video?: string }> }) {
  const viewer = await requireInternal();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let view;
  try {
    view = await getDraaiboekForVideographer(viewer, id);
  } catch (e) {
    if (e instanceof ForbiddenError) return <NoAccess message={e.message} />;
    throw e;
  }
  if (!view || !view.content) notFound();
  const { video } = await searchParams;
  return <DraaiboekMobile view={view} initialVideo={video} canManage={canManageDraaiboek(viewer)} viewerId={viewer.id} />;
}
