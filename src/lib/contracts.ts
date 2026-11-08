/**
 * Contracten & Verlengingen: alle rekenregels op één plek, zonder database.
 *
 * Uitgangspunten:
 *  - Elke contractperiode is een eigen record. Een verlenging is een nieuwe
 *    periode; de oude blijft bewaard, zodat historische waarde niet verloren gaat.
 *  - We rekenen alleen met vastgelegde afspraken. Een automatische verlenging
 *    die nog niet als periode is vastgelegd, telt niet mee als omzet.
 *  - Ontbreekt iets (startdatum, einddatum, looptijd), dan is de uitkomst
 *    "onbekend" in plaats van een gok.
 *  - Commerciële verlengstatus (open, in bespreking, verlengd, beëindigd) staat
 *    los van de administratieve status: een klant die stopt blijft actief tot de
 *    einddatum.
 */

export const DEFAULT_REMINDER_DAYS = [60, 30, 14, 7] as const;
/** Binnen zoveel dagen tot het einde telt een contract als "loopt af". */
export const EXPIRING_WINDOW_DAYS = 60;

export type RenewalStatus = "open" | "in_bespreking" | "verlengd" | "beeindigd";
export const RENEWAL_LABEL: Record<RenewalStatus, string> = {
  open: "Nog niet besproken",
  in_bespreking: "In bespreking",
  verlengd: "Verlengd",
  beeindigd: "Beëindigd",
};
export type Reactivation = "kansrijk" | "misschien" | "nee";
export const REACTIVATION_LABEL: Record<Reactivation, string> = {
  kansrijk: "Kansrijk",
  misschien: "Misschien",
  nee: "Niet waarschijnlijk",
};

export type ContractPeriod = {
  id: string;
  /** Administratief: draft | active | notice_given | expired | terminated. */
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  durationMonths: number | null;
  monthlyValue: number;
  videosPerMonth: number | null;
  autoRenew: boolean;
  noticePeriodDays: number;
  renewalStatus: RenewalStatus;
  clientConfirmed: boolean;
  reminderDays: number[] | null;
  endReason: string | null;
  reactivation: Reactivation | null;
  notes: string | null;
  verified: boolean;
  ownerManaged: boolean;
  previousContractId: string | null;
  createdAt: string;
};

export type ContractClient = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  color: string | null;
  /** prospect | onboarding | active | paused | churned */
  status: string;
  /** Uit de klantgegevens; alleen gebruikt als er geen contractperiode is. */
  monthlyRevenue: number;
  monthlyVideoQuota: number;
  endedOn: string | null;
  periods: ContractPeriod[];
};

/* ------------------------------------------------------------------ *
 * Datums (ISO yyyy-mm-dd, UTC, geen tijdzones)
 * ------------------------------------------------------------------ */

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

/** Aantal dagen van `from` tot `to` (positief als `to` later is). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}

/** Maanden optellen; 31 januari + 1 maand = 28/29 februari. */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return toIso(target);
}

/** Einddatum bij een start en looptijd: 1 jan + 3 maanden = 31 maart. */
export function endDateFor(startsOn: string, months: number): string {
  return addDays(addMonths(startsOn, months), -1);
}

/**
 * Looptijd in maanden tussen start en einddatum (inclusief). Hele maanden waar
 * het klopt (1 jan t/m 31 mrt = 3), anders afgerond op één decimaal.
 */
export function monthsBetween(startsOn: string, endsOn: string): number {
  const endExcl = addDays(endsOn, 1);
  let whole = 0;
  while (addMonths(startsOn, whole + 1) <= endExcl && whole < 600) whole++;
  const rest = daysBetween(addMonths(startsOn, whole), endExcl);
  return rest === 0 ? whole : Math.round((whole + rest / 30.44) * 10) / 10;
}

/* ------------------------------------------------------------------ *
 * Waarde per periode
 * ------------------------------------------------------------------ */

