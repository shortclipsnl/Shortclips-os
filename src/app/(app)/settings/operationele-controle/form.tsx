"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { updateOpsSettings } from "@/server/actions/ops-control";
import type { OpsControlSettings } from "@/server/ops-control/settings";

const input = "h-9 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 text-sm text-[var(--color-ink)] focus:border-[var(--color-brand-500)] focus:outline-none";

function Row({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--color-ink)]">{label}</p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{help}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

export function OpsSettingsForm({ initial, staff, resolved }: {
  initial: OpsControlSettings;
  staff: { id: string; name: string }[];
  resolved: { leadId: string | null; backupId: string | null };
}) {
  const [v, setV] = useState<OpsControlSettings>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = (id: string | null) => staff.find((s) => s.id === id)?.name ?? "niemand gevonden";
  const set = <K extends keyof OpsControlSettings>(k: K, val: OpsControlSettings[K]) => { setSaved(false); setV((x) => ({ ...x, [k]: val })); };

  const save = () => start(async () => {
    setErr(null);
    const r = await updateOpsSettings(v);
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); } else setErr(r.message);
  });

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[var(--color-line)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)]">
        <Row label="Controle actief" help="Uit = geen automatische controles en geen meldingen. Handmatig controleren blijft mogelijk.">
          <input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} className="size-4" />
        </Row>
        <Row label="Ochtendcontrole" help="Werkdagen, Europe/Amsterdam. Iedereen krijgt een persoonlijk overzicht van zijn punten.">
          <input type="time" value={v.morning} onChange={(e) => set("morning", e.target.value)} className={input} />
        </Row>
        <Row label="Middagcontrole" help="Alleen de punten die vandaag nog openstaan. Liefst ruim voor het eind van de dag.">
          <input type="time" value={v.afternoon} onChange={(e) => set("afternoon", e.target.value)} className={input} />
        </Row>
        <Row label="Deadlinetijd in taken" help="Wat er in een taak voor vandaag als tijd staat (bijv. 'Vandaag om 16:00 uur').">
          <input type="time" value={v.dueTime} onChange={(e) => set("dueTime", e.target.value)} className={input} />
        </Row>
        <Row label="Operationeel verantwoordelijke" help={`Krijgt belangrijke punten die niet op tijd zijn opgelost. Nu: ${name(resolved.leadId)}.`}>
          <select value={v.leadUserId} onChange={(e) => set("leadUserId", e.target.value)} className={input}>
            <option value="">Automatisch</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Row>
        <Row label="Vervanger" help={`Krijgt de escalatie als het punt bij de operationeel verantwoordelijke zelf ligt. Nu: ${name(resolved.backupId)}.`}>
          <select value={v.backupUserId} onChange={(e) => set("backupUserId", e.target.value)} className={input}>
            <option value="">Automatisch</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Row>
        <Row label="Naar Jarno na" help="Werkdagen dat een geëscaleerd klantpunt (editing, feedback, klantcommunicatie) openstaat voordat Jarno het ziet. Klanten met hoog risico gaan direct naar Jarno.">
          <span className="flex items-center gap-2">
            <input type="number" min={1} max={20} value={v.jarnoAfterWorkdays} onChange={(e) => set("jarnoAfterWorkdays", Number(e.target.value) || 1)} className={`${input} w-20 text-right`} />
            <span className="text-xs text-[var(--color-ink-faint)]">werkdagen</span>
          </span>
        </Row>
      </ul>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-brand-600)] px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40">
          {pending ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
          {saved ? "Opgeslagen" : "Instellingen opslaan"}
        </button>
        {err ? <span className="text-xs text-[var(--color-bad)]">{err}</span> : null}
      </div>
    </div>
  );
}
