"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Star, ThumbsDown, Bookmark, PenLine, MessageSquare, ExternalLink, Loader2, Copy, Check,
  CheckCheck, RotateCcw, ChevronDown, Repeat, TrendingUp, FileText,
} from "lucide-react";
import { Badge, buttonClass, ClientLogo, type Tone } from "@/components/ui";
import {
  favoriteIdea, forwardIdeaToGenerator, markIdeaUsed, rejectIdea, resetIdea, saveIdea, saveMiddenstukRichting,
} from "@/server/actions/content-research";
import { OPPORTUNITY_PARTS, dataShare } from "@/server/content-research/opportunity";
import { useLogoColor } from "@/lib/use-logo-color";
import { MiddenstukRichting } from "./middenstuk-richting";
import type { IdeaView } from "@/server/content-research/idea-view";

export type { Evidence, IdeaView } from "@/server/content-research/idea-view";
export type IdeaClient = { name: string; logoUrl: string | null; color: string | null };

const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  nieuw: { label: "Nieuw", tone: "info" },
  favoriet: { label: "Interessant", tone: "good" },
  opgeslagen: { label: "Bewaard voor later", tone: "neutral" },
  doorgestuurd: { label: "Doorgestuurd naar scripting", tone: "lime" },
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">{children}</p>;
}

