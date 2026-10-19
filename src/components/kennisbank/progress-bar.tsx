/** De herkenbare groene voortgangsbalk (zoals in Skool), met percentage. */
export function KbProgressBar({ done, total, className = "" }: { done: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      className={`relative h-[18px] w-full overflow-hidden rounded-full bg-[var(--color-surface-2)] ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${pct}% afgerond`}
    >
      <div className="h-full rounded-full bg-[#1f9d55] transition-[width]" style={{ width: `${pct}%` }} />
      <span className={`absolute inset-y-0 left-2.5 flex items-center text-[11px] font-bold ${pct >= 12 ? "text-white" : "text-[var(--color-ink-muted)]"}`}>
        {pct}%
      </span>
    </div>
  );
}
