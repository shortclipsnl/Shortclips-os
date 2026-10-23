import type { Metadata } from "next";
import { requireOwner } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { listMentorConversations } from "@/server/actions/mentor";
import { MentorChat } from "./mentor-ui";

export const metadata: Metadata = { title: "AI Mentor" };
export const dynamic = "force-dynamic";
// Een strategische analyse kan even duren; ruim de tijd geven.
export const maxDuration = 120;

export default async function MentorPage() {
  // Serverkant afgedwongen: alleen de eigenaar. Niet-eigenaren krijgen geen toegang.
  const viewer = await requireOwner();
  const rows = await listMentorConversations();
  const conversations = rows.map((c) => ({
    id: c.id,
    title: c.title,
    pinned: Boolean(c.pinnedAt),
    lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null,
  }));
  const firstName = viewer.fullName.split(" ")[0] || "Jarno";

  return (
    <div className="mx-auto max-w-[1200px]">
      <MentorChat conversations={conversations} aiReady={aiConfigured()} firstName={firstName} />
    </div>
  );
}
