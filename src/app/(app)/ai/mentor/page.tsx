import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireOwner } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { listMentorConversations, listMentorMemories } from "@/server/actions/mentor";
import { MentorChat } from "./mentor-ui";

export const metadata: Metadata = { title: "AI Mentor" };
export const dynamic = "force-dynamic";
// Een strategische analyse kan even duren; ruim de tijd geven.
export const maxDuration = 120;

export default async function MentorPage() {
  // Serverkant afgedwongen: alleen de eigenaar. Niet-eigenaren krijgen geen toegang.
  const viewer = await requireOwner();
  const [rows, memories] = await Promise.all([listMentorConversations(), listMentorMemories()]);
  const conversations = rows.map((c) => ({
    id: c.id,
    title: c.title,
    pinned: Boolean(c.pinnedAt),
    lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null,
  }));
  const firstName = viewer.fullName.split(" ")[0] || "Jarno";

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Volledige export van alle mentor-inhoud (gesprekken, adviezen, geheugen)
          als huisstijl-PDF — downloadbaar om te bewaren of te archiveren. */}
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <a
          href="/api/ai/mentor/export/pdf"
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3.5 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"
        >
          <Download className="size-4" /> Exporteer alles als PDF
        </a>
      </div>
      <MentorChat conversations={conversations} memories={memories} aiReady={aiConfigured()} firstName={firstName} />
    </div>
  );
}
