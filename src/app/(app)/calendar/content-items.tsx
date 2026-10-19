"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, MessageSquare, X } from "lucide-react";
import { PLATFORM } from "@/lib/statuses";
import { ClientLogo } from "@/components/ui";

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
};

const hasCaption = (c: string | null) => !!(c && c.trim().length > 0);

/** Google bewaart de omschrijving als HTML. Dit maakt er leesbare, kopieerbare
 *  platte tekst van (regeleindes behouden, tags en entities weg). */
function cleanCaption(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fmtDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, day).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

/** Kalender-chip: klik toont de caption. Een stip rechts geeft aan of er een
 *  caption bij staat (groen) of niet (grijs). */
export function ContentChip({ item, color }: { item: ContentItemLite; color: string }) {
  const [open, setOpen] = useState(false);
  const has = hasCaption(item.caption);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={has ? cleanCaption(item.caption!) : "Nog geen caption"}
        className="flex w-full items-start gap-1.5 rounded-[4px] border-l-2 bg-[var(--color-surface-sunken)] px-1.5 py-1 text-left hover:bg-[var(--color-neutral-soft)]"
        style={{ borderLeftColor: color }}
      >
        {/* Klantlogo altijd links op dezelfde plek — maakt de maand scanbaar. */}
        <ClientLogo name={item.clientName} logoUrl={item.clientLogo} color={item.clientColor} size={18} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1">
            <span className="block min-w-0 flex-1 truncate text-2xs leading-tight font-medium">{item.title}</span>
            <span className="mt-0.5 size-1.5 shrink-0 rounded-full" style={{ background: has ? "var(--color-good)" : "var(--color-line-strong)" }} />
          </span>
          <span className="mt-0.5 flex items-center gap-1">
            {item.platforms.slice(0, 3).map((p) => (
              <span key={p} className="size-1.5 rounded-full" style={{ background: PLATFORM[p]?.color ?? "#999" }} />
            ))}
            <span className="truncate text-2xs text-[var(--color-ink-faint)]">{item.clientName}</span>
          </span>
        </span>
      </button>
      {open ? <CaptionModal item={item} onClose={() => setOpen(false)} /> : null}
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
      {open ? <CaptionModal item={item} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function CaptionModal({ item, onClose }: { item: ContentItemLite; onClose: () => void }) {
  const has = hasCaption(item.caption);
  const text = has ? cleanCaption(item.caption!) : "";
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard geblokkeerd — stil negeren */
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-surface)] shadow-[var(--shadow-raised)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] p-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <ClientLogo name={item.clientName} logoUrl={item.clientLogo} color={item.clientColor} size={34} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{item.title}</div>
              <div className="text-xs text-[var(--color-ink-muted)]">
                {item.clientName} · {fmtDate(item.scheduledOn)}{item.scheduledAt ? ` · ${item.scheduledAt.slice(0, 5)}` : ""}{item.contentType ? ` · ${item.contentType}` : ""}
              </div>
              {item.platforms.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {item.platforms.map((p) => (
                    <span key={p} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-2xs text-[var(--color-ink-muted)]">
                      <span className="size-1.5 rounded-full" style={{ background: PLATFORM[p]?.color ?? "#999" }} />
                      {PLATFORM[p]?.label ?? p}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded p-1 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]" aria-label="Sluiten">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">Caption</span>
            {has ? (
              <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2 py-1 text-2xs font-medium hover:bg-[var(--color-surface-sunken)]">
                {copied ? <Check className="size-3 text-[var(--color-good)]" /> : <Copy className="size-3" />}
                {copied ? "Gekopieerd" : "Kopiëren"}
              </button>
            ) : null}
          </div>
          {has ? (
            <p className="max-h-[50vh] overflow-y-auto rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-3 text-sm whitespace-pre-wrap">{text}</p>
          ) : (
            <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)]/50 p-3 text-sm text-[#8a5300]">
              Nog geen caption bij deze upload. Zet de caption in de omschrijving van de afspraak in Google Agenda — dan verschijnt hij hier automatisch.
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <Link
              href={item.deliverableId ? `/videos/${item.deliverableId}` : item.clientSlug ? `/clients/${item.clientSlug}?tab=planning` : "#"}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline"
            >
              <ExternalLink className="size-3.5" /> Open details
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
