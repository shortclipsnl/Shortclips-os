"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bookmark, Check, CheckCheck, ChevronDown, Copy, ExternalLink, FileText, Loader2, MessageSquare, PenLine,
  RotateCcw, Star, ThumbsDown, TrendingUp,
} from "lucide-react";
import { Badge, buttonClass, ClientLogo, type Tone } from "@/components/ui";
import {
  favoriteIdea, forwardIdeaToGenerator, markIdeaUsed, rejectIdea, resetIdea, saveIdea, saveMiddenstukRichting,
} from "@/server/actions/content-research";
import { OPPORTUNITY_PARTS, dataShare } from "@/server/content-research/opportunity";
import { QUALITY_PARTS } from "@/server/content-research/quality";
import type { IdeaView } from "@/server/content-research/idea-view";
import { useLogoColor } from "@/lib/use-logo-color";
import { MiddenstukRichting } from "./middenstuk-richting";

export type { Evidence, IdeaView } from "@/server/content-research/idea-view";
export type IdeaClient = { name: string; logoUrl: string | null; color: string | null };

const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  favoriet: { label: "Interessant", tone: "good" },
  opgeslagen: { label: "Later", tone: "neutral" },
  doorgestuurd: { label: "Doorgestuurd", tone: "lime" },
  gebruikt: { label: "Al gebruikt", tone: "ink" },
  afgewezen: { label: "Niet relevant", tone: "bad" },
  gearchiveerd: { label: "Gearchiveerd", tone: "neutral" },
};

const EVIDENCE_LABEL: Record<string, string> = {
  eigen_data: "Eigen resultaten",
  concurrent: "Concurrent",
  markt: "Markt",
  nieuw: "Nog niet behandeld",
  herhaling: "Bewuste herhaling",
};
const ZEKERHEID_TONE: Record<string, Tone> = { bewezen: "good", aanname: "warn", hypothese: "neutral" };

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{children}</p>;
}

/** Tekst voor "Idee kopiëren": in de vaste scriptopbouw, zodat je het overal kunt plakken. */
export function ideaToText(idea: IdeaView, clientName?: string, hookIndex = 0): string {
  const chosen = idea.hooks[hookIndex] ?? idea.hooks[0];
  const alts = idea.hooks.filter((h) => h !== chosen);
  return [
    `${idea.titel}${clientName ? ` (${clientName})` : ""}`,
    idea.concept ? `SHORTCLIP UITLEG\n${idea.concept}` : "",
    chosen ? `HOOK\n${chosen}${alts.length ? `\n\nAlternatieve hooks:\n- ${alts.join("\n- ")}` : ""}` : "",
    idea.middenstuk.length ? `MIDDENSTUK\n${idea.middenstuk.join("\n")}` : "",
    idea.middenstukRichting ? `RICHTING MIDDENSTUK (team)\n${idea.middenstukRichting}` : "",
    idea.ctaCommercieel || idea.ctaInteractie
      ? `CALL TO ACTION\nCommercieel: ${idea.ctaCommercieel ?? "-"}\nInteractie: ${idea.ctaInteractie ?? "-"}`
      : "",
  ].filter(Boolean).join("\n\n");
}

/** Klantkop met logo en naam in de klantkleur. */
export function ClientBand({ client, size = "md", action }: { client: IdeaClient; size?: "md" | "lg"; action?: React.ReactNode }) {
  const color = useLogoColor(client.logoUrl, client.color);
  const big = size === "lg";
  return (
    <div className={`flex items-center gap-4 text-white ${big ? "px-5 py-4" : "px-4 py-2.5"}`} style={{ background: color }}>
      <span className="rounded-xl bg-white p-1">
        <ClientLogo name={client.name} logoUrl={client.logoUrl} color={color} size={big ? 48 : 32} />
      </span>
      <span className={`flex-1 font-bold tracking-tight ${big ? "text-xl" : "text-sm"}`}>{client.name}</span>
      {action}
    </div>
  );
}

/**
 * Eén idee als compacte, genummerde regel: titel, gekozen hook en score. Uitklappen
 * toont de volledige uitwerking. Gebruikt op het weekoverzicht én de klantpagina,
 * zodat het team overal hetzelfde ziet.
 */
