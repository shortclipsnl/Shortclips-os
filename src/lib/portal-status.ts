import type { Tone } from "@/components/ui";

/**
 * De zes klant-statussen van een video (§projectstatus). Interne stappen
 * (interne controle, feedback verwerken, goedkeuren) blijven intern en worden
 * samengevouwen. Alleen "Jouw beoordeling" (en een script ter goedkeuring) is
 * een moment waarop de klant aan zet is.
 */
export type ClientStatus = "script" | "opname" | "montage" | "beoordeling" | "ingepland" | "online";

export type ClientStatusView = {
  key: ClientStatus;
  label: string;
  tone: Tone;
  /** Klant is aan zet → mag "Actie nodig" triggeren. */
  actionNeeded: boolean;
  /** Extra regel, bv. "Feedback wordt verwerkt" tijdens In montage. */
  sublabel?: string;
};

/** Vertaalt de interne videostatus naar wat de klant ziet. */
export function clientStatusView(status: string): ClientStatusView {
  switch (status) {
    case "recorded":
      return { key: "opname", label: "Opname", tone: "info", actionNeeded: false };
    case "footage_upload":
    case "awaiting_editor":
    case "editing":
    case "internal_review":
    case "editor_revision":
      return { key: "montage", label: "In montage", tone: "info", actionNeeded: false };
    case "client_revision":
      return { key: "montage", label: "In montage", tone: "info", actionNeeded: false, sublabel: "Feedback wordt verwerkt" };
    case "client_review":
      return { key: "beoordeling", label: "Jouw beoordeling", tone: "warn", actionNeeded: true };
    case "approved":
    case "ready_to_publish":
    case "scheduled":
      return { key: "ingepland", label: "Ingepland", tone: "good", actionNeeded: false };
    case "published":
    case "analysis_available":
      return { key: "online", label: "Online", tone: "ink", actionNeeded: false };
    default:
      return { key: "montage", label: "In montage", tone: "info", actionNeeded: false };
  }
}

/** Chip-kleur voor een status-tone binnen de donkere studio-stijl van het portaal. */
export function statusToneClass(tone: Tone | string): string {
  switch (tone) {
    case "warn": return "bg-[var(--color-warn-soft)] text-[#ffb020]";
    case "good": case "lime": return "bg-[var(--color-good-soft)] text-[#2fd27a]";
    case "ink": case "neutral": return "bg-white/10 text-[var(--color-ink-muted)]";
    default: return "bg-[var(--color-info-soft)] text-[#4bc4ff]";
  }
}

/** Alleen deze status betekent dat de klant een video moet beoordelen. */
export function waitingOnClient(status: string): boolean {
  return status === "client_review";
}

/** De klant heeft net feedback gegeven; wij verwerken die. */
export function feedbackBeingProcessed(status: string): boolean {
  return status === "client_revision";
}

/**
 * Reactietermijn: 3 werkdagen na oplevering (uit de voorwaarden). Geeft de
 * uiterste beoordelingsdatum terug.
 */
export function reviewDeadline(from: Date | string | null | undefined): Date | null {
  if (!from) return null;
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  let added = 0;
  while (added < 3) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

const DATE_FMT = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });

/** Korte deadline-tekst + of 't urgent is. */
export function deadlineText(d: Date | null): { text: string; urgent: boolean } | null {
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const date = DATE_FMT.format(d);
  if (days < 0) return { text: `Graag z.s.m. — termijn was ${date}`, urgent: true };
  if (days === 0) return { text: "Beoordeel bij voorkeur vandaag", urgent: true };
  if (days === 1) return { text: `Beoordeel vóór morgen (${date})`, urgent: true };
  return { text: `Beoordeel vóór ${date} · nog ${days} dagen`, urgent: days <= 2 };
}
