import Link from "next/link";
import { ArrowRight, Download, LayoutDashboard, Send } from "lucide-react";
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon";

/** WhatsApp-groen, iets donkerder dan het logo zodat witte tekst goed leesbaar blijft. */
const WA_GREEN = "#138a43";
const WA_TINT = "#eef8f1";
/** Klantportaal: subtiel Shortclips-donkerblauw. */
const PORTAL_TINT = "#f1f1f7";

/** Genummerde stap in een instructieblok. */
function Step({ n, color, children }: { n: number; color: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold text-white"
        style={{ background: color }}
        aria-hidden
      >
        {n}
      </span>
      <span className="min-w-0 text-[var(--color-ink-muted)]">{children}</span>
    </li>
  );
}

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
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--color-ink)]">
            Contentplanning en video&apos;s gaan altijd in één contactmoment naar de klant
          </p>
          <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
            Nooit los sturen. Kies hieronder hoe je deelt.
          </p>
        </div>
        <Link
          href="/videos"
          className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-[background-color,transform,box-shadow] bg-[#138a43] hover:-translate-y-px hover:bg-[#0e6e35] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ outlineColor: WA_GREEN }}
        >
          <WhatsAppIcon className="size-[18px]" />
          Naar WhatsApp-bericht op Editing
          <ArrowRight className="size-4" />
        </Link>
      </div>

      <div className="grid gap-3 border-t border-[var(--color-line)] p-3 sm:grid-cols-2">
        {/* Optie 1: WhatsApp */}
        <div
          className="rounded-[var(--radius-sm)] px-3.5 py-3 text-sm"
          style={{ background: WA_TINT, boxShadow: `inset 3px 0 0 ${WA_GREEN}` }}
        >
          <p className="flex items-center gap-2 font-semibold text-[var(--color-ink)]">
            <span className="flex size-6 items-center justify-center rounded-full text-white" style={{ background: WA_GREEN }}>
              <WhatsAppIcon className="size-3.5" />
            </span>
            Via WhatsApp
            <span className="font-normal text-[var(--color-ink-muted)]">videolink + PDF</span>
          </p>
          <ol className="mt-2.5 space-y-1.5">
            <Step n={1} color={WA_GREEN}>
              <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-ink)]"><Download className="size-3.5" />Download de contentplanning als PDF</span> (knop hieronder).
            </Step>
            <Step n={2} color={WA_GREEN}>
              Kopieer op Editing bij de opname het bericht <strong className="font-semibold text-[var(--color-ink)]">Link + PDF</strong>.
            </Step>
            <Step n={3} color={WA_GREEN}>
              Stuur bericht én PDF samen in <strong className="font-semibold text-[var(--color-ink)]">één</strong> WhatsApp-bericht.
            </Step>
          </ol>
        </div>

        {/* Optie 2: Klantportaal */}
        <div
          className="rounded-[var(--radius-sm)] px-3.5 py-3 text-sm"
          style={{ background: PORTAL_TINT, boxShadow: "inset 3px 0 0 var(--color-indigo-ink)" }}
        >
          <p className="flex items-center gap-2 font-semibold text-[var(--color-ink)]">
            <span className="flex size-6 items-center justify-center rounded-full bg-[var(--color-indigo-ink)] text-white">
              <LayoutDashboard className="size-3.5" />
            </span>
            Via het klantportaal
          </p>
          <ol className="mt-2.5 space-y-1.5">
            <Step n={1} color="var(--color-indigo-ink)">
              Kies de klant en klik op{" "}
              <span className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--color-indigo-ink)] px-1.5 py-0.5 text-xs font-semibold text-white">
                <Send className="size-3" />
                Goedkeuren en delen met klant
              </span>
            </Step>
            <Step n={2} color="var(--color-indigo-ink)">
              De planning staat dan direct in het portaal van de klant.
            </Step>
            <Step n={3} color="var(--color-indigo-ink)">
              Kopieer op Editing bij de opname het bericht <strong className="font-semibold text-[var(--color-ink)]">Portaal</strong>.
            </Step>
          </ol>
        </div>
      </div>
    </section>
  );
}
