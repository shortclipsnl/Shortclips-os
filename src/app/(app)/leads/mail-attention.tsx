"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2, MailQuestionMark, MailCheck } from "lucide-react";
import { resolveLeadMail } from "@/server/actions/leads";
import type { LeadMailItem } from "@/server/leads";

function day(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" });
}

function Row({ item, mode, canResolve }: { item: LeadMailItem; mode: "review" | "recent"; canResolve: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const title = item.company || item.contactName || item.email || "Onbekende aanvraag";

  function act(action: "create" | "attach" | "ignore") {
    setError(null);
    start(async () => {
      const res = await resolveLeadMail({ id: item.id, action });
      if (res.ok) router.refresh();
      else setError(res.message ?? "Mislukt");
    });
  }

  return (
    <li className="border-t border-[var(--color-line)] first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          {open ? <ChevronDown className="size-4 shrink-0 text-[var(--color-ink-faint)]" /> : <ChevronRight className="size-4 shrink-0 text-[var(--color-ink-faint)]" />}
          <span className="truncate font-medium text-[var(--color-ink)]">{title}</span>
          <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">{day(item.receivedAt)}</span>
        </button>
        {mode === "review" && canResolve ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {pending ? <Loader2 className="size-4 animate-spin text-[var(--color-ink-faint)]" /> : null}
            {item.leadId ? (
              <button type="button" disabled={pending} onClick={() => act("attach")} className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60">
                Bij bestaande lead zetten
              </button>
            ) : null}
            <button type="button" disabled={pending} onClick={() => act("create")} className="rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
              Nieuwe lead
            </button>
            <button type="button" disabled={pending} onClick={() => act("ignore")} className="rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60">
              Negeren
            </button>
          </div>
        ) : null}
        {mode === "recent" && item.leadId ? (
          <Link href={`/leads?lead=${item.leadId}`} className="shrink-0 text-xs font-medium text-[var(--color-brand-600)] hover:underline">
            Bij {item.leadCompany}
          </Link>
        ) : null}
      </div>
      {mode === "review" && item.reason ? <p className="px-4 pb-2 pl-10 text-xs text-[var(--color-ink-muted)]">{item.reason}</p> : null}
      {error ? <p className="px-4 pb-2 pl-10 text-xs font-medium text-[var(--color-bad)]">{error}</p> : null}
      {open ? (
        <div className="px-4 pb-3 pl-10 text-xs text-[var(--color-ink-muted)]">
          <p className="mb-1">
            {[item.contactName, item.email, item.phone, item.formType].filter(Boolean).join(" · ")}
          </p>
          <pre className="whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] p-2.5 font-sans text-xs text-[var(--color-ink)]">{item.originalText || "Geen aanvraagtekst."}</pre>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Aanvragen uit de mail die aandacht vragen: twijfelgevallen om te beoordelen en
 * recente aanvragen van bestaande relaties. Toont niets als er niets speelt.
 */
export function LeadMailAttention({ review, recent, canResolve }: { review: LeadMailItem[]; recent: LeadMailItem[]; canResolve: boolean }) {
  if (!review.length && !recent.length) return null;
  return (
    <div className="mb-6 space-y-4">
      {review.length ? (
        <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
          <header className="flex items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm font-semibold text-[var(--color-ink)]">
            <MailQuestionMark className="size-4 text-[var(--color-brand-600)]" strokeWidth={1.75} />
            Aanvragen om te beoordelen ({review.length})
          </header>
          <ul>
            {review.map((item) => (
              <Row key={item.id} item={item} mode="review" canResolve={canResolve} />
            ))}
          </ul>
        </section>
      ) : null}
      {recent.length ? (
        <section className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)]">
          <header className="flex items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-2.5 text-sm font-semibold text-[var(--color-ink)]">
            <MailCheck className="size-4 text-[var(--color-brand-600)]" strokeWidth={1.75} />
            Nieuwe aanvraag van bestaande relatie, laatste 14 dagen ({recent.length})
          </header>
          <ul>
            {recent.map((item) => (
              <Row key={item.id} item={item} mode="recent" canResolve={canResolve} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
