import Link from "next/link";
import { ArrowUpRight, BookOpen, Clapperboard, Mail, Phone } from "lucide-react";
import type { ClientHub } from "@/server/clients";
import type { DocButtonSlot } from "@/components/client-docs/doc-buttons";
import { daysUntil, formatDateFull, relativeDays } from "@/lib/format";
import { PostingToggle } from "./posting-toggle";

/**
 * Compact klantoverzicht (nov 2026): vier blokken die een medewerker binnen
 * vijf seconden laten zien wat er met de klant is afgesproken, wie
 * verantwoordelijk is, wanneer de volgende opname is en waar de guides staan.
 *
 * Alles komt uit bestaande bronnen, er wordt niets dubbel opgeslagen:
 * - Samenwerking: klant, actief pakket en het laatste contract (contractenoverzicht).
 * - Contactpersonen: primaire contactpersoon, coördinator en videograaf.
 * - Opnameplanning: de eerstvolgende opnamedag uit de opnameplanning (Google
 *   Agenda); de frequentie wordt afgeleid uit de opnamedagen zelf.
 * - Documenten: Klanten Guide en Editing Guide uit de centrale documentbron.
 * Bewust zonder financiële gegevens; die staan alleen in de financiële tabbladen.
 */

type Shoot = ClientHub["shoots"][number];

