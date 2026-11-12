"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  Bell,
  BrainCircuit,
  CalendarDays,
  CalendarRange,
  FileBarChart,
  FileText,
  Handshake,
  Home,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Repeat,
  Smartphone,
  Trophy,
  UserRound,
  Video,
  X,
} from "lucide-react";

import { PORTAL_CONTENTGEHEUGEN_LIVE } from "@/lib/feature-flags";

/** Desktop-zijbalk: alle onderdelen van het portaal. */
const ITEMS = [
  { href: "/portal", label: "Overzicht", icon: LayoutDashboard },
  { href: "/portal/videos", label: "Video's", icon: Video },
  { href: "/portal/scripts", label: "Scripts", icon: FileText },
  { href: "/portal/content", label: "Contentplanning", icon: CalendarDays },
  { href: "/portal/planning", label: "Opnameplanning", icon: CalendarRange },
  { href: "/portal/resultaten", label: "Resultaten", icon: BarChart3 },
  { href: "/portal/analyses", label: "Maandanalyses", icon: FileBarChart },
  ...(PORTAL_CONTENTGEHEUGEN_LIVE ? [{ href: "/portal/contentgeheugen", label: "Contentgeheugen", icon: BrainCircuit }] : []),
  { href: "/portal/mijlpalen", label: "Onze mijlpalen", icon: Trophy },
  { href: "/portal/werkwijze", label: "Zo werken wij", icon: Repeat },
  { href: "/portal/samenwerking", label: "Samenwerking & Afspraken", icon: Handshake },
];

/**
 * Mobiele tabbalk: precies vijf hoofdonderdelen. Planning bundelt opnames en
 * publicaties, Resultaten bundelt cijfers en maandanalyses. Al het andere staat
 * onder het menu rechtsboven.
 */
const MOBILE_TABS = [
  { href: "/portal", label: "Home", icon: Home, match: ["/portal"] },
  { href: "/portal/videos", label: "Video's", icon: Video, match: ["/portal/videos"] },
  { href: "/portal/scripts", label: "Scripts", icon: FileText, match: ["/portal/scripts"] },
  { href: "/portal/planning", label: "Planning", icon: CalendarRange, match: ["/portal/planning", "/portal/content", "/portal/agenda"] },
  { href: "/portal/resultaten", label: "Resultaten", icon: BarChart3, match: ["/portal/resultaten", "/portal/analyses"] },
] as const;

/** Het aparte menu (mobiel): instellingen en minder gebruikte onderdelen. */
const MENU_ITEMS = [
  { href: "/portal/meldingen", label: "Meldingen", icon: Bell },
  ...(PORTAL_CONTENTGEHEUGEN_LIVE ? [{ href: "/portal/contentgeheugen", label: "Contentgeheugen", icon: BrainCircuit }] : []),
  { href: "/portal/mijlpalen", label: "Onze mijlpalen", icon: Trophy },
  { href: "/portal/werkwijze", label: "Zo werken wij", icon: Repeat },
  { href: "/portal/samenwerking", label: "Samenwerking & afspraken", icon: Handshake },
  { href: "/portal/contact", label: "Contact", icon: MessageCircle },
  { href: "/portal/account", label: "Mijn account en meldingen", icon: UserRound },
  { href: "/portal/app", label: "Zet Shortclips op je beginscherm", icon: Smartphone },
];

export type NavCounts = { scripts: number; videos: number; unread?: number };

function countFor(href: string, c?: NavCounts): number {
  if (!c) return 0;
  if (href === "/portal/scripts") return c.scripts;
  if (href === "/portal/videos") return c.videos;
  if (href === "/portal/meldingen") return c.unread ?? 0;
  return 0;
}

/** Oranje teller: hier wacht iets op de klant. */
function ActionBadge({ n, onDark = false }: { n: number; onDark?: boolean }) {
  if (n <= 0) return null;
  return (
    <span className={`ml-auto grid min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold leading-5 ${onDark ? "bg-white/20 text-current" : "bg-[var(--sc-act)] text-[var(--sc-act-ink)]"}`} aria-label={`${n} wacht op jou`}>
      {n}
    </span>
  );
}

function matches(pathname: string, href: string) {
  return href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);
}

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => matches(pathname, href);
}

const ACTIVE_SIDEBAR = "bg-[var(--sc-cta)] text-[var(--sc-cta-ink)] shadow-[var(--shadow-card)]";

