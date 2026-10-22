"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { awardByKey } from "@/server/awards/config";
import { AwardBadge } from "./award-badge";
import { fireConfetti, playAwardSound, prefersReducedMotion } from "./celebrate";

export type CelebrationProps = {
  awardKey: string;
  firstName: string;
  nextRemaining: number | null;
  awardSound: boolean;
  /** "firstOpen" = toon eerst "Award openen"; "replay" = meteen vieren (klik is al gedaan). */
  mode: "firstOpen" | "replay";
  onClose: () => void;
  /** Alleen bij firstOpen: markeer de awards als gevierd zodra geopend. */
  onOpened?: () => void;
};

export function Celebration({ awardKey, firstName, nextRemaining, awardSound, mode, onClose, onOpened }: CelebrationProps) {
  const tier = awardByKey(awardKey);
  const [opened, setOpened] = useState(mode === "replay");
  const cardRef = useRef<HTMLDivElement>(null);
  const openBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<Element | null>(null);

  const reveal = useCallback(() => {
    if (tier) void fireConfetti(tier.color);
    if (awardSound) playAwardSound();
  }, [tier, awardSound]);

  // Focus beheren + Escape + focus terug.
  useEffect(() => {
    restoreFocus.current = document.activeElement;
    const first = mode === "firstOpen" ? openBtnRef.current : closeBtnRef.current;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = cardRef.current?.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
        if (!nodes || nodes.length === 0) return;
        const list = Array.from(nodes);
        const firstEl = list[0]!;
        const lastEl = list[list.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (restoreFocus.current instanceof HTMLElement) restoreFocus.current.focus();
    };
  }, [mode, onClose]);

  // Bij replay meteen vieren; focus op sluiten.
  useEffect(() => {
    if (mode === "replay") reveal();
  }, [mode, reveal]);

  function handleOpen() {
    setOpened(true);
    reveal();
    onOpened?.();
    setTimeout(() => closeBtnRef.current?.focus(), 50);
  }

  if (!tier) return null;
  const reduced = typeof window !== "undefined" && prefersReducedMotion();

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={opened ? `Award behaald: ${tier.name}` : "Nieuwe award"}
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center shadow-[var(--shadow-card)]"
      >
        {!opened ? (
          <>
            <p className="text-2xs font-bold uppercase tracking-[0.15em] text-[var(--color-ink-muted)]">Nieuwe award</p>
            <div className="my-5 grid place-items-center">
              <svg viewBox="0 0 100 100" width={96} height={96} aria-hidden="true">
                <polygon points="50,1 99,25 99,75 50,99 1,75 1,25" fill="#363b45" stroke="#4b525e" strokeWidth="2" />
                <text x="50" y="52" textAnchor="middle" dominantBaseline="central" fontSize="44" fontWeight={700} fill="#8a92a0" style={{ fontFamily: "var(--font-poppins), sans-serif" }}>?</text>
              </svg>
            </div>
            <button ref={openBtnRef} type="button" onClick={handleOpen} className="min-h-[44px] w-full rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 text-sm font-semibold text-white">
              Award openen
            </button>
          </>
        ) : (
          <>
            <div className="my-2 grid place-items-center">
              <span className={reduced ? undefined : "award-reveal"}>
                <AwardBadge tier={tier} earned size={110} sparkle={tier.key === "legend"} />
              </span>
            </div>
            <h2 className="mt-3 text-lg font-bold text-[var(--color-ink)]">{tier.name}</h2>
            <p className="mx-auto mt-1 max-w-xs text-sm text-[var(--color-ink-muted)]">
              {tier.description}. Sterk werk, {firstName}.
            </p>
            {nextRemaining != null ? (
              <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">Nog {nextRemaining} shorts tot je volgende award.</p>
            ) : (
              <p className="mt-1 text-2xs text-[var(--color-ink-faint)]">Je hebt alle awards binnen.</p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Link href="/showcase" onClick={onClose} className="grid min-h-[44px] flex-1 place-items-center rounded-[var(--radius-md)] bg-[var(--color-indigo-ink)] px-4 text-sm font-semibold text-white">
                Bekijk je showcase
              </Link>
              <button ref={closeBtnRef} type="button" onClick={onClose} className="min-h-[44px] flex-1 rounded-[var(--radius-md)] border border-[var(--color-line-strong)] px-4 text-sm font-medium text-[var(--color-ink)]">
                Sluiten
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
