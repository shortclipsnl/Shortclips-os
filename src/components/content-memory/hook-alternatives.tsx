"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { hookAlternativesAction } from "@/server/actions/content-memory";
import type { HookAlternatives } from "@/server/content-memory/hook-alternatives";
import { CopyButton } from "./player";

type Ctx = {
  items: Record<string, HookAlternatives>;
  pending: Set<string>;
  error: string | null;
  regenerate: (key: string) => void;
};
const AltCtx = createContext<Ctx>({ items: {}, pending: new Set(), error: null, regenerate: () => {} });

/**
 * Houdt de alternatieven van alle getoonde hooks bij. Ontbreken er nog
 * (bijv. een nieuwe succesvolle hook sinds de nachtelijke run), dan worden ze
 * één keer automatisch aangevuld.
 */
export function HookAltsProvider({ clientId, initial, keys, children }: { clientId: string; initial: Record<string, HookAlternatives>; keys: string[]; children: ReactNode }) {
  const [items, setItems] = useState(initial);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);

  const run = useCallback(async (which: string[], force?: string) => {
    setPending((p) => new Set([...p, ...which]));
    setError(null);
    const res = await hookAlternativesAction(clientId, force);
    if (res.ok) setItems(res.items);
    else setError(res.message);
    setPending((p) => { const n = new Set(p); which.forEach((k) => n.delete(k)); return n; });
  }, [clientId]);

  useEffect(() => {
    if (asked.current) return;
    const missing = keys.filter((k) => !initial[k]);
    if (!missing.length) return;
    const t = window.setTimeout(() => {
      asked.current = true;
      void run(missing);
    }, 0);
    return () => window.clearTimeout(t);
  }, [keys, initial, run]);

  const regenerate = useCallback((key: string) => { void run([key], key); }, [run]);
  return <AltCtx.Provider value={{ items, pending, error, regenerate }}>{children}</AltCtx.Provider>;
}

/** Het "werkzame principe" uit de AI, of de regelgebaseerde uitleg als die er (nog) niet is. */
export function HookPrinciple({ hookKey, fallback }: { hookKey: string; fallback: string }) {
  const { items } = useContext(AltCtx);
  return <>{items[hookKey]?.principle || fallback}</>;
}

export function HookAltsPanel({ hookKey }: { hookKey: string }) {
  const { items, pending, error, regenerate } = useContext(AltCtx);
  const data = items[hookKey];
  const busy = pending.has(hookKey);
  return (
    <div className="flex h-full flex-col gap-3 rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-sunken)] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold"><Sparkles className="size-3.5 text-[var(--color-violet)]" />Alternatieven op basis van deze succesvolle hook</h4>
        {data && !busy ? (
          <button type="button" onClick={() => regenerate(hookKey)} className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]" title="Drie nieuwe alternatieven laten maken">
            <RefreshCw className="size-3" /> Nieuwe
          </button>
        ) : null}
      </div>
      {busy ? (
        <ul className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => <li key={i} className="h-[58px] animate-pulse rounded-[10px] bg-[var(--color-surface-2)]" />)}
          <li className="text-[11.5px] text-[var(--color-ink-muted)]">Alternatieven worden gemaakt op basis van deze hook en de klant...</li>
        </ul>
      ) : data ? (
        <ul className="flex flex-col gap-2">
          {data.alternatives.map((a, i) => (
            <li key={i} className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-violet)]">{a.angle || `Alternatief ${i + 1}`}</div>
                <p className="mt-0.5 text-[14px] font-medium leading-snug">{a.hook}</p>
              </div>
              <CopyButton text={a.hook} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-2 text-[12.5px] text-[var(--color-ink-muted)]">
          <span>{error ?? "Nog geen alternatieven."}</span>
          <button type="button" onClick={() => regenerate(hookKey)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)]"><RefreshCw className="size-3" />Maak alternatieven</button>
        </div>
      )}
    </div>
  );
}
