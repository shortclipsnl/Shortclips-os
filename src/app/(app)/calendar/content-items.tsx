"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { PLATFORM } from "@/lib/statuses";
import { ClientLogo } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { cn } from "@/lib/cn";
import { ContentDetailModal, cleanCaption } from "@/components/content-planning/content-detail-modal";

export type ContentItemLite = {
  id: string;
  title: string;
  caption: string | null;
  clientName: string;
  clientSlug: string | null;
  clientLogo: string | null;
  clientColor: string | null;
  scheduledOn: string;
  scheduledAt: string | null;
  contentType: string | null;
  platforms: string[];
  deliverableId: string | null;
  /** Publicatiestatus van het bericht (to_prepare, ready, scheduled, published, failed). */
  status?: string | null;
  /** Voortgang van de publicatiecheck (alleen bij gepubliceerde video's). */
  pubCheck?: { done: number; total: number } | null;
  /** Publiceren via Metricool: status per kanaal; null = handmatig posten. */
  pub?: Array<{ platform: string; status: string }> | null;
};

/** Kleur van de ring om een kanaalicoon bij "Via Metricool". */
const PUB_RING: Record<string, string> = {
  ingepland: "var(--color-good)",
  gepubliceerd: "var(--color-good)",
  proef: "var(--color-violet)",
  in_de_wacht: "var(--color-warn)",
  mislukt: "var(--color-bad)",
};
const PUB_LABEL: Record<string, string> = {
  ingepland: "ingepland via Metricool",
  gepubliceerd: "online",
  proef: "proefmodus",
  in_de_wacht: "gewijzigd, opnieuw inplannen",
  mislukt: "niet gelukt",
  wordt_verstuurd: "wordt verstuurd",
};

const hasCaption = (c: string | null) => !!(c && c.trim().length > 0);

/** Kalender-chip: klik toont de caption. Een stip rechts geeft aan of er een
 *  caption bij staat (groen) of niet (grijs). */
export function ContentChip({ item, color, today = false }: { item: ContentItemLite; color: string; today?: boolean }) {
  const [open, setOpen] = useState(false);
  const has = hasCaption(item.caption);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={has ? cleanCaption(item.caption!) : "Nog geen caption"}
        className={cn(
          "flex w-full items-start gap-1.5 rounded-[4px] border-l-2 px-1.5 py-1 text-left",
          today
            ? "bg-[var(--color-surface)] ring-2 ring-[var(--color-good)] shadow-sm hover:bg-[var(--color-good-soft)]/40"
            : "bg-[var(--color-surface-sunken)] hover:bg-[var(--color-neutral-soft)]",
        )}
        style={{ borderLeftColor: color }}
      >
        {/* Klantlogo altijd links op dezelfde plek — maakt de maand scanbaar. */}
        <ClientLogo name={item.clientName} logoUrl={item.clientLogo} color={item.clientColor} size={18} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1">
            {today ? (
              <span className="shrink-0 rounded bg-[var(--color-good)] px-1 py-px text-[8px] font-bold uppercase leading-none tracking-wide text-white">
                vandaag
              </span>
            ) : null}
            <span className="block min-w-0 flex-1 truncate text-2xs leading-tight font-medium">{item.title}</span>
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full" style={{ background: has ? "var(--color-good)" : "var(--color-line-strong)" }} />
          </span>
          <span className="mt-0.5 flex items-center gap-1">
            {item.pub && item.pub.length ? (
              item.pub.map((c) => (
                <span
                  key={c.platform}
                  className="inline-flex rounded-full p-px"
                  style={{ boxShadow: `0 0 0 1.5px ${PUB_RING[c.status] ?? "var(--color-line-strong)"}` }}
                  title={`${PLATFORM[c.platform]?.label ?? c.platform}: ${PUB_LABEL[c.status] ?? "nog inplannen via Metricool"}`}
                >
                  <PlatformIcon platform={c.platform} size={11} />
                </span>
              ))
            ) : (
              item.platforms.slice(0, 3).map((p) => (
                <PlatformIcon key={p} platform={p} size={12} title={PLATFORM[p]?.label} />
              ))
            )}
            <span className="truncate text-2xs text-[var(--color-ink-faint)]">{item.clientName}</span>
            {item.pubCheck ? (
              <span
                className="ml-auto shrink-0 rounded px-1 py-px text-[8px] font-bold leading-none"
                style={
                  item.pubCheck.done >= item.pubCheck.total
                    ? { background: "var(--color-good)", color: "#fff" }
                    : { background: "var(--color-warn-soft)", color: "#8a5300" }
                }
                title={`Publicatiecheck: ${item.pubCheck.done}/${item.pubCheck.total} afgevinkt`}
              >
                ✓{item.pubCheck.done}/{item.pubCheck.total}
              </span>
            ) : null}
          </span>
        </span>
      </button>
      {open ? <ContentDetailModal item={item} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Lijst-knop: toont een badge (caption aanwezig of niet) en opent de caption. */
export function CaptionToggle({ item }: { item: ContentItemLite }) {
  const [open, setOpen] = useState(false);
  const has = hasCaption(item.caption);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Caption bekijken"
        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium ${has ? "bg-[var(--color-good-soft)] text-[#1d6b4c]" : "bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]"}`}
      >
        <MessageSquare className="size-3.5" />
        {has ? "Caption" : "Geen caption"}
      </button>
      {open ? <ContentDetailModal item={item} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