/** Afgesproken looptijd: vastgelegd, of uit start en einddatum. Anders onbekend. */
export function periodMonths(p: Pick<ContractPeriod, "durationMonths" | "startsOn" | "endsOn">): number | null {
  if (p.durationMonths != null && p.durationMonths > 0) return p.durationMonths;
  if (p.startsOn && p.endsOn && p.endsOn >= p.startsOn) return monthsBetween(p.startsOn, p.endsOn);
  return null;
}

export type PeriodValue = {
  /** Oorspronkelijke contractwaarde over de hele looptijd. */
  total: number | null;
  /** Al verstreken (gefactureerde termijnen tot en met vandaag). */
  elapsed: number | null;
  /** Nog te verwachten vanaf vandaag tot de einddatum. */
  remaining: number | null;
};

/**
 * Waarde van één periode, gesplitst in verstreken en resterend. Facturatie is
 * per maand vooraf, dus een maandtermijn die vandaag al loopt telt als
 * verstreken. Zonder startdatum rekenen we terug vanaf de einddatum.
 */
export function periodValue(p: ContractPeriod, today: string): PeriodValue {
  const months = periodMonths(p);
  const monthly = p.monthlyValue || 0;
  const total = months != null ? Math.round(monthly * months * 100) / 100 : null;

  if (!p.endsOn) return { total, elapsed: null, remaining: null };
  if (p.endsOn < today) return { total, elapsed: total, remaining: 0 };

  let remainingTerms: number;
  if (p.startsOn) {
    if (p.startsOn > today) return { total, elapsed: 0, remaining: total };
    // Termijnen die nog moeten beginnen.
    let started = 0;
    while (addMonths(p.startsOn, started) <= today && started < 600) started++;
    const all = months ?? started;
    remainingTerms = Math.max(0, all - started);
  } else {
    // Terugrekenen vanaf de einddatum: termijn k begint op (eind+1) − (k+1) maanden.
    const endExcl = addDays(p.endsOn, 1);
    remainingTerms = 0;
    while (addMonths(endExcl, -(remainingTerms + 1)) > today && remainingTerms < 600) remainingTerms++;
    if (months != null) remainingTerms = Math.min(remainingTerms, Math.ceil(months));
  }
  const remaining = Math.round(monthly * remainingTerms * 100) / 100;
  const elapsed = total != null ? Math.max(0, Math.round((total - remaining) * 100) / 100) : null;
  return { total, elapsed, remaining };
}

/* ------------------------------------------------------------------ *
 * Welke periode geldt nu
 * ------------------------------------------------------------------ */

const startKey = (p: ContractPeriod) => p.startsOn ?? "0000-00-00";

/** Periodes van oud naar nieuw (onbekende start eerst), concepten niet meegerekend. */
export function sortPeriods(periods: ContractPeriod[]): ContractPeriod[] {
  return periods
    .filter((p) => p.status !== "draft")
    .slice()
    .sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.createdAt.localeCompare(b.createdAt));
}

/** De periode die vandaag loopt; bij overlap de meest recente. */
export function currentPeriod(periods: ContractPeriod[], today: string): ContractPeriod | null {
  const running = sortPeriods(periods).filter(
    (p) => (!p.startsOn || p.startsOn <= today) && (!p.endsOn || p.endsOn >= today),
  );
  return running.at(-1) ?? null;
}

/** De laatst vastgelegde periode (kan in de toekomst beginnen). */
export function latestPeriod(periods: ContractPeriod[]): ContractPeriod | null {
  return sortPeriods(periods).at(-1) ?? null;
}

/* ------------------------------------------------------------------ *
 * Status en herinneringen per klant
 * ------------------------------------------------------------------ */

