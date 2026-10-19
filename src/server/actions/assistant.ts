"use server";

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, dailyMetrics, notifications } from "@/db/schema";
import { ForbiddenError, requirePermission, scopeToClients, type Viewer } from "@/server/auth/context";
import { getMyDay } from "@/server/my-day";
import { getDashboard } from "@/server/dashboard";
import { getVideoHighlights } from "@/server/videos";
import { aiConfigured, runPrompt } from "@/server/ai/client";
import { SCRIPT_STATUS } from "@/lib/statuses";
import { compact } from "@/lib/format";
import type { AssistantAnswer, AssistantItem, AssistantTone, HandlerKey } from "@/lib/assistant";

type Result = { ok: true; answer: AssistantAnswer } | { ok: false; message: string };

function fmtDay(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = new Date(typeof d === "string" ? `${d.slice(0, 10)}T00:00:00` : d);
  return date.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}
function fmtWhen(d: Date): string {
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `vandaag ${time}` : `${d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })} ${time}`;
}
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

/* ---------------- Deterministische handlers (zonder AI) ---------------- */

async function hVandaag(viewer: Viewer): Promise<AssistantAnswer> {
  const day = await getMyDay(viewer);
  const taken: AssistantItem[] = day.tasks.map((t) => ({
    title: t.title,
    subtitle: t.clientName ?? "Eigen taak",
    meta: t.dueOn ? (t.overdue ? "te laat" : fmtDay(t.dueOn)) : null,
    tone: t.overdue ? "bad" : t.priority === "urgent" || t.priority === "high" ? "warn" : "neutral",
    href: "/tasks",
  }));
  const videos: AssistantItem[] = day.videos.map((v) => ({
    title: v.title,
    subtitle: v.clientName,
    meta: v.dueOn ? fmtDay(v.dueOn) : null,
    tone: "info",
    href: `/videos/${v.id}`,
  }));
  const shoots: AssistantItem[] = day.shoots.map((s) => ({
    title: s.clientName,
    subtitle: s.locationName ?? "locatie onbekend",
    meta: `${fmtDay(s.scheduledOn)}${s.startTime ? ` · ${s.startTime.slice(0, 5)}` : ""}`,
    tone: "info",
    href: `/productions/${s.id}`,
  }));
  const total = taken.length + videos.length + shoots.length;
  return {
    summary: total === 0
      ? "Je hebt op dit moment geen openstaande acties op je naam. "
      : `Je hebt ${[taken.length ? plural(taken.length, "taak", "taken") : "", videos.length ? plural(videos.length, "video", "video's") : "", shoots.length ? plural(shoots.length, "opname", "opnames") : ""].filter(Boolean).join(", ")} op je naam.`,
    groups: [
      { heading: "Jouw taken", items: taken },
      { heading: "Jouw video's", items: videos },
      { heading: "Jouw opnames", items: shoots },
    ].filter((g) => g.items.length > 0),
    source: "jouw taken, video's en opnames in de Hub",
  };
}

async function hTaken(viewer: Viewer): Promise<AssistantAnswer> {
  const day = await getMyDay(viewer);
  const items: AssistantItem[] = day.tasks.map((t) => ({
    title: t.title,
    subtitle: t.clientName ?? "Eigen taak",
    meta: t.dueOn ? (t.overdue ? "te laat" : fmtDay(t.dueOn)) : "geen datum",
    tone: t.overdue ? "bad" : t.priority === "urgent" || t.priority === "high" ? "warn" : "neutral",
    href: "/tasks",
  }));
  return {
    summary: items.length === 0 ? "Er staan geen taken op jouw naam open." : `Er ${items.length === 1 ? "staat" : "staan"} ${plural(items.length, "taak", "taken")} op jouw naam open.`,
    groups: [{ items }],
    source: "Taken",
  };
}

async function hScripts(viewer: Viewer): Promise<AssistantAnswer> {
  const data = await getDashboard(viewer);
  const items: AssistantItem[] = data.scripts.map((s) => ({
    title: s.title,
    subtitle: [s.clientName, SCRIPT_STATUS[s.status]?.label ?? s.status].filter(Boolean).join(" · "),
    meta: s.shootOn ? `opname ${fmtDay(s.shootOn)}` : null,
    tone: "warn",
    href: `/scripts/${s.id}`,
  }));
  return {
    summary: items.length === 0 ? "Er zijn geen scripts die nog op goedkeuring wachten." : `Er ${items.length === 1 ? "is" : "zijn"} ${plural(items.length, "script", "scripts")} die nog goedgekeurd of afgerond moeten worden.`,
    groups: [{ items }],
    source: "Scripting (scripts in review/herziening)",
  };
}

