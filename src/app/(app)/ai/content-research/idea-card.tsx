"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Star, ThumbsDown, Bookmark, PenLine, MessageSquare, ExternalLink, Loader2, Target, Copy, Check,
  CheckCheck, RotateCcw, ChevronDown, Repeat, TrendingUp, FileText,
} from "lucide-react";
import { Badge, buttonClass, type Tone } from "@/components/ui";
import {
  favoriteIdea, forwardIdeaToGenerator, markIdeaUsed, rejectIdea, resetIdea, saveIdea,
} from "@/server/actions/content-research";
import { OPPORTUNITY_PARTS, dataShare, type Opportunity } from "@/server/content-research/opportunity";

export type Evidence = { type: string; tekst: string; zekerheid: string; url: string | null };

export type IdeaView = {
  id: string;
  clientId: string;
  titel: string;
  concept: string;
  hooks: string[];
  waaromWerkt: string | null;
  doel: string | null;
  inspiratieUrl: string | null;
  inspiratieLabel: string | null;
  categorie: string;
  uitvoerbaarheid: string;
  score: number;
  scoreReason: string | null;
  status: string;
  rejectionReason: string | null;
  invalshoek: string | null;
  herhaalReden: string | null;
  onderbouwing: Evidence[];
  opportunity: Opportunity | null;
  opportunityScore: number;
  forwardedAt: string | null;
  scriptLink: string | null;
  resultaat: { posts: number; views: number; relatief: number | null } | null;
  createdAt: string;
};

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

function scoreTone(n: number): string {
  if (n >= 75) return "text-[var(--color-good)]";
  if (n >= 55) return "text-[var(--color-ink)]";
  return "text-[var(--color-ink-muted)]";
}

/** Tekst voor "Idee kopiëren": compleet, zodat je het overal kunt plakken. */
export function ideaToText(idea: IdeaView, clientName?: string): string {
  const lines = [
    `${idea.titel}${clientName ? ` (${clientName})` : ""}`,
    "",
    idea.concept ? `Concept: ${idea.concept}` : "",
    idea.hooks[0] ? `Hook: ${idea.hooks[0]}` : "",
    idea.hooks.length > 1 ? `Alternatieve hooks: ${idea.hooks.slice(1).join(" / ")}` : "",
    idea.invalshoek ? `Invalshoek: ${idea.invalshoek}` : "",
    idea.doel ? `Verwachte doelstelling: ${idea.doel} (verwachting, geen garantie)` : "",
    idea.onderbouwing.length ? `Onderbouwing:\n${idea.onderbouwing.map((e) => `- [${EVIDENCE_LABEL[e.type] ?? e.type}, ${e.zekerheid}] ${e.tekst}${e.url ? ` ${e.url}` : ""}`).join("\n")}` : "",
    idea.inspiratieUrl ? `Bron: ${idea.inspiratieUrl}` : "",
    `Content Opportunity Score: ${idea.opportunityScore}/100`,
  ];
  return lines.filter((l, i) => l || i === 1).join("\n");
}