export type DisplayStatus = "actief" | "loopt_af" | "verlengd" | "stopt" | "verlopen" | "gepauzeerd" | "beeindigd" | "geen_contract";
export const DISPLAY_LABEL: Record<DisplayStatus, string> = {
  actief: "Actief",
  loopt_af: "Loopt af",
  verlengd: "Verlengd",
  stopt: "Stopt",
  verlopen: "Einddatum verstreken",
  gepauzeerd: "Gepauzeerd",
  beeindigd: "Beëindigd",
  geen_contract: "Geen contract",
};

export type Stage = number | "opzegtermijn_voorbij" | "verlopen";

export type AttentionItem = {
  key: string;
  clientId: string;
  clientName: string;
  clientSlug: string;
  contractId: string;
  stage: Stage;
  /** Lager = urgenter. */
  rank: number;
  tone: "info" | "aandacht" | "urgent" | "kritiek";
  title: string;
  detail: string;
};

export type ContractRow = {
  client: ContractClient;
  active: boolean;
  status: DisplayStatus;
  current: ContractPeriod | null;
  latest: ContractPeriod | null;
  /** Periode waarop de klant nu (of laatst) zat: lopend, anders laatst vastgelegd. */
  shown: ContractPeriod | null;
  renewed: boolean;
  monthly: number;
  /** "contract" = uit een vastgelegde periode, "klantgegevens" = terugval. */
  monthlySource: "contract" | "klantgegevens" | null;
  videosPerMonth: number | null;
  months: number | null;
  /** Eerstvolgende einddatum: van de lopende periode, of de laatst vastgelegde. */
  endsOn: string | null;
  daysLeft: number | null;
  decisionDate: string | null;
  daysToDecision: number | null;
  value: PeriodValue;
  /** Lopende + vastgelegde toekomstige periodes, vanaf vandaag. */
  remainingCommitted: number | null;
  historicTotal: number;
  historicComplete: boolean;
  /** Wat ontbreekt of nog niet is gecontroleerd. */
  issues: string[];
  attention: AttentionItem | null;
  countsInRevenue: boolean;
};

/**
 * Opzegtermijn die we meetellen. Bij ongecontroleerde contracten is de
 * opgeslagen termijn vaak alleen de standaardwaarde (30 dagen); daar rekenen
 * we niet mee, anders ontstaan meldingen over een opzegdeadline die mogelijk
 * niet bestaat. Dan geldt de einddatum.
 */
export function effectiveNotice(p: Pick<ContractPeriod, "noticePeriodDays" | "verified">): number {
  return p.verified ? p.noticePeriodDays : 0;
}

/** Beslismoment: einddatum min opzegtermijn (de laatste dag om nog op te zeggen). */
export function decisionDateFor(p: Pick<ContractPeriod, "endsOn" | "noticePeriodDays" | "verified">): string | null {
  if (!p.endsOn) return null;
  const notice = effectiveNotice(p);
  return notice > 0 ? addDays(p.endsOn, -notice) : p.endsOn;
}

/**
 * Herinneringsfase: het kleinste herinneringsmoment waar we al binnen zitten.
 * Bijv. 25 dagen voor het beslismoment met momenten 60/30/14/7 → fase 30.
 */
export function stageFor(daysToDecision: number, reminderDays: readonly number[]): number | null {
  const sorted = [...new Set(reminderDays.filter((d) => Number.isFinite(d) && d >= 0))].sort((a, b) => a - b);
  for (const d of sorted) if (daysToDecision <= d) return d;
  return null;
}

function toneFor(stage: Stage, reminderDays: readonly number[]): AttentionItem["tone"] {
  if (stage === "verlopen" || stage === "opzegtermijn_voorbij") return "kritiek";
  const sorted = [...reminderDays].sort((a, b) => a - b);
  const idx = sorted.indexOf(stage);
  if (idx === 0) return "kritiek";
  if (idx === 1) return "urgent";
  if (idx === sorted.length - 1 && sorted.length > 2) return "info";
  return "aandacht";
}

