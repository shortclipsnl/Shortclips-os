"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown, Copy, Loader2, PenLine } from "lucide-react";
import { buttonClass, ClientLogo } from "@/components/ui";
import { forwardIdeaToGenerator, saveMiddenstukRichting } from "@/server/actions/content-research";
import type { WeeklyGroup } from "@/server/content-research/service";
import type { IdeaView } from "@/server/content-research/idea-view";
import { useLogoColor } from "@/lib/use-logo-color";
import { ideaToText } from "./idea-card";
import { MiddenstukRichting } from "./middenstuk-richting";

/**
 * "Nieuwe ideeën deze week": per klant een duidelijke kop met logo en naam, en
 * daaronder vijf genummerde ideeën. Ingeklapt zie je alleen titel, gekozen hook
 * en score; uitklappen toont het idee, de hookkeuze, het middenstuk (met eigen
 * richting) en de call to action.
 */
export function WeeklyTop({ groups }: { groups: WeeklyGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="sc-card mb-6 p-5 text-sm text-[var(--color-ink-muted)]">
        Er staan deze week nog geen nieuwe ideeën klaar. Het onderzoek draait elke maandagochtend automatisch.
      </div>
    );
  }
  return (
    <section className="mb-8 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">Nieuwe ideeën deze week</h2>
        <span className="text-xs text-[var(--color-ink-faint)]">{groups.length} klanten · klik een idee open voor de details</span>
      </div>
      {groups.map((g) => <ClientGroup key={g.client.id} group={g} />)}
    </section>
  );
}

function ClientGroup({ group }: { group: WeeklyGroup }) {
  const color = useLogoColor(group.client.logoUrl, group.client.color);
  return (
    <div className="sc-card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4 text-white" style={{ background: color }}>
        <span className="rounded-xl bg-white p-1">
          <ClientLogo name={group.client.name} logoUrl={group.client.logoUrl} color={color} size={48} />
        </span>
        <h3 className="flex-1 text-xl font-bold tracking-tight">{group.client.name}</h3>
        <Link href={`/ai/content-research/${group.client.id}?tab=ideeen`} className="rounded-md border border-white/50 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10">
          Alle ideeën
        </Link>
      </div>
      <ol className="divide-y divide-[var(--color-line)]">
        {group.ideas.map((idea, n) => (
          <IdeaRow key={idea.id} idea={idea} n={n + 1} clientName={group.client.name} />
        ))}
      </ol>
    </div>
  );
}

function IdeaRow({ idea, n, clientName }: { idea: IdeaView; n: number; clientName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hook, setHook] = useState(0);
  const [richting, setRichting] = useState(idea.middenstukRichting ?? "");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  async function copy() {
    try {
      await navigator.clipboard.writeText(ideaToText({ ...idea, middenstukRichting: richting || null }, clientName, hook));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* geen klembordtoegang */
    }
  }

  function toScriptEngine() {
    start(async () => {
      // Zorg dat de laatste richting is opgeslagen vóór de brief wordt opgebouwd.
      if ((idea.middenstukRichting ?? "") !== richting.trim()) await saveMiddenstukRichting(idea.id, richting);
      const res = await forwardIdeaToGenerator(idea.id);
      if (res.ok && res.url) router.push(`${res.url}&hook=${hook}`);
    });
  }

  return (
    <li>
      <div className="flex items-center gap-3 px-5 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-indigo-ink)] text-xs font-semibold text-white">{n}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="block text-[15px] font-semibold leading-snug text-[var(--color-ink)]">{idea.titel}</span>
          {idea.hooks[hook] ? <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]">Hook: {idea.hooks[hook]}</span> : null}
        </button>
        <span className="hidden w-10 shrink-0 text-right text-lg font-bold tabular-nums text-[var(--color-ink)] sm:block" title="Content Opportunity Score">{idea.opportunityScore || "–"}</span>
        <button type="button" onClick={copy} className={buttonClass({ variant: "secondary", size: "sm" })} aria-label="Idee kopiëren">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          <span className="hidden sm:inline">{copied ? "Gekopieerd" : "Kopiëren"}</span>
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Inklappen" : "Uitklappen"} className={buttonClass({ variant: "ghost", size: "sm" })}>
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open ? (
        <div className="space-y-4 border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-5 py-4 sm:pl-15">
          {idea.concept ? (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Het idee</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink)]">{idea.concept}</p>
            </div>
          ) : null}

          {idea.hooks.length > 0 ? (
            <fieldset>
              <legend className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Kies een hook</legend>
              <div className="mt-1.5 space-y-1.5">
                {idea.hooks.map((h, i) => (
                  <label
                    key={i}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border bg-white px-3 py-2 text-sm ${i === hook ? "border-[var(--color-indigo-ink)] font-medium text-[var(--color-ink)]" : "border-[var(--color-line)] text-[var(--color-ink-muted)]"}`}
                  >
                    <input type="radio" name={`wk-hook-${idea.id}`} checked={i === hook} onChange={() => setHook(i)} className="mt-1 accent-[var(--color-indigo-ink)]" />
                    <span>{h}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {idea.middenstuk.length > 0 ? (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Middenstuk: dit moet erin</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[var(--color-ink)]">
                {idea.middenstuk.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          ) : null}

          <MiddenstukRichting ideaId={idea.id} initial={idea.middenstukRichting} onChange={setRichting} />

          {idea.cta ? (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Call to action</p>
              <p className="mt-1 text-sm text-[var(--color-ink)]">{idea.cta}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending} onClick={toScriptEngine} className={buttonClass({ variant: "primary", size: "sm" })}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}
              {idea.forwardedAt ? "Open uitwerking" : `Uitwerken in Script Engine (hook ${hook + 1})`}
            </button>
            <button type="button" onClick={copy} className={buttonClass({ variant: "secondary", size: "sm" })}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Gekopieerd" : "Idee kopiëren"}
            </button>
            <Link href={`/ai/content-research/${idea.clientId}?tab=ideeen`} className="ml-auto text-xs text-[var(--color-ink-muted)] underline">
              Onderbouwing en score
            </Link>
          </div>
        </div>
      ) : null}
    </li>
  );
}
