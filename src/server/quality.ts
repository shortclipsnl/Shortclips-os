import "server-only";
import { daysSince, daysUntil } from "@/lib/format";
import { getDashboard } from "@/server/dashboard";
import { listEditingProjects } from "@/server/editing";
import { isOwner, type Viewer } from "@/server/auth/context";

/**
 * Centrale kwaliteitsbewaking (Deel 8): bundelt bestaande, al klant-gescoopte
 * signalen tot één actiegerichte lijst. Geen nieuwe meetlogica — hergebruikt
 * `getDashboard(viewer)`. Elk item is concreet, heeft een ernst (kleur) en een
 * directe link, en is getagd met de rollen waarvoor het relevant is.
 */

export type QualitySeverity = "rood" | "oranje" | "blauw";
export type QualityItem = {
  id: string;
  severity: QualitySeverity;
  category: string;
  title: string;
  detail: string;
  href: string;
  /** Rollen waarvoor dit relevant is; eigenaar/admin zien alles. */
  roles: string[];
};

const CC = ["project_coordinator", "content_creator"];
const EDIT = ["project_coordinator", "editor"];
const SHOOT = ["project_coordinator", "videographer"];

export async function getQualityOverview(viewer: Viewer): Promise<{ items: QualityItem[]; counts: Record<QualitySeverity, number> }> {
  const [data, projects] = await Promise.all([getDashboard(viewer), listEditingProjects(viewer)]);
  const items: QualityItem[] = [];

  // Voorspellend: projecten die nog NIET te laat zijn maar risico lopen (Deel 3.2).
  for (const p of projects) {
    if (p.bucket === "aandacht" || p.risk.level !== "oranje") continue; // al-te-laat komt hieronder apart
    items.push({
      id: `risk-${p.id}`, severity: "oranje", category: "Risico op vertraging",
      title: `${p.clientName} — ${p.title === p.clientName ? "video" : p.title}`,
      detail: `${p.risk.factors.join(" · ")} → vooruit plannen`,
      href: `/videos/${p.id}`, roles: EDIT,
    });
  }

  // Video's over de deadline — directe actie (rood).
  for (const v of data.videos.late) {
    const d = Math.max(1, -daysUntil(v.dueOn));
    items.push({
      id: `late-${v.id}`, severity: "rood", category: "Video over deadline",
      title: `${v.clientName} — ${v.title === v.clientName ? "video" : v.title}`,
      detail: `${d} dag(en) te laat · ${v.editorName ?? "geen editor"} → afmaken`,
      href: `/videos/${v.id}`, roles: EDIT,
    });
  }

  // Te lang bij de klant zonder reactie (oranje).
  for (const v of data.videos.stalledAtClient.filter((x) => daysSince(x.statusChangedAt) > 3)) {
    items.push({
      id: `stall-${v.id}`, severity: "oranje", category: "Wacht op klant",
      title: `${v.clientName} — ${v.title === v.clientName ? "video" : v.title}`,
      detail: `${daysSince(v.statusChangedAt)} werkdagen geen feedback → herinneren`,
      href: `/videos/${v.id}`, roles: CC,
    });
  }

  // Klanten met risico.
  for (const c of data.clients.atRisk) {
    items.push({
      id: `risk-${c.id}`, severity: c.riskLevel === "high" ? "rood" : "oranje", category: "Klant vraagt aandacht",
      title: c.name, detail: `${c.riskReason ?? "Gemarkeerd als risico"} → contact opnemen`,
      href: `/clients/${c.slug}`, roles: CC,
    });
  }

  // Achter op de maandafspraak (quota).
  for (const q of data.clients.quotaGap) {
    items.push({
      id: `quota-${q.clientId}`, severity: "oranje", category: "Achter op afspraak",
      title: q.clientName, detail: `${q.published + q.inProgress} van ${q.quota} deze maand → opname/edit inplannen`,
      href: `/clients/${q.clientSlug}`, roles: CC,
    });
  }

  // Actieve klanten zonder geplande opname.
  for (const c of data.clients.withoutShoot) {
    items.push({
      id: `noshoot-${c.id}`, severity: "oranje", category: "Geen opname gepland",
      title: c.name, detail: `Geen opnamedag gepland${c.lastShoot ? ` · laatst ${c.lastShoot}` : ""} → opname plannen`,
      href: `/clients/${c.slug}`, roles: SHOOT,
    });
  }

  // Opnames die bijna plaatsvinden maar nog niet rond zijn.
  for (const s of data.shoots) {
    const open = Number(s.openBlockers) + Number(s.unapprovedScripts);
    if (open > 0 && daysUntil(s.scheduledOn) <= 2) {
      items.push({
        id: `shoot-${s.id}`, severity: daysUntil(s.scheduledOn) <= 0 ? "rood" : "oranje", category: "Opname niet rond",
        title: `${s.clientName} — opname`, detail: `${open} punt(en) open · ${s.videographerName ?? "geen videograaf"} → voorbereiden`,
        href: `/productions/${s.id}`, roles: SHOOT,
      });
    }
  }

  // Aflopende contracten (blauw — vooruitkijken).
  for (const c of data.contracts.slice(0, 6)) {
    const d = daysUntil(c.endsOn);
    items.push({
      id: `contract-${c.id}`, severity: d < 30 ? "oranje" : "blauw", category: "Contract loopt af",
      title: c.clientName, detail: `Over ${d} dagen · ${c.autoRenew ? "verlengt automatisch" : "verlengt niet"}`,
      href: `/clients/${c.clientSlug}?tab=contract`, roles: ["project_coordinator"],
    });
  }

  // Ernst-volgorde: rood, oranje, blauw.
  const order: Record<QualitySeverity, number> = { rood: 0, oranje: 1, blauw: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);

  // Per rol filteren — eigenaar/admin zien alles.
  const role = viewer.primaryRole;
  const seeAll = isOwner(viewer) || role === "admin";
  const visible = seeAll ? items : items.filter((i) => i.roles.includes(role));

  const counts: Record<QualitySeverity, number> = { rood: 0, oranje: 0, blauw: 0 };
  for (const i of visible) counts[i.severity]++;

  return { items: visible, counts };
}