const nlDate = (iso: string) => toDate(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Sleutel per fase: na afhandelen komt dezelfde fase niet terug, de volgende wel. */
export const attentionKey = (contractId: string, decisionDate: string, stage: Stage) =>
  `contract-owner:${contractId}:${decisionDate}:${stage}`;

export function buildRow(c: ContractClient, today: string): ContractRow {
  const periods = sortPeriods(c.periods);
  const current = currentPeriod(periods, today);
  const latest = latestPeriod(periods);
  const renewed = !!latest && !!current && latest.id !== current.id && !!latest.startsOn && latest.startsOn > today;
  const shown = current ?? latest;

  // Actief = de samenwerking loopt (administratief), los van de verlengstatus.
  const stoppedAndPast = latest?.renewalStatus === "beeindigd" && !!latest.endsOn && latest.endsOn < today;
  const active = c.status !== "churned" && c.status !== "prospect" && !stoppedAndPast;

  // Maandbedrag uit het contract; staat daar niets (0), dan uit de klantgegevens.
  const fromContract = !!shown && shown.monthlyValue > 0;
  const monthlySource: ContractRow["monthlySource"] = fromContract ? "contract" : c.monthlyRevenue > 0 ? "klantgegevens" : null;
  const monthly = fromContract ? shown!.monthlyValue : c.monthlyRevenue;
  const videosPerMonth = shown?.videosPerMonth ?? (c.monthlyVideoQuota > 0 ? c.monthlyVideoQuota : null);

  // Na een verlenging gaat het over de nieuwe einddatum.
  const focus = renewed ? latest : shown;
  const endsOn = focus?.endsOn ?? null;
  const daysLeft = endsOn ? daysBetween(today, endsOn) : null;
  const decisionDate = focus ? decisionDateFor(focus) : null;
  const daysToDecision = decisionDate ? daysBetween(today, decisionDate) : null;

  const value = shown ? periodValue(shown, today) : { total: null, elapsed: null, remaining: null };
  let remainingCommitted: number | null = 0;
  for (const p of periods) {
    if (p.endsOn && p.endsOn < today) continue;
    const v = periodValue(p, today).remaining;
    if (v == null) { remainingCommitted = null; break; }
    remainingCommitted += v;
  }
  if (!periods.length) remainingCommitted = null;

  let historicTotal = 0;
  let historicComplete = periods.length > 0;
  for (const p of periods) {
    const t = periodValue(p, today).total;
    if (t == null) historicComplete = false;
    else historicTotal += t;
  }

  const issues: string[] = [];
  if (!shown) issues.push("Geen contract vastgelegd");
  else {
    if (!shown.verified) issues.push("Nog niet gecontroleerd");
    if (!shown.startsOn) issues.push("Startdatum onbekend");
    if (!shown.endsOn) issues.push("Einddatum onbekend");
    if (periodMonths(shown) == null) issues.push("Looptijd onbekend");
  }

  let status: DisplayStatus;
  if (!active) status = "beeindigd";
  else if (!shown) status = "geen_contract";
  else if (c.status === "paused") status = "gepauzeerd";
  else if (focus?.renewalStatus === "beeindigd") status = "stopt";
  else if (renewed || focus?.renewalStatus === "verlengd") status = "verlengd";
  else if (endsOn && endsOn < today) status = "verlopen";
  else if (daysLeft != null && daysLeft <= EXPIRING_WINDOW_DAYS) status = "loopt_af";
  else if (daysToDecision != null && stageFor(daysToDecision, focus?.reminderDays ?? DEFAULT_REMINDER_DAYS) != null && daysToDecision <= EXPIRING_WINDOW_DAYS) status = "loopt_af";
  else status = "actief";

  const countsInRevenue = active && c.status !== "paused" && monthly > 0 && (!!current || !shown);

  const row: ContractRow = {
    client: c, active, status, current, latest, shown, renewed, monthly, monthlySource, videosPerMonth,
    months: shown ? periodMonths(shown) : null, endsOn, daysLeft, decisionDate, daysToDecision, value,
    remainingCommitted, historicTotal, historicComplete, issues, attention: null, countsInRevenue,
  };
  row.attention = attentionFor(row, today);
  return row;
}

/**
 * Het aandachtspunt voor deze klant, of null. Alleen als er een beslissing
 * openstaat: verlengd of beëindigd vastgelegd = geen waarschuwingen meer.
 */
export function attentionFor(row: ContractRow, today: string): AttentionItem | null {
  const p = row.renewed ? row.latest : row.shown;
  if (!row.active || row.client.status === "paused" || !p || !p.endsOn) return null;
  if (row.renewed || p.renewalStatus === "verlengd" || p.renewalStatus === "beeindigd") return null;

  const decision = decisionDateFor(p)!;
  const daysToDecision = daysBetween(today, decision);
  const daysToEnd = daysBetween(today, p.endsOn);
  const reminders = p.reminderDays?.length ? p.reminderDays : [...DEFAULT_REMINDER_DAYS];
  const notice = effectiveNotice(p) > 0;
  const by = notice ? `opzeggen kan tot ${nlDate(decision)}` : `einddatum ${nlDate(p.endsOn)}`;
  const base = { clientId: row.client.id, clientName: row.client.name, clientSlug: row.client.slug, contractId: p.id };
  const discussing = p.renewalStatus === "in_bespreking" ? " Staat op in bespreking." : "";
  const confirmed = p.clientConfirmed ? " De klant heeft al bevestigd door te gaan: leg de verlenging vast." : "";

  let stage: Stage;
  let title: string;
  let detail: string;
  if (daysToEnd < 0) {
    stage = "verlopen";
    title = `${row.client.name}: einddatum verstreken`;
    detail = `Het contract liep tot ${nlDate(p.endsOn)} en er is geen verlenging of beëindiging vastgelegd${p.autoRenew ? " (automatische verlenging nog niet vastgelegd als nieuwe periode)" : ""}.`;
  } else if (daysToDecision < 0) {
    stage = "opzegtermijn_voorbij";
    title = `${row.client.name}: opzegtermijn verstreken`;
    detail = `De opzegtermijn liep tot ${nlDate(decision)}; het contract eindigt op ${nlDate(p.endsOn)}. Leg vast wat er is afgesproken.${p.autoRenew ? " Het contract verlengt automatisch." : ""}`;
  } else {
    const s = stageFor(daysToDecision, reminders);
    if (s == null) return null;
    stage = s;
    const when = daysToDecision === 0 ? "vandaag" : `over ${daysToDecision} ${daysToDecision === 1 ? "dag" : "dagen"}`;
    const sorted = [...reminders].sort((a, b) => a - b);
    if (s === sorted[0]) {
      title = `${row.client.name}: laatste waarschuwing`;
      detail = `Nog geen beslissing vastgelegd, ${by} (${when}).`;
    } else if (sorted.length > 1 && s === sorted[1]) {
      title = `${row.client.name}: nog geen verlenging geregistreerd`;
      detail = `Beslismoment ${when}: ${by}.`;
    } else if (s === sorted.at(-1) && sorted.length > 2) {
      title = `${row.client.name}: samenwerking loopt richting het einde`;
      detail = `Beslismoment ${when}: ${by}.`;
    } else {
      title = `${row.client.name}: verlenging bespreken`;
      detail = `Neem contact op over de verlenging. Beslismoment ${when}: ${by}.`;
    }
  }
  detail += discussing + confirmed;
  if (!p.verified) detail += " Contractgegevens (o.a. opzegtermijn) nog niet gecontroleerd.";

  const rank = stage === "verlopen" ? -2000 : stage === "opzegtermijn_voorbij" ? -1000 : daysToDecision;
  return { ...base, key: attentionKey(p.id, decision, stage), stage, rank, tone: toneFor(stage, reminders), title, detail };
}

/* ------------------------------------------------------------------ *
 * Overzicht en totalen
 * ------------------------------------------------------------------ */

export type ContractTotals = {
  activeClients: number;
  monthlyRevenue: number;
  /** Lopende contractwaarde vanaf vandaag tot de einddatums. */
  remainingValue: number;
  /** Klanten zonder bekende einddatum, niet meegeteld in de lopende waarde. */
  remainingUnknown: number;
  /** Oorspronkelijke waarde van de lopende periodes en het deel dat al verstreken is. */
  originalValue: number;
  elapsedValue: number;
  expiringSoon: number;
  toVerify: number;
};

export function totalsFor(rows: ContractRow[], today: string): ContractTotals {
  const active = rows.filter((r) => r.active);
  const t: ContractTotals = {
    activeClients: active.length, monthlyRevenue: 0, remainingValue: 0, remainingUnknown: 0,
    originalValue: 0, elapsedValue: 0, expiringSoon: 0, toVerify: 0,
  };
  for (const r of active) {
    if (r.countsInRevenue) t.monthlyRevenue += r.monthly;
    if (r.client.status !== "paused") {
      if (r.remainingCommitted == null) t.remainingUnknown++;
      else t.remainingValue += r.remainingCommitted;
      if (r.value.total != null && r.current) {
        t.originalValue += r.value.total;
        t.elapsedValue += r.value.elapsed ?? 0;
      }
    }
    const open = !r.renewed && r.status !== "verlengd" && r.status !== "stopt" && r.status !== "gepauzeerd";
    if (open && r.endsOn && r.endsOn >= today && daysBetween(today, r.endsOn) <= EXPIRING_WINDOW_DAYS) t.expiringSoon++;
    if (r.issues.length) t.toVerify++;
  }
  for (const k of ["monthlyRevenue", "remainingValue", "originalValue", "elapsedValue"] as const) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}

/** Actieve klanten: eerstvolgende einddatum bovenaan, onbekende einddatums onderaan. */
export function sortActive(rows: ContractRow[]): ContractRow[] {
  return rows.filter((r) => r.active).sort((a, b) => {
    const ea = a.endsOn ?? "9999-12-31";
    const eb = b.endsOn ?? "9999-12-31";
    return ea.localeCompare(eb) || a.client.name.localeCompare(b.client.name, "nl");
  });
}

/** Niet actieve klanten: meest recent gestopt bovenaan. */
export function sortInactive(rows: ContractRow[]): ContractRow[] {
  return rows.filter((r) => !r.active).sort((a, b) => {
    const ea = a.endsOn ?? a.client.endedOn ?? "0000";
    const eb = b.endsOn ?? b.client.endedOn ?? "0000";
    return eb.localeCompare(ea) || a.client.name.localeCompare(b.client.name, "nl");
  });
}

/** Aandachtspunten, urgentste eerst, zonder de al afgehandelde fases. */
export function attentionList(rows: ContractRow[], handled: Set<string>): AttentionItem[] {
  return rows
    .map((r) => r.attention)
    .filter((a): a is AttentionItem => !!a && !handled.has(a.key))
    .sort((a, b) => a.rank - b.rank || a.clientName.localeCompare(b.clientName, "nl"));
}

/** Resterende tijd leesbaar: dagen tot twee maanden, daarna maanden. */
export function remainingLabel(daysLeft: number | null): string {
  if (daysLeft == null) return "Onbekend";
  if (daysLeft < 0) return `${-daysLeft} ${daysLeft === -1 ? "dag" : "dagen"} verstreken`;
  if (daysLeft === 0) return "Eindigt vandaag";
  if (daysLeft <= 60) return `${daysLeft} ${daysLeft === 1 ? "dag" : "dagen"}`;
  const m = Math.round(daysLeft / 30.44);
  return `${m} ${m === 1 ? "maand" : "maanden"}`;
}
