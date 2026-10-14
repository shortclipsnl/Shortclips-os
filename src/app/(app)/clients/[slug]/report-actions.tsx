"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Send, Undo2 } from "lucide-react";
import { generateMonthlyReport, publishReport, unpublishReport } from "@/server/actions/reports";

export function GenerateReportButton({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await generateMonthlyReport(slug);
            setMsg(res.ok ? "Concept bijgewerkt" : res.message ?? "Mislukt");
            if (res.ok) router.refresh();
          })
        }
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
        Rapport genereren (deze maand)
      </button>
      {msg ? <span className="text-xs text-[var(--color-ink-muted)]">{msg}</span> : null}
    </div>
  );
}

export function ReportPublishToggle({ reportId, published }: { reportId: string; published: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  function act() {
    start(async () => {
      const res = published ? await unpublishReport(reportId) : await publishReport(reportId);
      if (res.ok) router.refresh();
    });
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={act}
      className={
        published
          ? "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-60"
          : "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-good)] px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
      }
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : published ? <Undo2 className="size-3.5" /> : <Send className="size-3.5" />}
      {published ? "Publicatie terugtrekken" : "Keuren & publiceren"}
    </button>
  );
}
