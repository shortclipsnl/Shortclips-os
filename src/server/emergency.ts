import "server-only";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { clients, deliverables, productionDays, users } from "@/db/schema";

/**
 * Noodprocedure: een beperkte, printbare momentopname van de kritieke
 * operationele informatie (komende opnames, lopende deadlines, verantwoordelijken
 * en bestanden/links), zodat het werk doorgaat als het portaal tijdelijk uitvalt.
 * Bewust NIET viewer-gescoped: dit is het complete noodoverzicht voor het team.
 */

const ROLE_LABEL: Record<string, string> = {
  owner: "Eigenaar", admin: "Beheer", project_coordinator: "Coördinator",
  content_creator: "Content", videographer: "Videograaf", editor: "Editor", finance: "Finance",
};
const STATUS_LABEL: Record<string, string> = {
  recorded: "Opgenomen", editing: "In bewerking", editor_revision: "Editor past aan",
  awaiting_editor: "Wacht op editor", internal_review: "Interne controle",
  client_review: "Bij klant", client_revision: "Klant wil wijziging",
  ready_to_publish: "Klaar om te plaatsen", scheduled: "Ingepland", approved: "Goedgekeurd",
  analysis_available: "Analyse klaar",
};

const driveUrl = (id: string | null) => (id ? `https://drive.google.com/drive/folders/${id}` : null);

export type EmergencyLink = { label: string; url: string };
export type EmergencyDeliverable = {
  title: string; status: string; statusLabel: string; dueOn: string | null; editor: string | null; links: EmergencyLink[];
};
export type EmergencyClient = {
  name: string; slug: string; coordinator: string | null; videographer: string | null;
  nextShoot: { date: string; time: string | null; location: string | null } | null;
  deliverables: EmergencyDeliverable[];
};
export type EmergencyShoot = {
  date: string; time: string | null; title: string; client: string | null; location: string | null;
  address: string | null; videographer: string | null; coordinator: string | null; driveUrl: string | null;
};
export type EmergencyTeam = { fullName: string; role: string; roleLabel: string; phone: string | null; email: string };
export type EmergencySnapshot = {
  generatedAt: Date;
  team: EmergencyTeam[];
  clients: EmergencyClient[];
  shoots: EmergencyShoot[];
};

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getEmergencySnapshot(): Promise<EmergencySnapshot> {
  const today = dayOffset(0);
  const horizon = dayOffset(21);
  const coord = alias(users, "em_coord");
  const vid = alias(users, "em_vid");
  const editor = alias(users, "em_editor");

  const [teamRows, clientRows, delRows, shootRows] = await Promise.all([
    db
      .select({ fullName: users.fullName, role: users.primaryRole, phone: users.phone, email: users.email })
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.status, "active"), sql`${users.primaryRole} <> 'client'`))
      .orderBy(asc(users.primaryRole), asc(users.fullName)),
    db
      .select({ id: clients.id, name: clients.name, slug: clients.slug, coordinator: coord.fullName, videographer: vid.fullName })
      .from(clients)
      .leftJoin(coord, eq(coord.id, clients.coordinatorId))
      .leftJoin(vid, eq(vid.id, clients.videographerId))
      .where(and(isNull(clients.deletedAt), eq(clients.status, "active")))
      .orderBy(asc(clients.name)),
    db
      .select({
        clientId: deliverables.clientId, title: deliverables.title, status: deliverables.status, dueOn: deliverables.dueOn,
        editor: editor.fullName, frameUrl: deliverables.frameUrl, driveFolderId: deliverables.driveFolderId,
        footageUrl: deliverables.footageUrl, scriptUrl: deliverables.scriptUrl,
      })
      .from(deliverables)
      .leftJoin(editor, eq(editor.id, deliverables.editorId))
      // Alleen nog lopend werk: geen opgeleverde/geplande/live video's.
      .where(and(isNull(deliverables.deletedAt), sql`${deliverables.status} not in ('published','analysis_available','scheduled','approved','ready_to_publish')`))
      .orderBy(asc(deliverables.dueOn)),
    db
      .select({
        date: productionDays.scheduledOn, time: productionDays.startTime, title: productionDays.title,
        client: clients.name, location: productionDays.locationName, address: productionDays.locationAddress,
        videographer: vid.fullName, coordinator: coord.fullName, driveFolderId: productionDays.driveFolderId,
      })
      .from(productionDays)
      .leftJoin(clients, eq(clients.id, productionDays.clientId))
      .leftJoin(vid, eq(vid.id, productionDays.videographerId))
      .leftJoin(coord, eq(coord.id, productionDays.coordinatorId))
      .where(and(isNull(productionDays.deletedAt), gte(productionDays.scheduledOn, today), lte(productionDays.scheduledOn, horizon)))
      .orderBy(asc(productionDays.scheduledOn)),
  ]);

  // Deliverables per klant groeperen + links samenstellen.
  const delsByClient = new Map<string, EmergencyDeliverable[]>();
  for (const d of delRows) {
    const links: EmergencyLink[] = [];
    if (d.frameUrl) links.push({ label: "Frame.io", url: d.frameUrl });
    const drv = driveUrl(d.driveFolderId);
    if (drv) links.push({ label: "Drive", url: drv });
    if (d.footageUrl) links.push({ label: "Beeldmateriaal", url: d.footageUrl });
    if (d.scriptUrl) links.push({ label: "Script", url: d.scriptUrl });
    const list = delsByClient.get(d.clientId) ?? [];
    list.push({
      title: d.title, status: d.status, statusLabel: STATUS_LABEL[d.status] ?? d.status,
      dueOn: d.dueOn, editor: d.editor, links,
    });
    delsByClient.set(d.clientId, list);
  }

  // Eerstvolgende opname per klant (uit de komende opnames).
  const nextShootByClient = new Map<string, { date: string; time: string | null; location: string | null }>();
  for (const s of shootRows) {
    if (s.client && !nextShootByClient.has(s.client)) {
      nextShootByClient.set(s.client, { date: s.date, time: s.time, location: s.location });
    }
  }

  const clientsOut: EmergencyClient[] = clientRows.map((c) => ({
    name: c.name, slug: c.slug, coordinator: c.coordinator, videographer: c.videographer,
    nextShoot: nextShootByClient.get(c.name) ?? null,
    deliverables: delsByClient.get(c.id) ?? [],
  }));

  return {
    generatedAt: new Date(),
    team: teamRows.map((t) => ({
      fullName: t.fullName, role: t.role, roleLabel: ROLE_LABEL[t.role] ?? t.role, phone: t.phone, email: t.email,
    })),
    clients: clientsOut,
    shoots: shootRows.map((s) => ({
      date: s.date, time: s.time, title: s.title, client: s.client, location: s.location,
      address: s.address, videographer: s.videographer, coordinator: s.coordinator, driveUrl: driveUrl(s.driveFolderId),
    })),
  };
}

