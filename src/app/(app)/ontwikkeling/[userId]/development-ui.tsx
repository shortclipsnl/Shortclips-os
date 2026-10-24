"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, GraduationCap, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui";
import { generateDevelopment, updateDevelopmentPoint } from "@/server/actions/development";

export type UiPoint = {
  id: string;
  type: string;
  category: string;
  title: string;
  description: string;
  advies: string;
  zekerheid: string;
  status: string;
  source: string;
  kbCourseId: string | null;
  kbLessonId: string | null;
  lessonTitle: string | null;
  courseTitle: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "Mee bezig",
  resolved: "Afgerond",
  dismissed: "Niet van toepassing",
};
const ZEKER: Record<string, { label: string; tone: "good" | "info" | "warn" }> = {
  bewezen: { label: "Bewezen", tone: "good" },
  waarschijnlijk: { label: "Waarschijnlijk", tone: "info" },
  hypothese: { label: "Hypothese", tone: "warn" },
};

export function GenerateButton({ userId, hasPoints, available }: { userId: string; hasPoints: boolean; available: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  function run() {
    setMsg(null);
    start(async () => {
      const res = await generateDevelopment(userId);
      if (res.ok) router.refresh();
      else setMsg(res.message ?? "Mislukt");
    });
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending || !available}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[var(--color-indigo-soft)] disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {hasPoints ? "Analyse verversen" : "AI-analyse genereren"}
      </button>
      {!available ? (
        <span className="text-2xs text-[var(--color-ink-faint)]">AI-koppeling staat uit (ANTHROPIC_API_KEY).</span>
      ) : null}
      {msg ? <span className="text-xs text-[var(--color-bad)]">{msg}</span> : null}
    </div>
  );
}

export function PointCard({ point, isManager, isSelf }: { point: UiPoint; isManager: boolean; isSelf: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const z = ZEKER[point.zekerheid] ?? ZEKER.hypothese!;
  const done = point.status === "resolved";
  const dismissed = point.status === "dismissed";

  function setStatus(status: string) {
    start(async () => {
      const res = await updateDevelopmentPoint(point.id, { status });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div
      className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
      style={done || dismissed ? { opacity: 0.6 } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-ink)]">{point.title}</span>
            <Badge tone={z.tone}>{z.label}</Badge>
            <Badge tone="neutral">{point.category}</Badge>
            {point.status !== "open" ? (
              <Badge tone={done ? "good" : dismissed ? "neutral" : "info"}>{STATUS_LABEL[point.status] ?? point.status}</Badge>
            ) : null}
          </div>
          {point.description ? <p className="mt-1.5 text-sm text-[var(--color-ink-muted)]">{point.description}</p> : null}
          {point.advies ? (
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]"><strong className="font-semibold text-[var(--color-ink)]">Advies:</strong> {point.advies}</p>
          ) : null}
          {point.kbLessonId && point.kbCourseId ? (
            <Link
              href={`/kennisbank/${point.kbCourseId}?les=${point.kbLessonId}`}
              className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-2.5 py-1 text-xs font-medium text-[var(--color-brand-700)] hover:underline"
            >
              <GraduationCap className="size-3.5" /> Training: {point.lessonTitle ?? point.courseTitle}
            </Link>
          ) : null}
        </div>
      </div>

      {/* Acties */}
      {(isManager || isSelf) && !done && !dismissed ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
          {isSelf && point.status !== "in_progress" ? (
            <button type="button" onClick={() => setStatus("in_progress")} disabled={pending}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60">
              Ik pak dit op
            </button>
          ) : null}
          {isManager ? (
            <>
              <button type="button" onClick={() => setStatus("resolved")} disabled={pending}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-good)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60">
                <CheckCircle2 className="size-3.5" /> Afgerond
              </button>
              <button type="button" onClick={() => setStatus("dismissed")} disabled={pending}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-60">
                Niet van toepassing
              </button>
            </>
          ) : null}
          {pending ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : null}
        </div>
      ) : null}
      {(isManager || isSelf) && (done || dismissed) ? (
        <div className="mt-3 border-t border-[var(--color-line)] pt-3">
          <button type="button" onClick={() => setStatus("open")} disabled={pending}
            className="text-xs font-medium text-[var(--color-ink-muted)] hover:underline disabled:opacity-60">
            Heropenen
          </button>
        </div>
      ) : null}
    </div>
  );
}
