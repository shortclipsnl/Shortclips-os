import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/context";
import { aiConfigured } from "@/server/ai/client";
import { PageHeader } from "@/components/ui";
import { AssistantConsole } from "./assistant-ui";

export const metadata: Metadata = { title: "AI Assistent" };
export const dynamic = "force-dynamic";
// Langere functie-timeout voor de AI-antwoorden (anders kapt Vercel het af).
export const maxDuration = 300;

export default async function AssistentPage() {
  const viewer = await requirePermission("ai:read");
  const firstName = (viewer.fullName ?? "").trim().split(/\s+/)[0] ?? "";

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="AI Assistent"
        description="Stel een vraag over klanten, scripts, opnames, editing, planning en deadlines — met concrete antwoorden en links, rechtstreeks uit de Hub en afgestemd op wat jij mag zien."
      />
      <AssistantConsole firstName={firstName} aiReady={aiConfigured()} />
    </div>
  );
}