export function IdeaCard({ idea, clientName }: { idea: IdeaView; clientName?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [copied, setCopied] = useState(false);
  const [showScore, setShowScore] = useState(false);
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
      const res = await forwardIdeaToGenerator(idea.id);
      if (res.ok && res.url) {
        if (res.alreadyForwarded) setNotice("Dit idee is al eerder doorgestuurd. Je opent dezelfde uitwerking; er wordt geen tweede overdracht gemaakt.");
        router.push(res.url);
      } else router.refresh();
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(ideaToText(idea, clientName));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice("Kopiëren lukte niet in deze browser.");
    }
  }

  return (
    <div className="sc-card flex flex-col gap-3 p-4">
      {/* Kop: titel + score */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-[var(--color-ink)]">{idea.titel}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge tone="neutral">{idea.categorie}</Badge>
            <Badge tone="neutral">{idea.uitvoerbaarheid}</Badge>
            {idea.herhaalReden ? <Badge tone="warn"><Repeat className="size-3" /> Herhaling</Badge> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowScore((v) => !v)}
          className="shrink-0 rounded-md px-2 py-1 text-right hover:bg-[var(--color-surface-sunken)]"
          title="Content Opportunity Score: klik voor de opbouw"
        >
          <div className={`text-2xl font-semibold tabular-nums leading-none ${scoreTone(idea.opportunityScore)}`}>{idea.opportunityScore || "–"}</div>
          <div className="mt-1 flex items-center justify-end gap-0.5 text-2xs text-[var(--color-ink-faint)]">
            Opportunity <ChevronDown className={`size-3 transition-transform ${showScore ? "rotate-180" : ""}`} />
          </div>
        </button>
      </div>

      {showScore && idea.opportunity ? (
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3">
          <p className="mb-2 text-2xs text-[var(--color-ink-faint)]">
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
                    <span className="w-8 text-right tabular-nums text-[var(--color-ink)]">{part.score}</span>
                    <Badge tone={part.basis === "data" ? "good" : "neutral"} className="!px-1.5 !py-0 text-2xs">{part.basis === "data" ? "data" : "inschatting"}</Badge>
                  </div>
                  {part.toelichting ? <p className="ml-44 pl-2 text-2xs text-[var(--color-ink-faint)]">{part.toelichting}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {idea.concept ? <p className="text-sm text-[var(--color-ink-muted)]">{idea.concept}</p> : null}

      {idea.hooks.length > 0 ? (
        <div className="rounded-md border-l-2 border-[var(--color-indigo-ink)] bg-[var(--color-surface-sunken)] px-3 py-2">
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Voorstel hook</p>
          <p className="mt-0.5 text-sm font-medium text-[var(--color-ink)]">{idea.hooks[0]}</p>
          {idea.hooks.length > 1 ? (
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Alternatief: {idea.hooks.slice(1).join(" / ")}</p>
          ) : null}
        </div>
      ) : null}

      {idea.invalshoek ? (
        <p className="text-xs text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Onze invalshoek:</span> {idea.invalshoek}</p>
      ) : null}

      {/* Onderbouwing met herkomst en zekerheid */}
      {idea.onderbouwing.length > 0 ? (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Onderbouwing</p>
          <ul className="mt-1 space-y-1">
            {idea.onderbouwing.map((e, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-[var(--color-ink-muted)]">
                <Badge tone={ZEKERHEID_TONE[e.zekerheid] ?? "neutral"} className="!px-1.5 !py-0 text-2xs">{e.zekerheid}</Badge>
                <span>
                  <span className="font-medium text-[var(--color-ink)]">{EVIDENCE_LABEL[e.type] ?? e.type}:</span> {e.tekst}
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-[var(--color-brand-600)] hover:underline">
                      bron <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : idea.waaromWerkt ? (
        <p className="text-xs text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Waarom dit werkt:</span> {idea.waaromWerkt}</p>
      ) : null}

      {idea.herhaalReden ? (
        <p className="text-xs text-[var(--color-warn)]"><span className="font-medium">Waarom opnieuw:</span> {idea.herhaalReden}</p>
      ) : null}

      {idea.doel ? (
        <p className="inline-flex items-start gap-1.5 self-start rounded-md bg-[var(--color-info-soft)] px-2 py-1 text-xs text-[#0060a8]">
          <Target className="mt-0.5 size-3.5 shrink-0" />
          <span><span className="font-semibold">Verwachte doelstelling:</span> {idea.doel} <span className="opacity-70">(verwachting, geen garantie)</span></span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {idea.inspiratieUrl ? (
          <a href={idea.inspiratieUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline">
            {idea.inspiratieLabel || "Inspiratiebron"} <ExternalLink className="size-3" />
          </a>
        ) : null}
        {idea.scriptLink ? (
          <a href={idea.scriptLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline">
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

      {idea.status === "afgewezen" && idea.rejectionReason ? (
        <p className="text-xs text-[var(--color-bad)]">Niet relevant: {idea.rejectionReason}</p>
      ) : null}

      {notice ? <p className="text-xs text-[var(--color-warn)]">{notice}</p> : null}

      {rejecting ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Waarom niet relevant? (het onderzoek leert hiervan)"
            className="sc-input flex-1 text-sm"
          />
          <button type="button" disabled={pending} onClick={() => run(() => rejectIdea(idea.id, reason))} className={buttonClass({ variant: "danger", size: "sm" })}>
            Niet relevant
          </button>
          <button type="button" onClick={() => setRejecting(false)} className={buttonClass({ variant: "ghost", size: "sm" })}>Annuleren</button>
        </div>
      ) : (
        <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-[var(--color-line)] pt-3">
          {open ? (
            <>
              <button type="button" disabled={pending} onClick={() => run(() => favoriteIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })} title="Interessant">
                <Star className="size-3.5" /> Interessant
              </button>
              <button type="button" disabled={pending} onClick={() => run(() => saveIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })} title="Bewaren voor later">
                <Bookmark className="size-3.5" /> Later
              </button>
              <button type="button" disabled={pending} onClick={() => setRejecting(true)} className={buttonClass({ variant: "ghost", size: "sm" })} title="Niet relevant">
                <ThumbsDown className="size-3.5" /> Niet relevant
              </button>
              <button type="button" disabled={pending} onClick={() => run(() => markIdeaUsed(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })} title="Al gebruikt">
                <CheckCheck className="size-3.5" /> Al gebruikt
              </button>
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => run(() => resetIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>
              <RotateCcw className="size-3.5" /> Terugzetten
            </button>
          )}
          <Link href={`/ai/content-research/${idea.clientId}?tab=chat&seed=${encodeURIComponent(idea.titel)}`} className={buttonClass({ variant: "ghost", size: "sm" })} title="Spar met AI">
            <MessageSquare className="size-3.5" />
          </Link>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={copy} className={buttonClass({ variant: "secondary", size: "sm" })}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Gekopieerd" : "Idee kopiëren"}
            </button>
            <button type="button" disabled={pending} onClick={toScriptEngine} className={buttonClass({ variant: "primary", size: "sm" })}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}
              {idea.forwardedAt ? "Open uitwerking" : "Uitwerken in Script Engine"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