export function ClientOverview({
  hub,
  nextShoot,
  docSlots,
  canEditClient,
}: {
  hub: ClientHub;
  nextShoot?: Shoot;
  docSlots: DocButtonSlot[];
  canEditClient: boolean;
}) {
  const c = hub.client;
  const editHref = `/clients/${c.slug}/edit`;
  const contact = hub.contacts.find((x) => x.isPrimary) ?? hub.contacts[0] ?? null;
  const videographer = nextShoot?.videographerName ?? hub.videographer?.fullName ?? null;
  const contractEnd = hub.contract?.endsOn ?? null;
  const months = contractMonths(c.contractMonths, hub.contract?.startsOn ?? null, contractEnd);
  const startedOn = c.startedOn ?? hub.contract?.startsOn ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* 1. Samenwerking */}
      <section className="sc-card flex flex-col gap-3 p-6">
        <BlockHeader title="Samenwerking" action={canEditClient ? <EditLink href={editHref} /> : null} />
        <dl className="grid grid-cols-[150px_minmax(0,1fr)] text-sm">
          <Field label="Pakket">{hub.package?.name ?? "–"}</Field>
          <Field label="Aantal shorts" strong>
            {c.monthlyVideoQuota ? `${c.monthlyVideoQuota} per maand` : "–"}
          </Field>
          <Field label="Publicatie">
            <PostingToggle clientId={c.id} initial={c.weHandlePosting} canEdit={canEditClient} />
          </Field>
          <Field label="Klant sinds">{startedOn ? formatDateFull(startedOn) : "–"}</Field>
          <Field label="Contractduur">{months ? `${months} maanden` : "–"}</Field>
          <Field label="Contracteinde" strong last>
            {contractEnd ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                {formatDateFull(contractEnd)}
                <ContractBadge endsOn={contractEnd} />
              </span>
            ) : (
              "–"
            )}
          </Field>
        </dl>
      </section>

      {/* 2. Opnameplanning: het blok dat het vaakst nodig is, daarom donker. */}
      <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] p-6 text-white">
        <BlockHeader
          title="Opnameplanning"
          dark
          action={
            <Link
              href={nextShoot ? `/productions/${nextShoot.id}` : "/productions"}
              className="inline-flex items-center rounded-[var(--radius-md)] border border-white/35 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10"
            >
              {nextShoot ? "Opname openen" : "Naar planning"}
            </Link>
          }
        />
        <div className="flex flex-col gap-0.5 py-1">
          <span className="text-xs text-white/70">Volgende opname</span>
          {nextShoot ? (
            <>
              <span className="text-[28px] font-semibold leading-tight tracking-tight">
                {shootDayLabel(nextShoot.scheduledOn)}
              </span>
              <span className="text-sm text-white/80">
                {nextShoot.startTime ? `${nextShoot.startTime.slice(0, 5)} uur · ` : ""}
                {relativeDays(nextShoot.scheduledOn)}
              </span>
            </>
          ) : (
            <span className="text-lg font-semibold">Nog niet ingepland</span>
          )}
        </div>
        <dl className="grid grid-cols-[150px_minmax(0,1fr)] text-sm">
          <dt className="border-t border-white/15 py-2.5 text-white/70">Locatie</dt>
          <dd className="border-t border-white/15 py-2.5 font-medium">{nextShoot?.locationName ?? "–"}</dd>
          <dt className="border-t border-white/15 py-2.5 text-white/70">Frequentie</dt>
          <dd className="border-t border-white/15 py-2.5 font-medium">{shootFrequency(hub.shoots)}</dd>
        </dl>
        <span className="mt-auto text-2xs text-white/60">Automatisch uit de opnameplanning</span>
      </section>

      {/* 3. Contactpersonen */}
      <section className="sc-card flex flex-col gap-3 p-6">
        <BlockHeader title="Contactpersonen" action={canEditClient ? <EditLink href={editHref} /> : null} />
        <dl className="grid grid-cols-[150px_minmax(0,1fr)] text-sm">
          <Field label="Klant">
            {contact ? (
              <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-semibold">{contact.fullName}</span>
                {contact.phone ? (
                  <a href={`tel:${contact.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                    <Phone className="size-3.5" strokeWidth={1.75} /> {contact.phone}
                  </a>
                ) : null}
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
                    <Mail className="size-3.5" strokeWidth={1.75} /> {contact.email}
                  </a>
                ) : null}
              </span>
            ) : (
              "–"
            )}
          </Field>
          <Field label="Shortclips" strong>{c.coordinatorName ?? "–"}</Field>
          <Field label="Videograaf" strong last>{videographer ?? "–"}</Field>
        </dl>
      </section>

      {/* 4. Documenten */}
      <section className="sc-card flex flex-col gap-3 p-6">
        <BlockHeader title="Documenten" />
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          {docSlots.map((s) => (
            <DocTile key={s.kind} slot={s} />
          ))}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------ onderdelen ------------------------------ */

function BlockHeader({ title, action, dark }: { title: string; action?: React.ReactNode; dark?: boolean }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <h2 className={`text-xs font-semibold uppercase tracking-[0.08em] ${dark ? "text-white" : "text-[var(--color-ink)]"}`}>{title}</h2>
      {action}
    </div>
  );
}

function EditLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-[var(--radius-md)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition hover:border-[var(--color-ink-faint)]"
    >
      Bewerken
    </Link>
  );
}

function Field({ label, children, strong, last }: { label: string; children: React.ReactNode; strong?: boolean; last?: boolean }) {
  const line = last ? "" : "border-b border-[var(--color-line)]";
  return (
    <>
      <dt className={`py-2.5 text-[var(--color-ink-muted)] ${line}`}>{label}</dt>
      <dd className={`min-w-0 py-2.5 ${strong ? "font-semibold" : "font-medium"} ${line}`}>{children}</dd>
    </>
  );
}

function ContractBadge({ endsOn }: { endsOn: string }) {
  const days = daysUntil(endsOn);
  if (days < 0) {
    return <span className="rounded-full bg-[var(--color-bad-soft)] px-2 py-0.5 text-2xs font-semibold text-[#a3271c]">verlopen</span>;
  }
  const label = days < 45 ? `nog ${days} ${days === 1 ? "dag" : "dagen"}` : `nog ${Math.round(days / 30.4)} maanden`;
  // Pas opvallend kleuren binnen 60 dagen, zelfde grens als de verlengingssignalering.
  const tone = days < 60 ? "bg-[var(--color-warn-soft)] text-[#8a5300]" : "bg-[var(--color-neutral-soft)] text-[var(--color-ink-muted)]";
  return <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${tone}`}>{label}</span>;
}

function DocTile({ slot }: { slot: DocButtonSlot }) {
  const Icon = slot.kind === "klanten_guide" ? BookOpen : Clapperboard;
  const label = slot.kind === "klanten_guide" ? "Klantguide openen" : "Editing guide openen";
  if (!slot.url) {
    return (
      <span
        title={`${slot.label} is nog niet geüpload`}
        className="flex min-h-[112px] cursor-not-allowed flex-col justify-between gap-4 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line-strong)] p-5 text-[var(--color-ink-faint)]"
      >
        <Icon className="size-6" strokeWidth={1.6} />
        <span className="text-sm font-semibold">{slot.label} volgt</span>
      </span>
    );
  }
  return (
    <a
      href={slot.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-[112px] flex-col justify-between gap-4 rounded-[var(--radius-lg)] bg-[var(--color-indigo-ink)] p-5 text-white transition hover:opacity-90"
    >
      <Icon className="size-6" strokeWidth={1.6} />
      <span className="flex items-center justify-between gap-2 text-[15px] font-semibold">
        {label}
        <ArrowUpRight className="size-4" strokeWidth={1.8} />
      </span>
    </a>
  );
}

/* ------------------------------- afleidingen ------------------------------ */

const WEEKDAYS = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

/** "do 19 november" voor een datum als "2026-11-19". */
function shootDayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** Looptijd in maanden: uit start- en einddatum van het contract, anders het vastgelegde aantal bij de klant. */
function contractMonths(fixed: number | null | undefined, startsOn: string | null, endsOn: string | null): number | null {
  if (!startsOn || !endsOn) return fixed && fixed > 0 ? fixed : null;
  // Tot en met de einddatum: 1 april t/m 31 maart telt als 12 maanden.
  const ms = Date.parse(`${endsOn.slice(0, 10)}T00:00:00Z`) + 86400000 - Date.parse(`${startsOn.slice(0, 10)}T00:00:00Z`);
  const n = Math.round(ms / (86400000 * 30.44));
  return n > 0 ? n : null;
}

/**
 * Opnamefrequentie afgeleid uit de opnamedagen zelf (geen apart veld, dus
 * niets dubbel bij te houden): het mediane interval tussen de laatste opnames.
 */
function shootFrequency(shoots: Shoot[]): string {
  const dates = shoots
    .map((s) => s.scheduledOn.slice(0, 10))
    .sort()
    .slice(-6)
    .map((d) => Date.parse(`${d}T00:00:00Z`));
  if (dates.length < 2) return "–";
  const gaps = dates.slice(1).map((t, i) => Math.round((t - dates[i]) / 86400000)).filter((g) => g > 0);
  if (gaps.length === 0) return "–";
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 10) return "Wekelijks";
  if (median <= 20) return "Eens per twee weken";
  if (median <= 45) return "Maandelijks";
  if (median <= 75) return "Eens per twee maanden";
  if (median <= 110) return "Eens per kwartaal";
  return "Onregelmatig";
}
