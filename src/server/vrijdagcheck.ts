import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { replacementEmail } from "./leave-cover";

export type VrijCheck = {
  key: "scripts" | "opnames" | "publicaties" | "afwezigheid" | "deadlines";
  label: string;
  ok: boolean;
  summary: string;
  items: string[];
  href: string;
};

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[])) as T[];
}
const dmy = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("nl-NL", { day: "numeric", month: "short" });

/**
 * Vrijdagcheck: staat volgende week rond? Vijf harde checks voor de Content
 * Creative, zodat maandag zonder verrassingen begint. Alles leest live uit de
 * bestaande bronnen (opnameplanning, scripting, contentplanning, verlof, editing).
 */
export async function getVrijdagcheck(): Promise<{ weekLabel: string; checks: VrijCheck[]; okCount: number }> {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // ma=0 … zo=6
  const mon = new Date(now);
  mon.setDate(now.getDate() - dow + 7); // maandag volgende week
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monI = iso(mon);
  const sunI = iso(sun);
  const weekLabel = `${dmy(monI)} – ${dmy(sunI)}`;

  // 1. Scripts klaar — opnames volgende week waarvan het script nog niet 'final' is.
  const scriptsOpen = rows<{ name: string; scheduled_on: string }>(
    await db.execute(sql`
      select c.name, pd.scheduled_on from production_days pd
      join clients c on c.id = pd.client_id
      where pd.deleted_at is null and pd.status <> 'cancelled'
        and pd.scheduled_on between ${monI} and ${sunI}
        and pd.scripting_status <> 'final'
      order by pd.scheduled_on`),
  );

  // 2. Opnames voorbereid — opnames volgende week zonder videograaf of met open blokkerende checklistpunten.
  const opnOpen = rows<{ name: string; scheduled_on: string; reden: string }>(
    await db.execute(sql`
      select c.name, pd.scheduled_on,
        case when pd.videographer_id is null then 'geen videograaf'
             else 'checklist niet compleet' end as reden
      from production_days pd
      join clients c on c.id = pd.client_id
      where pd.deleted_at is null and pd.status <> 'cancelled'
        and pd.scheduled_on between ${monI} and ${sunI}
        and (pd.videographer_id is null
          or exists (select 1 from production_checklist_items ci
                     where ci.production_day_id = pd.id and ci.is_blocking = true and ci.is_done = false))
      order by pd.scheduled_on`),
  );

  // 3. Publicaties gevuld — actieve klanten zonder geplande publicatie volgende week.
  const pubGap = rows<{ name: string }>(
    await db.execute(sql`
      select c.name from clients c
      where c.deleted_at is null and c.status = 'active'
        and not exists (select 1 from content_calendar cc
          where cc.client_id = c.id and cc.deleted_at is null and cc.status <> 'failed'
            and cc.scheduled_on between ${monI} and ${sunI})
      order by c.name`),
  );

  // 4. Niemand afwezig zonder vervanging — goedgekeurd verlof dat volgende week valt.
  const leaves = rows<{ user_id: string; name: string; email: string; start_on: string; end_on: string }>(
    await db.execute(sql`
      select l.user_id, u.full_name as name, u.email, l.start_on, l.end_on
      from leave_requests l join users u on u.id = l.user_id
      where l.status = 'approved' and l.start_on <= ${sunI} and l.end_on >= ${monI}`),
  );
  const leaveEmails = new Set(leaves.map((l) => l.email.toLowerCase()));
  const zonderVervanging = leaves.filter((l) => {
    const re = replacementEmail(l.email);
    // Geen koppel, of de vervanger is in dezelfde week óók afwezig.
    return !re || leaveEmails.has(re);
  });

  // 5. Geen video's over de deadline — editwerk dat nu al te laat is, loopt volgende week door.
  const overdue = rows<{ title: string; name: string }>(
    await db.execute(sql`
      select d.title, c.name from deliverables d
      join clients c on c.id = d.client_id
      where d.deleted_at is null and d.due_on < current_date
        and d.status in ('editing','editor_revision','awaiting_editor','internal_review','client_revision')
      order by d.due_on`),
  );

  const checks: VrijCheck[] = [
    {
      key: "scripts",
      label: "Scripts klaar",
      ok: scriptsOpen.length === 0,
      summary: scriptsOpen.length === 0 ? "Alle scripts voor volgende week zijn final." : `${scriptsOpen.length} opname(s) zonder final script.`,
      items: scriptsOpen.map((r) => `${r.name} — ${dmy(r.scheduled_on)}`),
      href: "/scripting",
    },
    {
      key: "opnames",
      label: "Opnames voorbereid",
      ok: opnOpen.length === 0,
      summary: opnOpen.length === 0 ? "Alle opnames hebben een videograaf en complete checklist." : `${opnOpen.length} opname(s) nog niet rond.`,
      items: opnOpen.map((r) => `${r.name} — ${dmy(r.scheduled_on)} (${r.reden})`),
      href: "/productions",
    },
    {
      key: "publicaties",
      label: "Publicaties gevuld",
      ok: pubGap.length === 0,
      summary: pubGap.length === 0 ? "Elke actieve klant heeft publicaties gepland." : `${pubGap.length} klant(en) zonder publicatie volgende week.`,
      items: pubGap.map((r) => r.name),
      href: "/calendar",
    },
    {
      key: "afwezigheid",
      label: "Vervanging geregeld",
      ok: zonderVervanging.length === 0,
      summary:
        zonderVervanging.length === 0
          ? leaves.length === 0
            ? "Iedereen is volgende week beschikbaar."
            : "Alle afwezigen hebben een beschikbare vervanger."
          : `${zonderVervanging.length} afwezige(n) zonder beschikbare vervanger.`,
      items: zonderVervanging.map((l) => `${l.name} (${dmy(l.start_on)}–${dmy(l.end_on)}) — geen vervanger`),
      href: "/verlof",
    },
    {
      key: "deadlines",
      label: "Geen video's over de deadline",
      ok: overdue.length === 0,
      summary: overdue.length === 0 ? "Geen editwerk over de deadline." : `${overdue.length} video('s) staan over de deadline.`,
      items: overdue.map((r) => `${r.name} — ${r.title}`),
      href: "/videos?filter=te-laat",
    },
  ];

  return { weekLabel, checks, okCount: checks.filter((c) => c.ok).length };
}
