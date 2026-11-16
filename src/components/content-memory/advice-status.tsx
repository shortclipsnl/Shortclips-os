"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Check, ThumbsDown, ThumbsUp, Undo2, X } from "lucide-react";
import { setAdviceStatusAction } from "@/server/actions/content-memory";

type Status = "nog_toepassen" | "ingepland" | "uitgevoerd" | "resultaat" | "effectief" | "niet_effectief" | "vervallen";

const LABEL: Record<Status, string> = {
  nog_toepassen: "Nog toepassen",
  ingepland: "Ingepland",
  uitgevoerd: "Uitgevoerd",
  resultaat: "Resultaat beschikbaar",
  effectief: "Bewezen effectief",
  niet_effectief: "Niet effectief",
  vervallen: "Vervallen",
};
const TONE: Record<Status, string> = {
  nog_toepassen: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
  ingepland: "bg-[var(--color-indigo-ink)] text-white",
  uitgevoerd: "bg-[var(--color-warn-soft)] text-[#8a5a00]",
  resultaat: "bg-[var(--color-warn-soft)] text-[#8a5a00]",
  effectief: "bg-[var(--color-good-soft)] text-[#1d6b4c]",
  niet_effectief: "bg-[var(--color-bad-soft)] text-[#a3271c]",
  vervallen: "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]",
};

export function AdviceStatusPill({ status }: { status: Status }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[status]}`}>{LABEL[status]}</span>;
}

/** Voortgang van één advies: status plus de stappen die het team zelf kan zetten. */
export function AdviceStatusControl({ id, status, manualVerdict, dark = false }: { id: string; status: Status; manualVerdict: boolean; dark?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState<Status>(status);
  const [error, setError] = useState<string | null>(null);
  const set = (next: Status) =>
    start(async () => {
      setError(null);
      const r = await setAdviceStatusAction(id, next);
      if (r.ok) { setCurrent(next); router.refresh(); } else setError(r.message);
    });
  const btn = `inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium disabled:opacity-50 ${dark ? "border-white/25 text-white/85 hover:bg-white/10" : "border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AdviceStatusPill status={current} />
      {current === "nog_toepassen" ? <button type="button" disabled={pending} onClick={() => set("ingepland")} className={btn}><CalendarCheck className="size-3" />Inplannen</button> : null}
      {current === "ingepland" ? <button type="button" disabled={pending} onClick={() => set("uitgevoerd")} className={btn}><Check className="size-3" />Uitgevoerd</button> : null}
      {current === "ingepland" ? <button type="button" disabled={pending} onClick={() => set("nog_toepassen")} className={btn} title="Terug naar nog toepassen"><Undo2 className="size-3" /></button> : null}
      {manualVerdict && current === "uitgevoerd" ? (
        <>
          <button type="button" disabled={pending} onClick={() => set("effectief")} className={btn}><ThumbsUp className="size-3" />Werkte</button>
          <button type="button" disabled={pending} onClick={() => set("niet_effectief")} className={btn}><ThumbsDown className="size-3" />Werkte niet</button>
        </>
      ) : null}
      {current === "nog_toepassen" || current === "ingepland" ? <button type="button" disabled={pending} onClick={() => set("vervallen")} className={`${btn} opacity-70`} title="Niet relevant voor deze klant: verdwijnt uit het advies"><X className="size-3" />Niet relevant</button> : null}
      {error ? <span className="text-[11.5px] text-[var(--color-bad)]">{error}</span> : null}
    </div>
  );
}
