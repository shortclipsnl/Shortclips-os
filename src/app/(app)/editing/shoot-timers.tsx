import Link from "next/link";
import { AlertTriangle, Camera } from "lucide-react";
import { Badge, Card, ClientLogo, TeamAvatar } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { ShootColor, ShootDeadline } from "@/server/shoot-deadlines";

const COLOR: Record<ShootColor, { bar: string; soft: string; text: string; label: string }> = {
  groen: { bar: "var(--color-good)", soft: "var(--color-good-soft)", text: "#1d6b4c", label: "Op schema" },
  blauw: { bar: "var(--color-brand-600)", soft: "var(--color-info-soft)", text: "#0060a8", label: "Bij de editor" },
  oranje: { bar: "var(--color-warn)", soft: "var(--color-warn-soft)", text: "#8a5300", label: "Deadline nadert" },
  rood: { bar: "var(--color-bad)", soft: "var(--color-bad-soft)", text: "#a3271c", label: "Aandacht nodig" },
};

/** Werkdagen-tekst met teken: "over 3 werkdagen" / "vandaag" / "2 werkdagen te laat". */
function wdText(n: number): string {
  if (n === 0) return "vandaag";
  if (n > 0) return `over ${n} werkdag${n === 1 ? "" : "en"}`;
  return `${-n} werkdag${-n === 1 ? "" : "en"} te laat`;
}

export function ShootTimers({ shoots }: { shoots: ShootDeadline[] }) {
  // Positie van de editordeadline op de balk (12 van 14 werkdagen).
  const editorMarkPct = ((shoots[0]?.totalWorkdays ?? 14) - 2) / (shoots[0]?.totalWorkdays ?? 14) * 100;

  return (
    <div className="space-y-3">
      {shoots.map((s) => {
        const c = COLOR[s.color];
        const pct = Math.min(100, Math.round((s.elapsedWorkdays / s.totalWorkdays) * 100));
        return (
          <Card key={s.shootId} padded={false} className="overflow-hidden">
            <div className="flex items-stretch">
              <span className="w-1.5 shrink-0" style={{ background: c.bar }} aria-hidden />
              <div className="min-w-0 flex-1 p-4">
                {/* Kop: klant + opnamedatum + kleurstatus */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ClientLogo name={s.clientName} logoUrl={s.clientLogo} color={s.clientColor} size={28} />
                    <div className="min-w-0">
                      <Link href={`/productions/${s.shootId}`} className="block truncate font-semibold hover:underline">{s.clientName}</Link>
                      <span className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)]">
                        <Camera className="size-3" /> Opname {formatDate(s.shootDate)}
                        <span className="text-[var(--color-ink-faint)]">· {s.deliveredCount}/{s.totalCount} opgeleverd</span>
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: c.soft, color: c.text }}>
                    {s.atRisk ? <AlertTriangle className="size-3.5" /> : null}
                    {c.label}
                  </span>
                </div>

                {/* Voortgangsbalk: verstreken vs. resterende werkdagen, met editordeadline-markering */}
                <div className="mt-3">
                  <div className="relative h-2.5 rounded-full bg-[var(--color-neutral-soft)]">
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: c.bar }} />
                    <span className="absolute top-[-2px] h-[14px] w-0.5 bg-[var(--color-ink)]/50" style={{ left: `${editorMarkPct}%` }} title="Editordeadline" aria-hidden />
                  </div>
                  <div className="mt-1 flex justify-between text-2xs text-[var(--color-ink-faint)]">
                    <span>{s.elapsedWorkdays} werkdagen verstreken</span>
                    <span>nog {s.remainingWorkdays} werkdagen</span>
                  </div>
                </div>

                {/* Twee deadlines */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2">
                    <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Editor levert</div>
                    <div className="font-medium text-[var(--color-ink)]">{formatDate(s.editorDeadline)}</div>
                    <div style={{ color: s.workdaysToEditorDeadline < 0 ? "var(--color-bad)" : s.workdaysToEditorDeadline <= 2 ? "var(--color-warn)" : "var(--color-ink-muted)" }}>{wdText(s.workdaysToEditorDeadline)}</div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface-sunken)] px-3 py-2">
                    <div className="text-2xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Klantoplevering</div>
                    <div className="font-medium text-[var(--color-ink)]">{formatDate(s.clientDeadline)}</div>
                    <div style={{ color: s.workdaysToClientDeadline < 0 ? "var(--color-bad)" : s.workdaysToClientDeadline <= 3 ? "var(--color-warn)" : "var(--color-ink-muted)" }}>{wdText(s.workdaysToClientDeadline)}</div>
                  </div>
                </div>

                {/* Shorts in deze opname */}
                <ul className="mt-3 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
                  {s.shorts.map((v) => (
                    <li key={v.id}>
                      <Link href={`/videos/${v.id}`} className="flex items-center gap-2 py-2 hover:underline">
                        <span className="min-w-0 flex-1 truncate text-sm">{v.title}</span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
                          {v.editorName ? <TeamAvatar name={v.editorName} avatarUrl={v.editorAvatar} size={18} /> : null}
                          <span className="hidden sm:inline">{v.editorName ?? "geen editor"}</span>
                        </span>
                        <Badge tone={v.phaseTone}>{v.phaseLabel}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
