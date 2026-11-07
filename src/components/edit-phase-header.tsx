import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Kop van een editingfase (Binnenkort beschikbaar, In edit, Interne review,
 * Feedback klant, Feedback klant verwerken, Afgerond). De hele balk krijgt de
 * fasekleur uit EDIT_PHASE_META, zodat iedereen (team én editors) in één
 * oogopslag ziet in welke fase een video zit. Eén component voor alle boards,
 * zodat de kleuren overal gelijk blijven.
 */
export function EditPhaseHeader({
  label,
  color,
  count,
  open,
  onToggle,
}: {
  label: string;
  color: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-2 border-b border-black/10 px-2.5 py-2 text-left text-white transition-[filter] hover:brightness-[0.96]"
      style={{ background: color, textShadow: "0 1px 1px rgb(0 0 0 / 0.18)" }}
    >
      {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
      <span className="text-sm font-bold tracking-tight">{label}</span>
      <span className="rounded-full bg-white/25 px-2 py-0.5 text-2xs font-bold tabular-nums">{count}</span>
    </button>
  );
}
