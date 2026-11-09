import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { formatDateTime, relativeDays } from "@/lib/format";
import { getDriveStatus } from "@/server/integrations/drive-status";
import { DriveSyncButton } from "./actions-ui";

const CONNECTION = {
  actief: { label: "Actief", tone: "good" as const, Icon: CheckCircle2, color: "var(--color-good)" },
  aandacht: { label: "Aandacht nodig", tone: "warn" as const, Icon: AlertCircle, color: "var(--color-warn)" },
  verbroken: { label: "Verbroken", tone: "bad" as const, Icon: XCircle, color: "var(--color-bad)" },
  niet_ingesteld: { label: "Niet ingesteld", tone: "neutral" as const, Icon: AlertCircle, color: "var(--color-ink-faint)" },
};
const SYNC = {
  actueel: { label: "Actueel", tone: "good" as const },
  bezig: { label: "Bezig", tone: "neutral" as const },
  fout: { label: "Fout", tone: "bad" as const },
};

function when(d: Date | null): string {
  return d ? `${formatDateTime(d)} (${relativeDays(d)})` : "nog nooit";
}

/**
 * Gezondheid van de Google Drive-koppeling in één oogopslag. Benodigde actie
 * verschijnt alleen als er echt iets moet gebeuren.
 */
export async function DriveStatusCard({ isOwner, notice }: { isOwner: boolean; notice?: { ok: boolean; text: string } }) {
  const s = await getDriveStatus({ peekPending: true });
  const c = CONNECTION[s.connection];
  const pending = s.pending === null ? "onbekend" : `${s.pending.count}${s.pending.more ? "+" : ""}`;

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <c.Icon className="size-5" style={{ color: c.color }} strokeWidth={1.75} />
            <h2 className="text-base font-semibold">Google Drive: integratiestatus</h2>
            <Badge tone={c.tone}>{c.label}</Badge>
          </div>
          <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Item label="Verbinding" value={c.label} />
            <Item label="Synchronisatiestatus" value={<Badge tone={SYNC[s.sync].tone}>{SYNC[s.sync].label}</Badge>} />
            <Item label="Laatste succesvolle synchronisatie" value={when(s.lastSuccessAt)} />
            <Item label="Laatste controle" value={when(s.lastCheckAt)} />
            <Item label="Openstaande wijzigingen" value={pending} />
            <Item label="Mislukte synchronisaties (24 uur)" value={String(s.failed24h)} />
            <Item label="Verbonden account" value={s.account ?? "nog niet vastgesteld"} />
            <Item
              label="Klantmappen volledig gecontroleerd"
              value={`${s.foldersTotal - s.foldersNotVerified} van ${s.foldersTotal} (laatste 48 uur)`}
            />
          </dl>
        </div>
        <div className="w-full shrink-0 space-y-2 sm:w-56">
          <DriveSyncButton />
          <p className="text-xs text-[var(--color-ink-muted)]">
            Wijzigingen in Drive worden automatisch elke 2 minuten opgehaald.
          </p>
        </div>
      </div>

      {notice ? (
        <div
          className={`border-t px-5 py-3 text-sm ${notice.ok ? "border-[var(--color-good)]/30 bg-[var(--color-good-soft)]" : "border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)]"}`}
        >
          {notice.text}
        </div>
      ) : null}

      {s.action ? (
        <div
          className={`border-t px-5 py-3 text-sm ${s.connection === "verbroken" ? "border-[var(--color-bad)]/30 bg-[var(--color-bad-soft)]" : "border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)]"}`}
        >
          <p>
            <strong className="font-semibold">Benodigde actie:</strong> {s.action}
          </p>
          {s.reason ? <p className="mt-1 text-[var(--color-ink-muted)]">Oorzaak: {s.reason}</p> : null}
          {s.canReconnect && isOwner ? (
            <a
              href="/api/integrations/google/connect"
              className="mt-2 inline-flex rounded-[var(--radius-sm)] bg-[var(--color-brand-500)] px-3 py-1.5 text-sm font-medium text-white"
            >
              Opnieuw verbinden met Google
            </a>
          ) : null}
        </div>
      ) : s.connection === "aandacht" && s.reason ? (
        <div className="border-t border-[var(--color-warn)]/30 bg-[var(--color-warn-soft)] px-5 py-3 text-sm">{s.reason}</div>
      ) : null}
    </Card>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)] py-1.5">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
