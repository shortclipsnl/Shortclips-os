import Link from "next/link";
import { LayoutDashboard, MessageCircle, Paperclip, Send } from "lucide-react";

/**
 * Vaste werkafspraak bovenaan de contentplanning: de contentplanning gaat nooit
 * los naar de klant, maar altijd in hetzelfde contactmoment als de eerste
 * versies van de video's. Het bericht zelf kopieert het team bij de opname op
 * de Editing-pagina (WhatsApp-bericht, variant "Link + PDF" of "Portaal").
 */
export function ContactmomentNote() {
  return (
    <section
      aria-label="Werkafspraak contentplanning delen"
      className="sc-card mb-4 overflow-hidden"
      style={{ boxShadow: "inset 3px 0 0 var(--color-indigo-ink)" }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            Contentplanning en video&apos;s gaan altijd in één contactmoment naar de klant
          </p>
          <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
            Stuur de contentplanning nooit los. Deel hem op hetzelfde moment als de eerste versies van de video&apos;s, in één bericht.
          </p>
        </div>
        <Link
          href="/videos"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
        >
          <MessageCircle className="size-4" />
          Naar WhatsApp-bericht op Editing
        </Link>
      </div>
      <div className="grid gap-px border-t border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2">
        <div className="bg-[var(--color-surface)] px-4 py-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-[var(--color-ink)]">
            <Paperclip className="size-4 text-[var(--color-ink-muted)]" />
            Via WhatsApp (videolink + PDF)
          </p>
          <p className="mt-1 text-[var(--color-ink-muted)]">
            Download hieronder de contentplanning als PDF. Kopieer bij de opname op Editing het bericht <strong className="font-semibold text-[var(--color-ink)]">Link + PDF</strong> en voeg de PDF toe in hetzelfde WhatsApp-bericht.
          </p>
        </div>
        <div className="bg-[var(--color-surface)] px-4 py-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold text-[var(--color-ink)]">
            <LayoutDashboard className="size-4 text-[var(--color-ink-muted)]" />
            Via het klantportaal
          </p>
          <p className="mt-1 text-[var(--color-ink-muted)]">
            Klik op <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-ink)]"><Send className="size-3" />Goedkeuren en delen met klant</span>; de planning staat dan direct in het portaal van de klant. Kopieer daarna bij de opname op Editing het bericht <strong className="font-semibold text-[var(--color-ink)]">Portaal</strong>.
          </p>
        </div>
      </div>
    </section>
  );
}
