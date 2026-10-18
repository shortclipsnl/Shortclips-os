import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients } from "@/db/schema";
import { requirePermission, assertClientAccess } from "@/server/auth/context";
import {
  getClientAiProfile,
  listActiveClientsForAi,
  listCentralKnowledge,
  type CaptionProfile,
  type CommunicationProfile,
  type EditingProfile,
} from "@/server/ai/knowledge";
import { Card, PageHeader } from "@/components/ui";
import { KnowledgeManager, ProfileForm } from "./kennisbank-ui";

export const metadata: Metadata = { title: "AI-kennisbank" };
export const dynamic = "force-dynamic";

export default async function KennisbankPage({
  searchParams,
}: {
  searchParams: Promise<{ klant?: string }>;
}) {
  const viewer = await requirePermission("ai:read");
  const [items, clientList] = await Promise.all([listCentralKnowledge(), listActiveClientsForAi(viewer)]);

  const selectedId = (await searchParams).klant;
  let selected: { id: string; name: string; caption: CaptionProfile; editing: EditingProfile; communication: CommunicationProfile } | null = null;
  if (selectedId) {
    assertClientAccess(viewer, selectedId);
    const [c] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, selectedId)).limit(1);
    if (c) {
      const profile = await getClientAiProfile(selectedId);
      selected = {
        id: c.id,
        name: c.name,
        caption: (profile?.captionProfile as CaptionProfile) ?? {},
        editing: (profile?.editingProfile as EditingProfile) ?? {},
        communication: (profile?.communicationProfile as CommunicationProfile) ?? {},
      };
    }
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="AI-kennisbank" description="De centrale kennis en klantprofielen die alle AI Tools gebruiken. Strikt per klant gescheiden." />

      <div className="space-y-5">
        <KnowledgeManager items={items} />

        <Card padded={false}>
          <div className="p-5 pb-3">
            <h2 className="text-sm font-semibold">Klantprofiel</h2>
            <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">Kies een klant om het caption-, editing- en communicatieprofiel in te stellen.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {clientList.map((c) => (
                <Link
                  key={c.id}
                  href={`/ai/kennisbank?klant=${c.id}`}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    selectedId === c.id
                      ? "bg-[var(--color-indigo-ink)] text-white"
                      : "bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        </Card>

        {selected ? (
          <ProfileForm
            clientId={selected.id}
            clientName={selected.name}
            caption={selected.caption}
            editing={selected.editing}
            communication={selected.communication}
          />
        ) : null}
      </div>
    </div>
  );
}
