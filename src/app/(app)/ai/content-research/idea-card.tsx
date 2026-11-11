"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Star, ThumbsDown, Bookmark, Archive, PenLine, MessageSquare, ExternalLink, Loader2, Target } from "lucide-react";
import { Badge, buttonClass, type Tone } from "@/components/ui";
import {
  archiveIdea,
  favoriteIdea,
  forwardIdeaToGenerator,
  rejectIdea,
  saveIdea,
} from "@/server/actions/content-research";

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
};

const CAT_TONE: Record<string, Tone> = {
  humor: "lime",
  educatief: "info",
  teamcontent: "violet",
  trends: "good",
  productcontent: "warn",
  seizoen: "neutral",
  overig: "neutral",
};
const STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  nieuw: { label: "Nieuw", tone: "info" },
  favoriet: { label: "Favoriet", tone: "good" },
  opgeslagen: { label: "Opgeslagen", tone: "violet" },
  afgewezen: { label: "Afgewezen", tone: "bad" },
  gearchiveerd: { label: "Gearchiveerd", tone: "neutral" },
  doorgestuurd: { label: "Doorgestuurd", tone: "lime" },
};

export function IdeaCard({ idea }: { idea: IdeaView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const st = STATUS_LABEL[idea.status] ?? STATUS_LABEL.nieuw;

  function run(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  function makeScript() {
    start(async () => {
      const res = await forwardIdeaToGenerator(idea.id);
      if (res.ok && res.url) router.push(res.url);
      else router.refresh();
    });
  }

  return (
    <div className="sc-card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">{idea.titel}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={CAT_TONE[idea.categorie] ?? "neutral"}>{idea.categorie}</Badge>
            <Badge tone="neutral">{idea.uitvoerbaarheid}</Badge>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
        </div>
        <div className="shrink-0 text-right" title="Interne AI-kwaliteitsinschatting — géén voorspelling van weergaven">
          <div className="text-lg font-semibold tabular-nums text-[var(--color-brand-600)]">{idea.score}/10</div>
          <div className="text-2xs text-[var(--color-ink-faint)]">AI-score</div>
        </div>
      </div>

      {idea.concept ? <p className="text-sm text-[var(--color-ink-muted)]">{idea.concept}</p> : null}

      {idea.hooks.length > 0 ? (
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Hooks</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {idea.hooks.map((h, i) => (
              <li key={i} className="text-[var(--color-ink)]">“{h}”</li>
            ))}
          </ul>
        </div>
      ) : null}

      {idea.waaromWerkt ? (
        <p className="text-xs text-[var(--color-ink-muted)]"><span className="font-medium text-[var(--color-ink)]">Waarom dit werkt:</span> {idea.waaromWerkt}</p>
      ) : null}

      {idea.doel ? (
        <p className="inline-flex items-start gap-1.5 rounded-md bg-[var(--color-info-soft)] px-2 py-1 text-xs text-[var(--color-info)]">
          <Target className="mt-0.5 size-3.5 shrink-0" />
          <span><span className="font-semibold">Doel:</span> {idea.doel}</span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {idea.inspiratieUrl ? (
          <a href={idea.inspiratieUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--color-brand-600)] hover:underline">
            {idea.inspiratieLabel || "Inspiratiebron"} <ExternalLink className="size-3" />
          </a>
        ) : null}
        {idea.scoreReason ? <span className="text-[var(--color-ink-faint)]">{idea.scoreReason}</span> : null}
      </div>

      {idea.status === "afgewezen" && idea.rejectionReason ? (
        <p className="text-xs text-[var(--color-bad)]">Afgewezen: {idea.rejectionReason}</p>
      ) : null}

      {rejecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Waarom niet interessant? (de AI leert hiervan)"
            className="sc-input flex-1 text-sm"
          />
          <button type="button" disabled={pending} onClick={() => run(() => rejectIdea(idea.id, reason))} className={buttonClass({ variant: "danger", size: "sm" })}>
            Afwijzen
          </button>
          <button type="button" onClick={() => setRejecting(false)} className={buttonClass({ variant: "ghost", size: "sm" })}>Annuleren</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
          <button type="button" disabled={pending} onClick={() => run(() => favoriteIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>
            <Star className="size-3.5" /> Favoriet
          </button>
          <button type="button" disabled={pending} onClick={() => setRejecting(true)} className={buttonClass({ variant: "ghost", size: "sm" })}>
            <ThumbsDown className="size-3.5" /> Niet interessant
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => saveIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>
            <Bookmark className="size-3.5" /> Opslaan
          </button>
          <button type="button" disabled={pending} onClick={() => run(() => archiveIdea(idea.id))} className={buttonClass({ variant: "ghost", size: "sm" })}>
            <Archive className="size-3.5" /> Archiveren
          </button>
          <Link href={`/ai/content-research/${idea.clientId}?tab=chat&seed=${encodeURIComponent(idea.titel)}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
            <MessageSquare className="size-3.5" /> Spar met AI
          </Link>
          <button type="button" disabled={pending} onClick={makeScript} className={buttonClass({ variant: "primary", size: "sm", className: "ml-auto" })}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />} Maak script
          </button>
        </div>
      )}
    </div>
  );
}
