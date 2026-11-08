import Link from "next/link";
import type { AttentionItem } from "@/lib/contracts";
import { HandleAttentionButton } from "./contract-forms";
import { ATTENTION_COLOR } from "./format";

/**
 * "Contracten die aandacht nodig hebben": alleen contracten waarvoor nu een
 * actie nodig is, urgentste bovenaan. Geen losse meldingen; afhandelen verbergt
 * het punt tot het volgende herinneringsmoment.
 */
export function ContractAttentionBlock({ items, toVerify, compact = false }: { items: AttentionItem[]; toVerify: number; compact?: boolean }) {
  if (!items.length && (!toVerify || compact)) return null;
  const shown = compact ? items.slice(0, 5) : items;
  return (
    <section className="sc-card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Contracten die aandacht nodig hebben</h2>
        <Link href="/contracten" className="text-xs text-[var(--color-ink-muted)] hover:underline">Contracten &amp; Verlengingen →</Link>
      </div>
      {shown.length ? (
        <ul className="divide-y divide-[var(--color-line)]">
          {shown.map((a) => (
            <li key={a.key} className={`flex items-start gap-3 ${compact ? "py-1.5" : "py-2.5"}`}>
              <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: ATTENTION_COLOR[a.tone] }} aria-hidden />
              <div className="min-w-0 flex-1 text-sm">
                <Link href={`/contracten?klant=${a.clientSlug}`} className="font-medium text-[var(--color-ink)] hover:underline">{a.title}</Link>
                <p className={`text-[var(--color-ink-muted)] ${compact ? "truncate" : ""}`} title={compact ? a.detail : undefined}>{a.detail}</p>
              </div>
              <HandleAttentionButton attentionKey={a.key} clientId={a.clientId} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-ink-muted)]">Geen contracten die nu een actie vragen.</p>
      )}
      {compact && items.length > shown.length ? (
        <Link href="/contracten" className="mt-1 block text-xs text-[var(--color-ink-muted)] hover:underline">+ {items.length - shown.length} meer</Link>
      ) : null}
      {toVerify > 0 ? (
        <p className="mt-2 border-t border-[var(--color-line)] pt-2 text-xs text-[var(--color-ink-faint)]">
          {toVerify} {toVerify === 1 ? "contract heeft" : "contracten hebben"} nog onvolledige of ongecontroleerde gegevens. Zolang die ontbreken kan het systeem niet op tijd waarschuwen.
        </p>
      ) : null}
    </section>
  );
}
