"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import {
  confirmImport,
  decideCandidate,
  startDryRun,
} from "@/server/actions/integrations";
import { Badge, Button, ErrorNote, InfoNote } from "@/components/ui";

const PROVIDERS = [
  { key: "frameio", label: "Frame.io", detail: "projecten → klanten" },
  { key: "google_drive", label: "Google Drive", detail: "mappen → klanten" },
];

export function DryRunStarter() {
  const [selected, setSelected] = useState<string[]>(["frameio"]);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {PROVIDERS.map((p) => {
          const on = selected.includes(p.key);
          return (
            <label
              key={p.key}
              className={
                on
                  ? "sc-card cursor-pointer border-[var(--color-brand-500)] p-3"
                  : "sc-card cursor-pointer p-3"
              }
            >
              <span className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setSelected((s) =>
                      on ? s.filter((x) => x !== p.key) : [...s, p.key],
                    )
                  }
                  className="mt-0.5 size-4 accent-[var(--color-brand-500)]"
                />
                <span>
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-[var(--color-ink-muted)]">{p.detail}</span>
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <Button
        disabled={pending || selected.length === 0}
        onClick={() =>
          start(async () => {
            const res = await startDryRun(selected);
            setResult(res);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
        Dry run starten
      </Button>

      <p className="text-xs text-[var(--color-ink-muted)]">
        Een dry run kijkt alleen. Er verandert nog niets: je krijgt eerst een
        overzicht met voorstellen en conflicten.
      </p>

      {result ? (
        result.ok ? <InfoNote tone="good">{result.message}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}
    </div>
  );
}

export function CandidateRow({
  candidate,
  clients,
}: {
  candidate: {
    id: string;
    provider: string;
    externalName: string;
    externalId: string;
    suggestedEntityId: string | null;
    suggestedName: string | null;
    matchScore: number;
    decision: string;
    conflictReason: string | null;
  };
  clients: Array<{ id: string; name: string }>;
}) {
  const [pending, start] = useTransition();
  const [decision, setDecision] = useState(candidate.decision);
  const [target, setTarget] = useState(candidate.suggestedEntityId ?? "");
  const router = useRouter();

  function decide(next: "linked" | "created" | "skipped", entityId?: string) {
    setDecision(next);
    start(async () => {
      await decideCandidate(candidate.id, next, entityId);
      router.refresh();
    });
  }

  return (
    <tr>
      <td className="sc-td">
        <span className="block font-medium">{candidate.externalName}</span>
        <span className="block font-mono text-2xs text-[var(--color-ink-faint)]">
          {candidate.externalId}
        </span>
      </td>
      <td className="sc-td">
        <select
          className="sc-input"
          value={target}
          disabled={pending}
          onChange={(e) => {
            setTarget(e.target.value);
            if (e.target.value) decide("linked", e.target.value);
          }}
        >
          <option value="">— nieuwe klant aanmaken —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {candidate.conflictReason ? (
          <span className="mt-1 block text-xs text-[var(--color-warn)]">
            {candidate.conflictReason}
          </span>
        ) : null}
      </td>
      <td className="sc-td text-center">
        {candidate.matchScore > 0 ? (
          <Badge tone={candidate.matchScore >= 80 ? "good" : candidate.matchScore >= 50 ? "warn" : "neutral"}>
            {candidate.matchScore}%
          </Badge>
        ) : (
          <span className="text-[var(--color-ink-faint)]">geen match</span>
        )}
      </td>
      <td className="sc-td">
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={decision === "linked" ? "accent" : "secondary"}
            disabled={pending || !target}
            onClick={() => decide("linked", target)}
          >
            Koppelen
          </Button>
          <Button
            size="sm"
            variant={decision === "created" ? "accent" : "secondary"}
            disabled={pending}
            onClick={() => decide("created")}
          >
            Nieuw
          </Button>
          <Button
            size="sm"
            variant={decision === "skipped" ? "primary" : "ghost"}
            disabled={pending}
            onClick={() => decide("skipped")}
          >
            Overslaan
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function ConfirmImportButton({ runId, pendingCount }: { runId: string; pendingCount: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-2">
      {pendingCount > 0 ? (
        <p className="text-sm text-[var(--color-warn)]">
          {pendingCount} regels hebben nog geen beslissing. Die worden overgeslagen.
        </p>
      ) : null}
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await confirmImport(runId);
            setResult(res);
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Import definitief uitvoeren
      </Button>
      {result ? (
        result.ok ? <InfoNote tone="good">{result.message}</InfoNote> : <ErrorNote>{result.message}</ErrorNote>
      ) : null}
    </div>
  );
}
