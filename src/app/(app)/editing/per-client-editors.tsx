"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Card, CardHeader, ClientLogo, Table } from "@/components/ui";
import { euro, formatDate, num } from "@/lib/format";
import { BOARD_EDITORS, editorColor, editorDisplayName, firstNameKey } from "@/lib/editors";
import { setClientEditor } from "@/server/actions/clients";
import { ClientEconField } from "./editing-ui";

export type PerClientRow = {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  logo_url: string | null;
  quota: number;
  client_rate: number;
  assigned_editor: string | null;
  in_production: number;
  awaiting_feedback: number;
  done_month: number;
  late: number;
  next_due: string | null;
};

const NONE = "__none__";

export function PerClientEditors({
  clients,
  canManage,
  canSeeCosts,
}: {
  clients: PerClientRow[];
  canManage: boolean;
  canSeeCosts: boolean;
}) {
  const [filter, setFilter] = useState<string>("alle");

  // Aantal klanten per editor (voor de knop-telling) + "niet toegewezen".
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let none = 0;
    for (const c of clients) {
      const key = firstNameKey(c.assigned_editor);
      if (!key) none++;
      else map.set(key, (map.get(key) ?? 0) + 1);
    }
    return { map, none };
  }, [clients]);

  const shown = useMemo(() => {
    if (filter === "alle") return clients;
    if (filter === NONE) return clients.filter((c) => !firstNameKey(c.assigned_editor));
    return clients.filter((c) => firstNameKey(c.assigned_editor) === filter);
  }, [clients, filter]);

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
      active ? "text-white" : "border border-[var(--color-line-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
    }`;

  return (
    <Card padded={false} className="mb-6">
      <CardHeader
        title="Per klant"
        subtitle="Welke editor doet welke klant. Klik op een editor om te filteren; wijzig de editor per klant in de kolom. Shorts en prijs per short zijn hier ook aan te passen."
        className="p-5 pb-2"
      />

      {/* Editor-filterknoppen. */}
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
        <button type="button" onClick={() => setFilter("alle")} className={chip(filter === "alle")} style={filter === "alle" ? { background: "var(--color-indigo-ink)" } : undefined}>
          Alle klanten
          <span className="rounded-full bg-black/10 px-1.5 text-2xs tabular-nums">{clients.length}</span>
        </button>
        {BOARD_EDITORS.map((e) => {
          const key = e.toLowerCase();
          const active = filter === key;
          const n = counts.map.get(key) ?? 0;
          return (
            <button key={e} type="button" onClick={() => setFilter(key)} className={chip(active)} style={active ? { background: editorColor(e) } : undefined}>
              <span className="size-2 rounded-full" style={{ background: active ? "rgba(255,255,255,.8)" : editorColor(e) }} />
              {e}
              <span className="rounded-full bg-black/10 px-1.5 text-2xs tabular-nums" style={active ? undefined : { color: "var(--color-ink-faint)" }}>{n}</span>
            </button>
          );
        })}
        {counts.none > 0 ? (
          <button type="button" onClick={() => setFilter(NONE)} className={chip(filter === NONE)} style={filter === NONE ? { background: "var(--color-ink-muted)" } : undefined}>
            Niet toegewezen
            <span className="rounded-full bg-black/10 px-1.5 text-2xs tabular-nums">{counts.none}</span>
          </button>
        ) : null}
      </div>

      <Table head={<><th className="sc-th">Klant</th><th className="sc-th">Editor</th><th className="sc-th text-right">Shorts/mnd</th><th className="sc-th text-right">In productie</th><th className="sc-th text-right">Afgerond (mnd)</th><th className="sc-th text-right">Wacht op feedback</th><th className="sc-th text-right">Te laat</th><th className="sc-th">Deadline</th>{canSeeCosts ? <><th className="sc-th text-right">Prijs/short</th><th className="sc-th text-right">Editkosten/mnd</th></> : null}</>}>
        {shown.map((c) => (
          <tr key={c.id} className="sc-row-link">
            <td className="sc-td"><Link href={`/clients/${c.slug}?tab=videos`} className="flex items-center gap-2.5 font-medium hover:underline"><ClientLogo name={c.name} logoUrl={c.logo_url} color={c.color} size={28} />{c.name}</Link></td>
            <td className="sc-td">{canManage ? <EditorSelect clientId={c.id} value={c.assigned_editor} /> : <EditorBadge value={c.assigned_editor} />}</td>
            <td className="sc-td text-right tabular-nums">{canManage ? <ClientEconField clientId={c.id} field="quota" value={Number(c.quota)} /> : num(Number(c.quota))}</td>
            <td className="sc-td text-right tabular-nums">{num(Number(c.in_production))}</td>
            <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{num(Number(c.done_month))}</td>
            <td className="sc-td text-right tabular-nums text-[var(--color-ink-muted)]">{num(Number(c.awaiting_feedback))}</td>
            <td className={`sc-td text-right tabular-nums ${Number(c.late) > 0 ? "font-semibold text-[var(--color-bad)]" : "text-[var(--color-ink-muted)]"}`}>{num(Number(c.late))}</td>
            <td className="sc-td text-[var(--color-ink-muted)]">{c.next_due ? formatDate(c.next_due) : "—"}</td>
            {canSeeCosts ? (
              <>
                <td className="sc-td text-right tabular-nums">{canManage ? <ClientEconField clientId={c.id} field="costPerVideo" value={Number(c.client_rate)} prefix="€" /> : (Number(c.client_rate) > 0 ? euro(Number(c.client_rate)) : "—")}</td>
                <td className="sc-td text-right tabular-nums font-semibold">{Number(c.client_rate) > 0 ? euro(Number(c.client_rate) * Number(c.quota)) : "—"}</td>
              </>
            ) : null}
          </tr>
        ))}
        {shown.length === 0 ? (
          <tr><td colSpan={canSeeCosts ? 10 : 8} className="px-5 py-6 text-center text-sm text-[var(--color-ink-faint)]">Geen klanten voor deze editor.</td></tr>
        ) : null}
      </Table>
    </Card>
  );
}

/** Leesweergave van de toegewezen editor (met kleurstip). */
function EditorBadge({ value }: { value: string | null }) {
  if (!value?.trim()) return <span className="text-sm text-[var(--color-ink-faint)]">niet toegewezen</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <span className="size-2.5 rounded-full" style={{ background: editorColor(value) }} />
      {editorDisplayName(value)}
    </span>
  );
}

/** Bewerkbare editor-keuze per klant. Houdt een afwijkende bestaande waarde
 *  (bijv. een volledige naam uit Monday) als extra optie, zodat die niet
 *  verloren gaat. */
function EditorSelect({ clientId, value }: { clientId: string; value: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const current = value?.trim() ?? "";
  const key = firstNameKey(current);
  const matches = BOARD_EDITORS.some((e) => e.toLowerCase() === key);
  const selected = current === "" ? NONE : matches ? BOARD_EDITORS.find((e) => e.toLowerCase() === key)! : current;

  function onChange(next: string) {
    const name = next === NONE ? null : next;
    if ((name ?? "") === current) return;
    start(async () => {
      const res = await setClientEditor(clientId, name);
      if (res.ok) router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: current ? editorColor(current) : "var(--color-line-strong)" }} />
      <select
        value={selected}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1.5 py-1 text-sm font-medium"
        aria-label={`Editor voor klant`}
      >
        <option value={NONE}>— geen —</option>
        {BOARD_EDITORS.map((e) => <option key={e} value={e}>{e}</option>)}
        {!matches && current !== "" ? <option value={current}>{current}</option> : null}
      </select>
      {pending ? <Loader2 className="size-3.5 animate-spin text-[var(--color-ink-faint)]" /> : null}
    </span>
  );
}