/** Tekst voor "Idee kopiëren": in de vaste scriptopbouw, zodat je het overal kunt plakken. */
export function ideaToText(idea: IdeaView, clientName?: string, hookIndex = 0): string {
  const hooks = idea.hooks.length ? [idea.hooks[hookIndex] ?? idea.hooks[0]!, ...idea.hooks.filter((_, i) => i !== hookIndex)] : [];
  const lines = [
    `${idea.titel}${clientName ? ` (${clientName})` : ""}`,
    "",
    idea.concept ? `IDEE\n${idea.concept}` : "",
    hooks.length ? `HOOK\n${hooks[0]}${hooks.length > 1 ? `\nAlternatieven:\n- ${hooks.slice(1).join("\n- ")}` : ""}` : "",
    idea.middenstuk.length ? `MIDDENSTUK\n- ${idea.middenstuk.join("\n- ")}` : "",
    idea.middenstukRichting ? `RICHTING MIDDENSTUK (team)\n${idea.middenstukRichting}` : "",
    idea.cta ? `CALL TO ACTION\n${idea.cta}` : "",
    idea.invalshoek ? `INVALSHOEK\n${idea.invalshoek}` : "",
    idea.doel ? `VERWACHTE DOELSTELLING\n${idea.doel} (verwachting, geen garantie)` : "",
    idea.onderbouwing.length ? `ONDERBOUWING\n${idea.onderbouwing.map((e) => `- [${EVIDENCE_LABEL[e.type] ?? e.type}, ${e.zekerheid}] ${e.tekst}${e.url ? ` ${e.url}` : ""}`).join("\n")}` : "",
    `Content Opportunity Score: ${idea.opportunityScore}/100`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

/** Klantkop met logo en naam in de klantkleur: in één oogopslag zie je voor wie het idee is. */
export function ClientBand({ client, size = "md" }: { client: IdeaClient; size?: "md" | "lg" }) {
  const color = useLogoColor(client.logoUrl, client.color);
  const big = size === "lg";
  return (
    <div className="flex items-center gap-3 rounded-t-[inherit] px-4 py-2.5 text-white" style={{ background: color }}>
      <span className="rounded-lg bg-white p-0.5">
        <ClientLogo name={client.name} logoUrl={client.logoUrl} color={color} size={big ? 44 : 32} />
      </span>
      <span className={`${big ? "text-lg" : "text-sm"} font-semibold tracking-tight`}>{client.name}</span>
    </div>
  );
}

export function IdeaCard({ idea, client, showClient = false }: { idea: IdeaView; client: IdeaClient; showClient?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [copied, setCopied] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [hook, setHook] = useState(0);
  const [richting, setRichting] = useState(idea.middenstukRichting ?? "");
  const [notice, setNotice] = useState<string | null>(null);

  const st = STATUS_LABEL[idea.status] ?? STATUS_LABEL.nieuw;
  const share = idea.opportunity ? dataShare(idea.opportunity) : 0;
  const open = !["afgewezen", "gearchiveerd", "gebruikt"].includes(idea.status);

  function run(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  function toScriptEngine() {
    start(async () => {
      // Zorg dat de laatste richting is opgeslagen vóór de brief wordt opgebouwd.
      if ((idea.middenstukRichting ?? "") !== richting.trim()) await saveMiddenstukRichting(idea.id, richting);
      const res = await forwardIdeaToGenerator(idea.id);
      if (res.ok && res.url) {
        if (res.alreadyForwarded) setNotice("Dit idee is al eerder doorgestuurd. Je opent dezelfde uitwerking; er wordt geen tweede overdracht gemaakt.");
        router.push(`${res.url}&hook=${hook}`);
      } else router.refresh();
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(ideaToText({ ...idea, middenstukRichting: richting || null }, client.name, hook));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice("Kopiëren lukte niet in deze browser.");
    }
  }

  return (
    <article className="sc-card flex flex-col overflow-hidden">
      {showClient ? <ClientBand client={client} /> : null}

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Titel + score */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-snug text-[var(--color-ink)]">{idea.titel}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={st.tone}>{st.label}</Badge>
              <Badge tone="neutral">{idea.categorie}</Badge>
              <Badge tone="neutral">{idea.uitvoerbaarheid}</Badge>
              {idea.herhaalReden ? <Badge tone="warn"><Repeat className="size-3" /> Bewuste herhaling</Badge> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowScore((v) => !v)}
            className="shrink-0 rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-right hover:bg-[var(--color-surface-sunken)]"
            title="Content Opportunity Score: klik voor de opbouw"
          >
            <div className="text-2xl font-bold tabular-nums leading-none text-[var(--color-ink)]">{idea.opportunityScore || "–"}</div>
            <div className="mt-1 flex items-center justify-end gap-0.5 text-2xs text-[var(--color-ink-faint)]">
              Opportunity <ChevronDown className={`size-3 transition-transform ${showScore ? "rotate-180" : ""}`} />
            </div>
          </button>
        </div>

        {showScore && idea.opportunity ? (
          <div className="rounded-md bg-[var(--color-surface-sunken)] p-3">
            <p className="mb-2 text-2xs text-[var(--color-ink-muted)]">
              {share}% van het gewicht rust op echte data, de rest is een inschatting. Geen voorspelling van weergaven.
            </p>
            <ul className="space-y-1.5">
              {OPPORTUNITY_PARTS.map((p) => {
                const part = idea.opportunity![p.key];
                return (
                  <li key={p.key} className="text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-44 shrink-0 text-[var(--color-ink-muted)]">{p.label}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-line)]">
                        <span className="block h-full rounded-full bg-[var(--color-indigo-ink)]" style={{ width: `${part.score * 10}%` }} />
                      </span>
                      <span className="w-6 text-right tabular-nums text-[var(--color-ink)]">{part.score}</span>
                      <Badge tone={part.basis === "data" ? "good" : "neutral"} className="!px-1.5 !py-0 text-2xs">{part.basis === "data" ? "data" : "inschatting"}</Badge>
                    </div>
                    {part.toelichting ? <p className="ml-44 pl-2 text-2xs text-[var(--color-ink-faint)]">{part.toelichting}</p> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* 1. Het idee */}
        {idea.concept ? (
          <div>
            <SectionLabel>Het idee</SectionLabel>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-ink)]">{idea.concept}</p>
          </div>
        ) : null}

        {/* 2. Kies een hook */}
        {idea.hooks.length > 0 ? (
          <fieldset>
            <legend className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Kies een hook</legend>
            <div className="mt-1.5 space-y-1.5">
              {idea.hooks.map((h, i) => {
                const active = i === hook;
                return (
                  <label
                    key={i}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors ${active ? "border-[var(--color-indigo-ink)] bg-[var(--color-surface-sunken)] font-medium text-[var(--color-ink)]" : "border-[var(--color-line)] text-[var(--color-ink-muted)] hover:border-[var(--color-line-strong)]"}`}
                  >
                    <input type="radio" name={`hook-${idea.id}`} checked={active} onChange={() => setHook(i)} className="mt-1 accent-[var(--color-indigo-ink)]" />
                    <span>{h}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {/* 3. Middenstuk */}
        {idea.middenstuk.length > 0 ? (
          <div>
            <SectionLabel>Middenstuk: dit moet erin</SectionLabel>
            <ol className="mt-1.5 space-y-1">
              {idea.middenstuk.map((m, i) => (
                <li key={i} className="flex gap-2 text-sm text-[var(--color-ink)]">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-indigo-ink)] text-2xs font-semibold text-white">{i + 1}</span>
                  <span>{m}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <MiddenstukRichting ideaId={idea.id} initial={idea.middenstukRichting} onChange={setRichting} />

        {/* 4. Call to action */}
        {idea.cta ? (
          <div>
            <SectionLabel>Call to action</SectionLabel>
            <p className="mt-1 text-sm text-[var(--color-ink)]">{idea.cta}</p>
          </div>
        ) : null}

        {/* 5. Waarom dit idee (ingeklapt: scanbaar) */}
        <div className="rounded-md border border-[var(--color-line)]">
          <button type="button" onClick={() => setShowWhy((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-[var(--color-ink)]">
            <span>Waarom dit idee · {idea.onderbouwing.length} onderbouwing{idea.onderbouwing.length === 1 ? "" : "en"}{idea.doel ? " · doel" : ""}</span>
            <ChevronDown className={`size-4 transition-transform ${showWhy ? "rotate-180" : ""}`} />
          </button>
          {showWhy ? (
            <div className="space-y-2.5 border-t border-[var(--color-line)] px-3 py-2.5">
              {idea.onderbouwing.length > 0 ? (
                <ul className="space-y-1.5">
                  {idea.onderbouwing.map((e, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-ink-muted)]">
                      <Badge tone={ZEKERHEID_TONE[e.zekerheid] ?? "neutral"} className="!px-1.5 !py-0 text-2xs">{e.zekerheid}</Badge>
                      <span>
                        <span className="font-medium text-[var(--color-ink)]">{EVIDENCE_LABEL[e.type] ?? e.type}:</span> {e.tekst}
                        {e.url ? (
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-[var(--color-ink)] underline">
                            bron <ExternalLink className="size-3" />
                          </a>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : idea.waaromWerkt ? <p className="text-xs text-[var(--color-ink-muted)]">{idea.waaromWerkt}</p> : null}
              {idea.invalshoek ? <p className="text-xs text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Onze invalshoek:</span> {idea.invalshoek}</p> : null}
              {idea.herhaalReden ? <p className="text-xs text-[#8a5300]"><span className="font-medium">Waarom opnieuw:</span> {idea.herhaalReden}</p> : null}
              {idea.doel ? <p className="text-xs text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Verwachte doelstelling:</span> {idea.doel} <span className="text-[var(--color-ink-faint)]">(verwachting, geen garantie)</span></p> : null}
              {idea.inspiratieUrl ? (
                <a href={idea.inspiratieUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--color-ink)] underline">
                  {idea.inspiratieLabel || "Inspiratiebron"} <ExternalLink className="size-3" />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        {idea.scriptLink || idea.resultaat ? (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {idea.scriptLink ? (
              <a href={idea.scriptLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-ink)] underline">
                <FileText className="size-3" /> Script in Drive
              </a>
            ) : null}
            {idea.resultaat ? (
              <span className="inline-flex items-center gap-1 text-[var(--color-ink)]">
                <TrendingUp className="size-3.5" /> Resultaat: {idea.resultaat.views.toLocaleString("nl-NL")} weergaven
                {idea.resultaat.relatief != null ? `, ${idea.resultaat.relatief.toFixed(1).replace(".", ",")}x eigen mediaan` : ""}
              </span>
            ) : null}
          </div>
        ) : null}

        {idea.status === "afgewezen" && idea.rejectionReason ? (
          <p className="text-xs text-[var(--color-bad)]">Niet relevant: {idea.rejectionReason}</p>
        ) : null}

        {notice ? <p className="text-xs text-[#8a5300]">{notice}</p> : null}

        {rejecting ? (
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Waarom niet relevant? (het onderzoek leert hiervan)"
              aria-label="Reden"
              className="sc-input flex-1 text-sm"
            />
            <button type="button" disabled={pending} onClick={() => run(() => rejectIdea(idea.id, reason))} className={buttonClass({ variant: "danger", size: "sm" })}>
              Niet relevant
            </button>
            <button type="button" onClick={() => setRejecting(false)} className={buttonClass({ variant: "ghost", size: "sm" })}>Annuleren</button>
          </div>
        ) : (
          <div className="mt-auto space-y-2 border-t border-[var(--color-line)] pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} onClick={toScriptEngine} className={buttonClass({ variant: "primary", size: "sm", className: "flex-1" })}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}
                {idea.forwardedAt ? "Open uitwerking" : `Uitwerken in Script Engine (hook ${hook + 1})`}
              </button>
              <button type="button" onClick={copy} className={buttonClass({ variant: "secondary", size: "sm" })}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Gekopieerd" : "Idee kopiëren"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {open ? (
                <>
                  <button type="button" disabled={pending} onClick={() => run(() => favoriteIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    <Star className="size-3.5" /> Interessant
                  </button>
                  <button type="button" disabled={pending} onClick={() => run(() => saveIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    <Bookmark className="size-3.5" /> Later
                  </button>
                  <button type="button" disabled={pending} onClick={() => setRejecting(true)} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    <ThumbsDown className="size-3.5" /> Niet relevant
                  </button>
                  <button type="button" disabled={pending} onClick={() => run(() => markIdeaUsed(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>
                    <CheckCheck className="size-3.5" /> Al gebruikt
                  </button>
                </>
              ) : (
                <button type="button" disabled={pending} onClick={() => run(() => resetIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>
                  <RotateCcw className="size-3.5" /> Terugzetten
                </button>
              )}
              <Link href={`/ai/content-research/${idea.clientId}?tab=chat&seed=${encodeURIComponent(idea.titel)}`} className={buttonClass({ variant: "ghost", size: "sm", className: "ml-auto" })} aria-label="Spar met AI over dit idee">
                <MessageSquare className="size-3.5" /> Spar
              </Link>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
