"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  createCalendarItem,
  deleteCalendarItem,
  updateCalendarItem,
} from "@/server/actions/calendar";
import { Avatar, Button, Card, ErrorNote, InfoNote } from "@/components/ui";

const PLATFORMS = [
  { value: "instagram", label: "IG", color: "#E1306C" },
  { value: "tiktok", label: "TikTok", color: "#111111" },
  { value: "youtube", label: "YT", color: "#FF0000" },
  { value: "facebook", label: "FB", color: "#1877F2" },
  { value: "linkedin", label: "LinkedIn", color: "#0A66C2" },
];

const STATUSES = [
  { value: "to_prepare", label: "Voorbereiden" },
  { value: "ready", label: "Klaar" },
  { value: "scheduled", label: "Ingepland" },
  { value: "published", label: "Gepubliceerd" },
];

// Zichtbaar in het klantportaal:
const CLIENT_VISIBLE = new Set(["ready", "scheduled", "published"]);

export type PlannerItem = {
  id: string;
  title: string;
  scheduledOn: string;
  status: string;
  platforms: string[];
  clientName: string;
  clientColor: string | null;
};

export type ClientOption = { id: string; name: string };

export function Planner({ items, clients }: { items: PlannerItem[]; clients: ClientOption[] }) {
  // Groeperen per klant.
  const groups = new Map<string, { color: string | null; items: PlannerItem[] }>();
  for (const it of items) {
    const g = groups.get(it.clientName) ?? { color: it.clientColor, items: [] };
    g.items.push(it);
    groups.set(it.clientName, g);
  }

  return (
    <div className="space-y-5">
      <QuickAdd clients={clients} />
      <InfoNote>
        Publicaties met status <strong>Klaar</strong>, <strong>Ingepland</strong> of <strong>Gepubliceerd</strong> zijn
        direct zichtbaar in het portaal van de betreffende klant. <strong>Voorbereiden</strong> blijft intern.
      </InfoNote>

      {groups.size === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-ink-muted)]">Nog geen geplande publicaties. Voeg er hierboven één toe.</p>
        </Card>
      ) : (
        [...groups.entries()].map(([name, g]) => (
          <div key={name}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Avatar name={name} color={g.color} size={22} />
              {name}
              <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--color-ink-muted)]">
                {g.items.length}
              </span>
            </h2>
            <Card padded={false}>
              <ul className="divide-y divide-[var(--color-line)]">
                {g.items.map((it) => (
                  <PlannerRow key={it.id} item={it} />
                ))}
              </ul>
            </Card>
          </div>
        ))
      )}
    </div>
  );
}

function QuickAdd({ clients }: { clients: ClientOption[] }) {
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["instagram", "tiktok"]);
  const [status, setStatus] = useState("scheduled");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function toggle(p: string) {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  function add() {
    if (!clientId || !title.trim() || !date) {
      setErr("Kies een klant, titel en datum.");
      return;
    }
    start(async () => {
      const res = await createCalendarItem({
        clientId,
        title,
        scheduledOn: date,
        platforms: platforms as ("instagram")[],
        status: status as "scheduled",
      });
      if (res.ok) {
        setTitle("");
        setDate("");
        setErr(null);
        router.refresh();
      } else {
        setErr(res.message ?? "Mislukt");
      }
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <select className="sc-input w-44" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Klant">
          <option value="">Klant…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input className="sc-input min-w-48 flex-1" placeholder="Titel van de publicatie…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <input className="sc-input w-36" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Publicatiedatum" />
        <select className="sc-input w-32" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <PlatformToggles selected={platforms} onToggle={toggle} />
        <Button onClick={add} disabled={pending} size="sm">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Toevoegen
        </Button>
      </div>
      {err ? <div className="mt-2"><ErrorNote>{err}</ErrorNote></div> : null}
    </Card>
  );
}

function PlannerRow({ item }: { item: PlannerItem }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [title, setTitle] = useState(item.title);
  const visible = CLIENT_VISIBLE.has(item.status);

  function run(fn: () => Promise<unknown>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  function togglePlatform(p: string) {
    const next = item.platforms.includes(p) ? item.platforms.filter((x) => x !== p) : [...item.platforms, p];
    run(() => updateCalendarItem(item.id, { platforms: next as ("instagram")[] }));
  }

  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-2.5">
      <input
        className="sc-input h-8 min-w-40 flex-1 py-0 text-sm"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== item.title && run(() => updateCalendarItem(item.id, { title }))}
        aria-label="Titel"
      />
      <input
        className="sc-input h-8 w-32 py-0 text-xs"
        type="date"
        value={item.scheduledOn}
        onChange={(e) => e.target.value && run(() => updateCalendarItem(item.id, { scheduledOn: e.target.value }))}
        aria-label="Datum"
      />
      <select
        className="sc-input h-8 w-32 py-0 text-xs"
        value={item.status}
        onChange={(e) => run(() => updateCalendarItem(item.id, { status: e.target.value as "scheduled" }))}
        aria-label="Status"
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      <PlatformToggles selected={item.platforms} onToggle={togglePlatform} />
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium"
        style={{
          background: visible ? "var(--color-good-soft)" : "var(--color-surface-2)",
          color: visible ? "var(--color-good)" : "var(--color-ink-faint)",
        }}
        title={visible ? "Zichtbaar voor de klant" : "Alleen intern"}
      >
        {visible ? "klant ziet dit" : "intern"}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => deleteCalendarItem(item.id))}
        className="shrink-0 rounded p-1.5 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-bad)]"
        aria-label="Publicatie verwijderen"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </button>
    </li>
  );
}

function PlatformToggles({ selected, onToggle }: { selected: string[]; onToggle: (p: string) => void }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {PLATFORMS.map((p) => {
        const on = selected.includes(p.value);
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onToggle(p.value)}
            className="rounded px-1.5 py-1 text-2xs font-semibold"
            style={{
              background: on ? p.color : "var(--color-surface-2)",
              color: on ? "#fff" : "var(--color-ink-faint)",
            }}
            aria-pressed={on}
            title={p.label}
          >
            {p.label}
          </button>
        );
      })}
    </span>
  );
}
