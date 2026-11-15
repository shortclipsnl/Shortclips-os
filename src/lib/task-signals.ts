import { DEADLINE_TIME_LABEL, amsterdamDay, deadlineLabel } from "@/lib/feedback-deadline";
import { isFeedbackReminderKey } from "@/lib/ops-control/plan";
import { batchHref, parseBatchKey, parseStapKey } from "@/lib/maandcontrole";
import { periodLabel } from "@/lib/format";
import { isKlantmomentKey } from "@/lib/klantmomenten";
import { parseQuarterTaskKey } from "@/lib/kwartaal";

/**
 * Automatische meldingen die op de takenpagina als compacte, opvallende regel
 * verschijnen: de klantherinnering voor openstaande feedback en de
 * maandrapportage. Alle andere taken houden hun gewone weergave.
 */
export type TaskSignal =
  | { kind: "feedback"; title: string; text: string; meta: string | null; message: string }
  | { kind: "maandrapport"; title: string; text: string; meta: string | null; actionHref: string; status?: string | null }
  | { kind: "klantmoment"; title: string; text: string; meta: string | null; actionHref: string | null };

type TaskLike = {
  title: string;
  description: string | null;
  dedupeKey: string | null;
  entityType: string | null;
  entityId?: string | null;
  clientName: string | null;
  clientSlug?: string | null;
  /** Deadline van de taak (YYYY-MM-DD). Bij een feedbackronde is dat de laatste termijndag. */
  dueOn?: string | null;
};

const FEEDBACKRONDE_PREFIX = "feedbackronde:";

/**
 * Vast herinneringsbericht voor WhatsApp, netjes en vriendelijk. Met de
 * deadline-dag van de feedbackronde noemt het bericht ook het exacte moment:
 * op de laatste dag "vandaag vóór 17:00", daarna de datum die verstreken is.
 */
export function feedbackReminderMessage(dueDay?: string | null, today?: string): string {
  const now = today ?? amsterdamDay(new Date());
  const deadline = !dueDay
    ? null
    : dueDay === now
      ? `Vandaag is de laatste dag om feedback te geven. We ontvangen je reactie graag vóór ${DEADLINE_TIME_LABEL}.`
      : dueDay > now
        ? `We ontvangen je reactie graag uiterlijk ${deadlineLabel(dueDay)}.`
        : `De feedbacktermijn liep tot ${deadlineLabel(dueDay)}. We ontvangen je reactie graag zo snel mogelijk, zodat de planning op schema blijft.`;
  return [
    "Hoi! Bedankt weer voor de fijne samenwerking.",
    "Een korte herinnering: de nieuwe video's staan voor je klaar en we wachten nog op je feedback. Zou je ze willen bekijken en laten weten wat je ervan vindt? Dan kunnen wij ze verder afronden.",
    ...(deadline ? [deadline] : []),
    "Alvast bedankt, en laat het gerust weten als je ergens vragen over hebt.",
    "Groet, Team Shortclips",
  ].join("\n\n");
}

function clientFromTitle(title: string): string | null {
  if (title.includes(" | ")) return title.split(" | ")[0]!.trim() || null;
  const m = /:\s*(.+)$/.exec(title);
  return m ? m[1]!.trim() : null;
}

function line(description: string | null, prefix: string): string | null {
  const l = description?.split("\n").find((x) => x.startsWith(prefix));
  return l ? l.slice(prefix.length).trim() : null;
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

export function taskSignal(t: TaskLike): TaskSignal | null {
  const key = t.dedupeKey;
  const opsFeedback = isFeedbackReminderKey(key);
  if (opsFeedback || key?.startsWith(FEEDBACKRONDE_PREFIX)) {
    const client = t.clientName ?? clientFromTitle(t.title) ?? "Klant";
    let meta: string | null = null;
    if (opsFeedback) {
      // "Donker Groep #1 · 1 dag over deadline, wacht op klant" → zonder de herhaling.
      meta = line(t.description, "Probleem:")?.replace(/,?\s*wacht op klant$/i, "") ?? null;
    } else {
      // Eerste zin van de feedbacktermijn ("De feedbacktermijn van 3 werkdagen is verstreken.").
      meta = t.description?.split(/(?<=\.)\s/)[0]?.replace(/\.$/, "") ?? null;
    }
    return {
      kind: "feedback",
      title: `Feedback herinneren | ${client}`,
      text: "Klant heeft nog geen feedback gegeven. Stuur een herinnering.",
      meta: meta || null,
      // Alleen bij een feedbackronde is de taakdatum de laatste termijndag van de klant.
      message: feedbackReminderMessage(opsFeedback ? null : t.dueOn),
    };
  }

  // Maandrapportage per klant en processtap: klantnaam voorop, wat er moet
  // gebeuren, de status en een directe knop naar de rapportage.
  const stap = parseStapKey(key);
  if (stap) {
    return {
      kind: "maandrapport",
      title: t.clientName ?? "Klant",
      text: t.title,
      meta: null,
      status: t.description?.split("\n")[0]?.trim() || null,
      actionHref: t.entityId ? `/analytics/maandrapportages/${t.entityId}` : "/analytics/maandrapportages",
    };
  }

  // Kwartaalrapportage per klant en processtap: zelfde compacte weergave.
  if (parseQuarterTaskKey(key)) {
    return {
      kind: "maandrapport",
      title: t.clientName ?? "Klant",
      text: t.title,
      meta: null,
      status: t.description?.split("\n")[0]?.trim() || null,
      actionHref: t.entityId ? `/analytics/kwartaalrapportages/${t.entityId}` : "/analytics/kwartaalrapportages",
    };
  }

  // Klantmoment (samenwerkings- of bedrijfsjubileum): een week vooraf.
  if (isKlantmomentKey(key)) {
    const moment = line(t.description, "Moment:");
    const voorstel = line(t.description, "Voorstel:");
    const indicatie = t.description?.includes("datum is een indicatie") ?? false;
    return {
      kind: "klantmoment",
      title: t.title,
      text: moment ?? "Klantmoment",
      meta: [voorstel ? `Voorstel: ${voorstel}` : null, indicatie ? "datum eerst bevestigen" : null].filter(Boolean).join(" · ") || null,
      actionHref: t.clientSlug ? `/clients/${t.clientSlug}` : null,
    };
  }

  const batch = t.entityType === "report_batch" ? parseBatchKey(key) : null;
  if (batch) {
    const month = capitalize(periodLabel(batch.period).split(" ")[0] ?? batch.period);
    const first = t.description?.split("\n")[0]?.trim() ?? null;
    return {
      kind: "maandrapport",
      title: `Maandrapportage | ${month}`,
      text: "Rapportage controleren en afronden.",
      meta: first ? first.replace(/\.$/, "") : null,
      actionHref: batchHref(batch.period),
    };
  }
  return null;
}