async function hOpnames(viewer: Viewer): Promise<AssistantAnswer> {
  const data = await getDashboard(viewer);
  const need = data.shoots.filter((s) => Number(s.openBlockers) > 0 || Number(s.unapprovedScripts) > 0);
  const items: AssistantItem[] = need.map((s) => {
    const parts = [
      Number(s.openBlockers) > 0 ? plural(Number(s.openBlockers), "openstaand punt", "openstaande punten") : "",
      Number(s.unapprovedScripts) > 0 ? `${plural(Number(s.unapprovedScripts), "script", "scripts")} nog niet goedgekeurd` : "",
    ].filter(Boolean);
    return {
      title: `${s.clientName}${s.title && s.title !== s.clientName ? ` — ${s.title}` : ""}`,
      subtitle: parts.join(" · ") || "voorbereiding nodig",
      meta: `${fmtDay(s.scheduledOn)}${s.startTime ? ` · ${s.startTime.slice(0, 5)}` : ""}`,
      tone: Number(s.openBlockers) > 0 ? "bad" : "warn",
      href: `/productions/${s.id}`,
    };
  });
  return {
    summary: items.length === 0 ? "Alle komende opnames zijn voorbereid — geen openstaande punten of ongoedgekeurde scripts." : `Er ${items.length === 1 ? "is" : "zijn"} ${plural(items.length, "opname", "opnames")} die nog voorbereiding nodig ${items.length === 1 ? "heeft" : "hebben"}.`,
    groups: [{ items }],
    source: "Opnameplanning (blokkades + scriptstatus)",
  };
}

async function hVideos(viewer: Viewer): Promise<AssistantAnswer> {
  const h = await getVideoHighlights(viewer);
  const map = (list: typeof h.lateList, tone: AssistantTone, metaWord: string): AssistantItem[] =>
    list.map((v) => ({
      title: v.title,
      subtitle: [v.clientName, v.editorName].filter(Boolean).join(" · "),
      meta: `${Number(v.days)} ${metaWord}`,
      tone,
      href: `/videos/${v.id}`,
    }));
  const total = Number(h.late) + Number(h.atClient) + Number(h.awaitingEditor);
  return {
    summary: total === 0 ? "Er zijn geen video's die nu aandacht vragen." : `Er ${total === 1 ? "is" : "zijn"} ${plural(total, "video", "video's")} die aandacht ${total === 1 ? "vraagt" : "vragen"}.`,
    groups: [
      { heading: "Over de deadline", items: map(h.lateList, "bad", "d te laat") },
      { heading: "Wacht op klant", items: map(h.atClientList, "warn", "d stil") },
      { heading: "Wacht op editor", items: map(h.awaitingEditorList, "info", "d bij editor") },
    ].filter((g) => g.items.length > 0),
    source: "Editing (deadlines en statussen)",
  };
}

async function hKlanten(viewer: Viewer): Promise<AssistantAnswer> {
  const data = await getDashboard(viewer);
  const risico: AssistantItem[] = data.clients.atRisk.map((c) => ({
    title: c.name,
    subtitle: c.riskReason ?? "risico",
    tone: c.riskLevel === "high" ? "bad" : "warn",
    meta: "risico",
    href: `/clients/${c.slug}`,
  }));
  const stil: AssistantItem[] = data.clients.silent.map((c) => ({
    title: c.name,
    subtitle: c.lastActivityAt ? `laatste activiteit ${fmtDay(c.lastActivityAt)}` : "lang geen activiteit",
    tone: "warn",
    href: `/clients/${c.slug}`,
  }));
  const achter: AssistantItem[] = data.clients.quotaGap.map((q) => ({
    title: q.clientName,
    subtitle: `${q.published} van ${q.quota} deze maand gepubliceerd`,
    meta: `${q.gap} tekort`,
    tone: "warn",
    href: `/clients/${q.clientSlug}`,
  }));
  const total = risico.length + stil.length + achter.length;
  return {
    summary: total === 0 ? "Geen klanten die nu op ons wachten of aandacht nodig hebben." : `Er ${total === 1 ? "is" : "zijn"} ${plural(total, "klant", "klanten")} die aandacht ${total === 1 ? "nodig heeft" : "nodig hebben"}.`,
    groups: [
      { heading: "Risico", items: risico },
      { heading: "Lang stil", items: stil },
      { heading: "Achter op de afspraak", items: achter },
    ].filter((g) => g.items.length > 0),
    source: "Klanten (risico, activiteit en quota)",
  };
}

async function hVeranderd(viewer: Viewer): Promise<AssistantAnswer> {
  const since = new Date();
  since.setDate(since.getDate() - 1);
  const rows = await db
    .select({ title: notifications.title, body: notifications.body, href: notifications.href, level: notifications.level, createdAt: notifications.createdAt })
    .from(notifications)
    .where(and(eq(notifications.userId, viewer.id), gte(notifications.createdAt, since)))
    .orderBy(desc(notifications.createdAt))
    .limit(25);
  const toneOf: Record<string, AssistantTone> = { critical: "bad", warning: "warn", info: "info", success: "good" };
  const items: AssistantItem[] = rows.map((n) => ({
    title: n.title,
    subtitle: n.body ?? null,
    meta: fmtWhen(new Date(n.createdAt)),
    tone: toneOf[n.level] ?? "neutral",
    href: n.href ?? null,
  }));
  return {
    summary: items.length === 0 ? "Er zijn geen nieuwe meldingen voor jou sinds gisteren." : `Er ${items.length === 1 ? "is" : "zijn"} ${plural(items.length, "melding", "meldingen")} voor jou sinds gisteren.`,
    groups: [{ items }],
    note: "Gebaseerd op jouw meldingen in de Hub (laatste 24 uur).",
    source: "Meldingen",
  };
}

