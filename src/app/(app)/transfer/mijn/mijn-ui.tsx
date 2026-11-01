"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Loader2, RotateCw, Trash2 } from "lucide-react";
import { Badge, Button, Card, type Tone } from "@/components/ui";
import { deleteTransfer, reactivateTransfer } from "@/server/actions/transfer";
import type { MyTransferRow } from "@/server/transfer/service";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  uploading: { label: "Uploaden", tone: "info" },
  available: { label: "Beschikbaar", tone: "good" },
  expired: { label: "Verlopen", tone: "warn" },
  deleted: { label: "Verwijderd", tone: "neutral" },
};

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

export function MyTransfersList({ rows }: { rows: MyTransferRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map((r) => <TransferRow key={r.id} row={r} />)}
    </div>
  );
}

function TransferRow({ row }: { row: MyTransferRow }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [busy, start] = useTransition();
  const st = STATUS[row.status] ?? STATUS.deleted!;
  const removed = row.status === "deleted";

  async function copy() {
    try { await navigator.clipboard.writeText(row.link); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* geweigerd */ }
  }
  function del() {
    if (!window.confirm("Deze transfer en de bestanden definitief verwijderen?")) return;
    start(async () => { await deleteTransfer({ transferId: row.id }); router.refresh(); });
  }
  function reactivate() {
    start(async () => { await reactivateTransfer({ transferId: row.id }); router.refresh(); });
  }

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.title}</p>
          <p className="text-xs text-[var(--color-ink-faint)] tabular-nums">
            {row.fileCount} bestand{row.fileCount === 1 ? "" : "en"} · {fmtBytes(row.totalBytes)} · {fmtDate(row.createdAt)}
          </p>
        </div>
        <div className="hidden text-xs text-[var(--color-ink-muted)] sm:block tabular-nums">
          <div>Vervalt: {fmtDate(row.downloadExpiresOn)}</div>
          <div className="flex items-center gap-1"><Download className="size-3" /> {row.downloadCount}×</div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
        <div className="flex items-center gap-1">
          {!removed ? (
            <Button size="sm" variant="ghost" onClick={copy}>{copied ? <Check className="size-3.5 text-[var(--color-good)]" /> : <Copy className="size-3.5" />} Link</Button>
          ) : null}
          {row.status === "expired" ? (
            <Button size="sm" variant="ghost" onClick={reactivate} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />} Heractiveren</Button>
          ) : null}
          {!removed ? (
            <Button size="sm" variant="ghost" onClick={del} disabled={busy}><Trash2 className="size-3.5" /> Verwijderen</Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