/** Verticale navigatie voor desktop (in de zijbalk). */
export function PortalNav({ counts }: { counts?: NavCounts }) {
  const isActive = useIsActive();
  return (
    <nav aria-label="Portaalnavigatie" className="hidden lg:flex lg:flex-col lg:gap-0.5">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? ACTIVE_SIDEBAR : "text-[var(--color-ink-muted)] hover:bg-[var(--sc-fill)] hover:text-[var(--color-ink)]",
            ].join(" ")}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{label}</span>
            <ActionBadge n={countFor(href, counts)} onDark={active} />
          </Link>
        );
      })}
    </nav>
  );
}

/** Bottom-tab-bar voor mobiel: vijf vaste tabs, met tellers voor wat op de klant wacht. */
export function PortalMobileNav({ counts }: { counts?: NavCounts }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Portaalnavigatie"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--sc-line)] bg-[var(--sc-header-bg)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <div className="mx-auto flex max-w-[640px] items-stretch justify-around px-1">
        {MOBILE_TABS.map(({ href, label, icon: Icon, match }) => {
          const active = match.some((m) => matches(pathname, m));
          const n = countFor(href, counts);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors ${
                active ? "text-[var(--sc-accent)]" : "text-[var(--color-ink-muted)]"
              }`}
            >
              <span className="relative">
                <Icon className="size-[22px]" strokeWidth={active ? 2.1 : 1.75} />
                {n > 0 ? (
                  <span className="absolute -right-2.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--sc-act)] px-1 text-[10px] font-bold leading-4 text-[var(--sc-act-ink)]" aria-label={`${n} wacht op jou`}>
                    {n}
                  </span>
                ) : null}
              </span>
              <span className="leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Menuknop rechtsboven op mobiel. Opent een vel met de overige onderdelen,
 * instellingen en de installatiehandleiding.
 */
export function PortalMenuButton({ counts }: { counts?: NavCounts }) {
  const pathname = usePathname();
  // Open per pad: navigeren sluit het menu vanzelf.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);

  // Blokkeer scrollen van de pagina eronder zolang het menu open is.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = counts?.unread ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label={unread > 0 ? `Menu, ${unread} nieuwe meldingen` : "Menu"}
        className="relative inline-flex size-10 items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--sc-fill)] hover:text-[var(--color-ink)] lg:hidden"
      >
        <Menu className="size-5" strokeWidth={1.9} />
        {unread > 0 ? <span className="absolute right-2 top-2 size-2 rounded-full bg-[var(--color-bad)]" /> : null}
      </button>

      {/* Via een portal naar <body>: de header heeft backdrop-blur, waardoor een
          vast element erbinnen anders aan de header vastzit i.p.v. aan het scherm. */}
      {open ? createPortal(
        <div className="portal-studio fixed inset-0 z-40 !min-h-0 !bg-transparent lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Sluiten" className="absolute inset-0 bg-black/55" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-[var(--sc-line)] bg-[var(--color-surface)] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--color-ink)]">Menu</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Sluiten" className="inline-flex size-10 items-center justify-center rounded-full">
                <X className="size-5 text-[var(--color-ink-muted)]" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {MENU_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = matches(pathname, href);
                const n = countFor(href, counts);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                      active ? ACTIVE_SIDEBAR : "text-[var(--color-ink)] hover:bg-[var(--sc-fill)]"
                    }`}
                  >
                    <Icon className="size-5 shrink-0" strokeWidth={1.75} />
                    {label}
                    <ActionBadge n={n} onDark={active} />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      , document.body) : null}
    </>
  );
}

function Segments({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="mb-5 flex gap-1 rounded-xl bg-[var(--sc-fill)] p-1 lg:hidden">
      {items.map(({ href, label, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition-colors ${
            active ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm" : "text-[var(--color-ink-muted)]"
          }`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

/** Mobiel: wisselen binnen een tab (Planning en Resultaten bundelen twee pagina's). */
export function PortalSectionSwitch() {
  const pathname = usePathname();
  const onPlanning = pathname.startsWith("/portal/planning");
  const onContent = pathname.startsWith("/portal/content");
  if (onPlanning || onContent) {
    return (
      <Segments
        items={[
          { href: "/portal/planning", label: "Opnames", active: onPlanning },
          { href: "/portal/content", label: "Publicaties", active: onContent },
        ]}
      />
    );
  }
  const onResults = pathname === "/portal/resultaten";
  const onAnalyses = pathname === "/portal/analyses";
  if (onResults || onAnalyses) {
    return (
      <Segments
        items={[
          { href: "/portal/resultaten", label: "Cijfers", active: onResults },
          { href: "/portal/analyses", label: "Maandanalyses", active: onAnalyses },
        ]}
      />
    );
  }
  return null;
}