async function hResultaten(viewer: Viewer): Promise<AssistantAnswer> {
  if (!viewer.permissions.has("analytics:read")) {
    return { summary: "Je hebt geen toegang tot de resultaten.", groups: [], note: "Resultaten zijn alleen zichtbaar voor rollen met toegang tot Resultaten." };
  }
  const rows = await db
    .select({
      name: clients.name,
      slug: clients.slug,
      views: sql<number>`coalesce(sum(${dailyMetrics.views}), 0)::int`,
    })
    .from(dailyMetrics)
    .innerJoin(clients, eq(clients.id, dailyMetrics.clientId))
    .where(and(isNull(clients.deletedAt), eq(clients.status, "active"), gte(dailyMetrics.measuredOn, sql`current_date - interval '30 days'`), scopeToClients(viewer, clients.id)))
    .groupBy(clients.id, clients.name, clients.slug)
    .orderBy(desc(sql`coalesce(sum(${dailyMetrics.views}), 0)`))
    .limit(6);
  const items: AssistantItem[] = rows
    .filter((r) => Number(r.views) > 0)
    .map((r, i) => ({
      title: `${i + 1}. ${r.name}`,
      subtitle: `${compact(Number(r.views))} weergaven (30 dagen)`,
      tone: "good",
      href: `/analytics/${r.slug}`,
    }));
  return {
    summary: items.length === 0 ? "Er zijn nog geen resultaten binnengekomen in de afgelopen 30 dagen." : "De best presterende klanten van de afgelopen 30 dagen, op weergaven.",
    groups: [{ items }],
    note: "Alleen klanten met gekoppelde cijfers (Metricool) tellen mee.",
    source: "Resultaten (dagelijkse snapshots, 30 dagen)",
  };
}

const HANDLERS: Record<HandlerKey, (v: Viewer) => Promise<AssistantAnswer>> = {
  vandaag: hVandaag,
  taken: hTaken,
  scripts: hScripts,
  opnames: hOpnames,
  videos: hVideos,
  klanten: hKlanten,
  veranderd: hVeranderd,
  resultaten: hResultaten,
};

/** Vrije tekst → de dichtstbijzijnde handler op trefwoorden, zodat ook getypte
 *  vragen zonder AI meteen uit de echte data beantwoord worden. */
function routeByKeyword(q: string): HandlerKey | null {
  const s = q.toLowerCase();
  if (/(resulta|presteer|best presterend|weergav|views|bereik)/.test(s)) return "resultaten";
  if (/(verander|sinds gisteren|nieuw sinds|update sinds|wat is er nieuw)/.test(s)) return "veranderd";
  if (/\bscript/.test(s)) return "scripts";
  if (/(opname|shoot|draaidag|voorbereid)/.test(s)) return "opnames";
  if (/(video|edit|deadline|te laat|oplever)/.test(s)) return "videos";
  if (/\bklant/.test(s)) return "klanten";
  if (/(mijn taak|mijn taken|taken|to-?do)/.test(s)) return "taken";
  if (/(vandaag|prioriteit|wat moet ik)/.test(s)) return "vandaag";
  return null;
}

export async function askAssistant(input: { question: string; handler?: HandlerKey }): Promise<Result> {
  try {
    const viewer = await requirePermission("ai:read");
    const question = input.question.trim();
    if (!question) return { ok: false, message: "Stel een vraag." };

    const key = input.handler ?? routeByKeyword(question);
    if (key) {
      const answer = await HANDLERS[key](viewer);
      return { ok: true, answer };
    }

    // Geen directe match. Met AI een kort, eerlijk antwoord; anders doorverwijzen.
    if (!aiConfigured()) {
      return {
        ok: true,
        answer: {
          summary: "Die vraag kan ik nu nog niet automatisch beantwoorden uit de data.",
          groups: [],
          note: "De voorbeeldvragen hieronder werken al wel foutloos, rechtstreeks uit de Hub. Vrije vragen worden ondersteund zodra de AI-sleutel is ingesteld.",
        },
      };
    }
    const res = await runPrompt({
      system: "Je bent de interne assistent van Shortclips. Je hebt GEEN directe toegang tot de database voor deze vraag. Geef een kort, eerlijk antwoord in het Nederlands en verwijs de medewerker naar de juiste pagina of een van de voorbeeldvragen. Verzin geen cijfers, statussen of deadlines.",
      user: question,
      maxTokens: 500,
    });
    if (!res.ok) {
      return { ok: true, answer: { summary: "Ik kon hier geen antwoord op geven.", groups: [], note: "Probeer een van de voorbeeldvragen hieronder." } };
    }
    return { ok: true, answer: { summary: res.text.trim(), groups: [], note: "Dit antwoord komt niet uit de live data. Gebruik de voorbeeldvragen voor concrete, actuele gegevens." } };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    throw error;
  }
}