export function IdeaRow({ idea, n, clientName, detailsHref }: { idea: IdeaView; n: number; clientName: string; detailsHref?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [hook, setHook] = useState(0);
  const [richting, setRichting] = useState(idea.middenstukRichting ?? "");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const st = STATUS_LABEL[idea.status];
  const active = !["afgewezen", "gearchiveerd", "gebruikt"].includes(idea.status);

  if (hidden) return null;

  function run(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  // Niet relevant: direct weg uit beeld; op de achtergrond vastleggen (het
  // onderzoek leert hiervan en stelt het niet opnieuw voor).
  function notRelevant() {
    setHidden(true);
    start(async () => {
      await rejectIdea(idea.id, "");
      router.refresh();
    });
  }

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
      // De laatste richting eerst opslaan, zodat die in de brief zit.
      if ((idea.middenstukRichting ?? "") !== richting.trim()) await saveMiddenstukRichting(idea.id, richting);
      const res = await forwardIdeaToGenerator(idea.id);
      if (res.ok && res.url) router.push(`${res.url}&hook=${hook}`);
    });
  }

  return (
    <li className="list-none">
      {/* Ingeklapt: alleen wat je nodig hebt om te scannen */}
      <div className="flex items-center gap-3 px-5 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-indigo-ink)] text-xs font-semibold text-white">{n}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold leading-snug text-[var(--color-ink)]">{idea.titel}</span>
            {st ? <Badge tone={st.tone} className="!px-2 !py-0 text-2xs">{st.label}</Badge> : null}
          </span>
          {idea.hooks[hook] ? <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-muted)]">{idea.hooks[hook]}</span> : null}
        </button>
        <span className="hidden w-9 shrink-0 text-right text-lg font-bold tabular-nums text-[var(--color-ink)] sm:block" title={idea.keuring ? "Kwaliteitsscore (keuring): stijl-fit, bewezen patroon, relevantie, originaliteit, uitvoerbaarheid" : "Content Opportunity Score"}>{idea.opportunityScore || "–"}</span>
        <button type="button" onClick={copy} className={buttonClass({ variant: "secondary", size: "sm" })} aria-label="Idee kopiëren">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          <span className="hidden md:inline">{copied ? "Gekopieerd" : "Kopiëren"}</span>
        </button>
        {active ? (
          <button type="button" onClick={notRelevant} className={buttonClass({ variant: "ghost", size: "sm" })} aria-label="Niet relevant" title="Niet relevant">
            <ThumbsDown className="size-3.5" />
          </button>
        ) : null}
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Inklappen" : "Uitklappen"} className={buttonClass({ variant: "ghost", size: "sm" })}>
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Uitgeklapt: de volledige uitwerking */}
      {open ? (
        <div className="space-y-4 border-t border-[var(--color-line)] bg-[var(--color-surface-sunken)] px-5 py-4 sm:pl-15">
          {idea.concept ? (
            <div>
              <Label>Het idee</Label>
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
                    <input type="radio" name={`hook-${idea.id}`} checked={i === hook} onChange={() => setHook(i)} className="mt-1 accent-[var(--color-indigo-ink)]" />
                    <span>{h}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {idea.middenstuk.length > 0 ? (
            <div>
              <Label>Middenstuk (uitgeschreven voorstel)</Label>
              <div className="mt-1.5 space-y-0.5 rounded-md border-l-2 border-[var(--color-indigo-ink)] bg-white px-3 py-2.5 text-sm leading-relaxed text-[var(--color-ink)]">
                {idea.middenstuk.map((line, i) => <p key={i}>{line}</p>)}
              </div>
            </div>
          ) : null}

          <MiddenstukRichting ideaId={idea.id} initial={idea.middenstukRichting} onChange={setRichting} />

          {idea.ctaCommercieel || idea.ctaInteractie ? (
            <div>
              <Label>Call to action</Label>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {idea.ctaCommercieel ? (
                  <div className="rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm text-[var(--color-ink)]">
                    <span className="block text-2xs font-semibold text-[var(--color-ink-faint)]">Commercieel</span>
                    {idea.ctaCommercieel}
                  </div>
                ) : null}
                {idea.ctaInteractie ? (
                  <div className="rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm text-[var(--color-ink)]">
                    <span className="block text-2xs font-semibold text-[var(--color-ink-faint)]">Interactie</span>
                    {idea.ctaInteractie}
                  </div>
                ) : null}
              </div>
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
          </div>

          <div className="flex flex-wrap items-center gap-1 border-t border-[var(--color-line)] pt-3">
            {active ? (
              <>
                <button type="button" disabled={pending} onClick={() => run(() => favoriteIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}><Star className="size-3.5" /> Interessant</button>
                <button type="button" disabled={pending} onClick={() => run(() => saveIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}><Bookmark className="size-3.5" /> Later</button>
                <button type="button" disabled={pending} onClick={notRelevant} className={buttonClass({ variant: "ghost", size: "sm" })}><ThumbsDown className="size-3.5" /> Niet relevant</button>
                <button type="button" disabled={pending} onClick={() => run(() => markIdeaUsed(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}><CheckCheck className="size-3.5" /> Al gebruikt</button>
              </>
            ) : (
              <button type="button" disabled={pending} onClick={() => run(() => resetIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}><RotateCcw className="size-3.5" /> Terugzetten</button>
            )}
            <Link href={`/ai/content-research/${idea.clientId}?tab=chat&seed=${encodeURIComponent(idea.titel)}`} className={buttonClass({ variant: "ghost", size: "sm" })}><MessageSquare className="size-3.5" /> Spar</Link>
            {detailsHref ? (
              <Link href={detailsHref} className="ml-auto text-xs text-[var(--color-ink-muted)] underline">Onderbouwing en score</Link>
            ) : (
              <button type="button" onClick={() => setWhy((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] underline">
                Waarom dit idee <ChevronDown className={`size-3 transition-transform ${why ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>

          {why && !detailsHref ? <WhyThisIdea idea={idea} /> : null}
        </div>
      ) : null}
    </li>
  );
}

/** Onderbouwing, invalshoek, doel en de opbouw van de score (alleen op verzoek). */
function WhyThisIdea({ idea }: { idea: IdeaView }) {
  const share = idea.opportunity ? dataShare(idea.opportunity) : 0;
  return (
    <div className="space-y-3 rounded-md border border-[var(--color-line)] bg-white p-3">
      {idea.onderbouwing.length > 0 ? (
        <ul className="space-y-1.5">
          {idea.onderbouwing.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-ink-muted)]">
              <Badge tone={ZEKERHEID_TONE[e.zekerheid] ?? "neutral"} className="!px-1.5 !py-0 text-2xs">{e.zekerheid}</Badge>
              <span>
                <span className="font-medium text-[var(--color-ink)]">{EVIDENCE_LABEL[e.type] ?? e.type}:</span> {e.tekst}
                {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-[var(--color-ink)] underline">bron <ExternalLink className="size-3" /></a> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {idea.invalshoek ? <p className="text-xs text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Onze invalshoek:</span> {idea.invalshoek}</p> : null}
      {idea.herhaalReden ? <p className="text-xs text-[#8a5300]"><span className="font-medium">Waarom opnieuw:</span> {idea.herhaalReden}</p> : null}
      {idea.doel ? <p className="text-xs text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Verwachte doelstelling:</span> {idea.doel} (verwachting, geen garantie)</p> : null}
      {idea.scriptLink ? <a href={idea.scriptLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--color-ink)] underline"><FileText className="size-3" /> Script in Drive</a> : null}
      {idea.resultaat ? (
        <p className="inline-flex items-center gap-1 text-xs text-[var(--color-ink)]">
          <TrendingUp className="size-3.5" /> Resultaat: {idea.resultaat.views.toLocaleString("nl-NL")} weergaven
          {idea.resultaat.relatief != null ? `, ${idea.resultaat.relatief.toFixed(1).replace(".", ",")}x eigen mediaan` : ""}
        </p>
      ) : null}
      {idea.keuring ? (
        <div>
          <p className="mb-1.5 text-2xs text-[var(--color-ink-muted)]">
            Kwaliteitsscore {idea.keuring.totaal}: door de keuring (minimaal 80, stijl-fit minimaal 8). Zegt dat het idee sterk onderbouwd is en bij de klant past, geen voorspelling van weergaven.
          </p>
          <ul className="space-y-1">
            {QUALITY_PARTS.map((p) => {
              const part = idea.keuring!.onderdelen[p.key];
              if (!part) return null;
              return (
                <li key={p.key} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-36 shrink-0 text-[var(--color-ink-muted)]" title={p.uitleg}>{p.label} <span className="text-2xs">({p.gewicht}%)</span></span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]"><span className="block h-full rounded-full bg-[var(--color-indigo-ink)]" style={{ width: `${part.score * 10}%` }} /></span>
                    <span className="w-5 text-right tabular-nums">{part.score}</span>
                    <Badge tone={part.basis === "data" ? "good" : part.basis === "scripts" ? "info" : "neutral"} className="!px-1.5 !py-0 text-2xs">{part.basis}</Badge>
                  </div>
                  {part.toelichting ? <p className="ml-36 pl-2 text-2xs text-[var(--color-ink-muted)]">{part.toelichting}</p> : null}
                </li>
              );
            })}
          </ul>
          {idea.keuring.oordeel ? <p className="mt-2 text-xs text-[var(--color-ink)]"><span className="font-medium">Oordeel eindredactie:</span> {idea.keuring.oordeel}</p> : null}
          {idea.keuring.aanscherpen?.length ? (
            <div className="mt-2 text-xs text-[var(--color-ink-muted)]">
              <span className="font-medium text-[var(--color-ink)]">Aanscherpen bij uitwerken:</span>
              <ul className="mt-0.5 list-disc pl-4">{idea.keuring.aanscherpen.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          ) : null}
        </div>
      ) : idea.opportunity ? (
        <div>
          <p className="mb-1.5 text-2xs text-[var(--color-ink-muted)]">Opportunity Score {idea.opportunityScore}: {share}% rust op echte data, de rest is een inschatting. Geen voorspelling van weergaven.</p>
          <ul className="space-y-1">
            {OPPORTUNITY_PARTS.map((p) => {
              const part = idea.opportunity![p.key];
              return (
                <li key={p.key} className="flex items-center gap-2 text-xs">
                  <span className="w-44 shrink-0 text-[var(--color-ink-muted)]">{p.label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]"><span className="block h-full rounded-full bg-[var(--color-indigo-ink)]" style={{ width: `${part.score * 10}%` }} /></span>
                  <span className="w-5 text-right tabular-nums">{part.score}</span>
                  <Badge tone={part.basis === "data" ? "good" : "neutral"} className="!px-1.5 !py-0 text-2xs">{part.basis === "data" ? "data" : "inschatting"}</Badge>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