/* ------------------------------------------------------- printbare HTML ---- */

const NAVY = "#00003b";
const BLUE = "#2E90FA";
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmtDate = (d: string) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "long" }); }
  catch { return d; }
};

/**
 * Zelfstandige A4-HTML van de noodprocedure. Geen externe afhankelijkheden, geen
 * auth-fetch nodig — zo kan ook de nachtelijke job (zonder sessie) de PDF maken
 * en buiten de app (Google Drive) beschikbaar stellen.
 */
export function renderEmergencyHtml(snap: EmergencySnapshot): string {
  const gen = snap.generatedAt.toLocaleString("nl-NL", { dateStyle: "full", timeStyle: "short" });

  const instructies = `
    <div class="box">
      <h2>Wat te doen als het portaal (ShortClips OS) uitvalt</h2>
      <ol>
        <li><b>Blijf werken met dit document.</b> Hieronder staan de komende opnames, lopende deadlines, de verantwoordelijke per klant en de directe links naar bestanden (Drive, Frame.io, beeldmateriaal, scripts).</li>
        <li><b>Bestanden.</b> Ruwe beelden, scripts en opleveringen staan in Google Drive en Frame.io — bereikbaar via de links hieronder, los van het portaal.</li>
        <li><b>Onderling afstemmen.</b> Gebruik de telefoonnummers/e-mailadressen uit de teamlijst. De coördinator per klant bewaakt de voortgang.</li>
        <li><b>Gegevensherstel.</b> Er draait elke nacht een automatische database-back-up naar Google Drive (map "ShortClips OS – Database backups") plus een losse versleutelde back-up via GitHub Actions. Neem bij dataverlies contact op met de eigenaar.</li>
        <li><b>Deze noodexport</b> wordt elke nacht automatisch ververst en als PDF in Google Drive gezet, zodat je altijd een recente versie hebt — ook als de app niet bereikbaar is.</li>
      </ol>
    </div>`;

  const shootsRows = snap.shoots.length === 0
    ? `<tr><td colspan="5" class="muted">Geen opnames gepland in de komende 3 weken.</td></tr>`
    : snap.shoots.map((s) => `
      <tr>
        <td><b>${esc(fmtDate(s.date))}</b>${s.time ? `<br><span class="muted">${esc(String(s.time).slice(0, 5))}</span>` : ""}</td>
        <td>${esc(s.client ?? "—")}<br><span class="muted">${esc(s.title)}</span></td>
        <td>${esc(s.location ?? "—")}${s.address ? `<br><span class="muted">${esc(s.address)}</span>` : ""}</td>
        <td>${esc(s.videographer ?? "—")}<br><span class="muted">co: ${esc(s.coordinator ?? "—")}</span></td>
        <td>${s.driveUrl ? `<a href="${esc(s.driveUrl)}">Drive-map</a>` : "<span class='muted'>—</span>"}</td>
      </tr>`).join("");

  const clientBlocks = snap.clients.map((c) => {
    const dels = c.deliverables.length === 0
      ? `<p class="muted small">Geen lopende opleveringen.</p>`
      : `<table class="sub"><thead><tr><th>Video</th><th>Status</th><th>Deadline</th><th>Editor</th><th>Bestanden</th></tr></thead><tbody>${
          c.deliverables.map((d) => `
            <tr>
              <td>${esc(d.title)}</td>
              <td>${esc(d.statusLabel)}</td>
              <td>${d.dueOn ? esc(fmtDate(d.dueOn)) : "<span class='muted'>—</span>"}</td>
              <td>${esc(d.editor ?? "—")}</td>
              <td>${d.links.length ? d.links.map((l) => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join(" · ") : "<span class='muted'>—</span>"}</td>
            </tr>`).join("")
        }</tbody></table>`;
    return `
      <div class="client">
        <div class="client-head">
          <span class="client-name">${esc(c.name)}</span>
          <span class="muted small">Coördinator: <b>${esc(c.coordinator ?? "—")}</b> · Videograaf: <b>${esc(c.videographer ?? "—")}</b>${
            c.nextShoot ? ` · Volgende opname: <b>${esc(fmtDate(c.nextShoot.date))}</b>${c.nextShoot.location ? ` (${esc(c.nextShoot.location)})` : ""}` : ""
          }</span>
        </div>
        ${dels}
      </div>`;
  }).join("");

  const teamRows = snap.team.map((t) => `
    <tr><td><b>${esc(t.fullName)}</b></td><td>${esc(t.roleLabel)}</td><td>${esc(t.phone ?? "—")}</td><td>${esc(t.email)}</td></tr>`).join("");

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Noodprocedure ShortClips</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
  body { font-family: Inter, system-ui, Arial, sans-serif; color: #1c2230; font-size: 12px; margin: 0; }
  h1 { font-size: 22px; color: ${NAVY}; margin: 0 0 2px; }
  h2 { font-size: 15px; color: ${NAVY}; margin: 0 0 8px; }
  h3 { font-size: 14px; color: ${NAVY}; border-left: 4px solid ${BLUE}; padding-left: 8px; margin: 22px 0 10px; }
  .header { background: ${NAVY}; color: #fff; border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; }
  .header h1 { color: #fff; }
  .header .sub { color: rgba(255,255,255,.7); font-size: 12px; margin-top: 4px; }
  .box { background: #f5f7fb; border: 1px solid #e6e8ee; border-radius: 10px; padding: 14px 16px; margin-bottom: 8px; }
  .box ol { margin: 6px 0 0; padding-left: 18px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { text-align: left; color: #8a90a2; font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; padding: 6px 8px; border-bottom: 1px solid #e6e8ee; }
  td { padding: 7px 8px; border-bottom: 1px solid #eef0f4; vertical-align: top; }
  table.sub { margin-top: 6px; } table.sub th { font-size: 9.5px; }
  .client { border: 1px solid #e6e8ee; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; break-inside: avoid; }
  .client-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; }
  .client-name { font-size: 13px; font-weight: 800; color: ${NAVY}; }
  a { color: ${BLUE}; text-decoration: none; }
  .muted { color: #8a90a2; } .small { font-size: 10.5px; }
  .foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid #eef0f4; font-size: 10px; color: #aab0bf; }
</style></head><body>
  <div class="header">
    <h1>Noodprocedure ShortClips</h1>
    <div class="sub">Kritieke operationele informatie om door te werken als het portaal uitvalt · gegenereerd op ${esc(gen)}</div>
  </div>
  ${instructies}
  <h3>Komende opnames (3 weken)</h3>
  <table><thead><tr><th>Wanneer</th><th>Klant / opname</th><th>Locatie</th><th>Verantwoordelijk</th><th>Bestanden</th></tr></thead><tbody>${shootsRows}</tbody></table>
  <h3>Per klant — verantwoordelijken, deadlines &amp; bestanden</h3>
  ${clientBlocks || `<p class="muted">Geen actieve klanten.</p>`}
  <h3>Team — contactgegevens</h3>
  <table><thead><tr><th>Naam</th><th>Rol</th><th>Telefoon</th><th>E-mail</th></tr></thead><tbody>${teamRows}</tbody></table>
  <div class="foot">ShortClips · automatisch gegenereerd noodoverzicht · ${esc(gen)}</div>
</body></html>`;
}
