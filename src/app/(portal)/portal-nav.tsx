"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  FileBarChart,
  FileText,
  Handshake,
  LayoutDashboard,
  MoreHorizontal,
  Video,
  X,
} from "lucide-react";

const ITEMS = [
  { href: "/portal", label: "Overzicht", short: "Overzicht", icon: LayoutDashboard },
  { href: "/portal/videos", label: "Video's", short: "Video's", icon: Video },
  { href: "/portal/scripts", label: "Scripts", short: "Scripts", icon: FileText },
  { href: "/portal/content", label: "Contentplanning", short: "Planning", icon: CalendarDays },
  { href: "/portal/planning", label: "Opnameplanning", short: "Opnames", icon: CalendarRange },
  { href: "/portal/resultaten", label: "Resultaten", short: "Resultaten", icon: BarChart3 },
  { href: "/portal/analyses", label: "Maandanalyses", short: "Analyses", icon: FileBarChart },
  { href: "/portal/samenwerking", label: "Samenwerking & Afspraken", short: "Afspraken", icon: Handshake },
];

/** De vaste tabs onderin op mobiel; de rest zit onder "Meer". */
const PRIMARY = ["/portal", "/portal/videos", "/portal/scripts", "/portal/resultaten"];

export type NavCounts = { scripts: number; videos: number };
function countFor(href: string, c?: NavCounts): number {
  if (!c) return 0;
  if (href === "/portal/scripts") return c.scripts;
  if (href === "/portal/videos") return c.videos;
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

function useIsActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);
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

/** Bottom-tab-bar voor mobiel: vier vaste tabs + een "Meer"-vel. */
export function PortalMobileNav({ counts }: { counts?: NavCounts }) {
  const isActive = useIsActive();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = PRIMARY.map((h) => ITEMS.find((i) => i.href === h)!);
  const overflow = ITEMS.filter((i) => !PRIMARY.includes(i.href));
  const overflowActive = overflow.some((i) => isActive(i.href));

  return (
    <>
      <nav
        aria-label="Portaalnavigatie"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--sc-line)] bg-[var(--sc-header-bg)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="mx-auto flex max-w-[1240px] items-stretch justify-around px-1">
          {primary.map(({ href, short: label, icon: Icon }) => {
            const active = isActive(href);
            const n = countFor(href, counts);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  active ? "text-[var(--sc-accent)]" : "text-[var(--color-ink-muted)]"
                }`}
              >
                <span className="relative">
                  <Icon className="size-[22px]" strokeWidth={active ? 2.1 : 1.75} />
                  {n > 0 ? <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-[var(--sc-act)] px-1 text-[10px] font-bold leading-4 text-[var(--sc-act-ink)]">{n}</span> : null}
                </span>
                <span className="leading-none">{label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
              overflowActive ? "text-[var(--sc-accent)]" : "text-[var(--color-ink-muted)]"
            }`}
          >
            <MoreHorizontal className="size-[22px]" strokeWidth={1.9} />
            <span className="leading-none">Meer</span>
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Meer navigatie">
          <button
            type="button"
            aria-label="Sluiten"
            className="absolute inset-0 bg-black/55"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-[var(--sc-line)] bg-[var(--color-surface)] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--color-ink)]">Meer</span>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="Sluiten">
                <X className="size-5 text-[var(--color-ink-muted)]" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {overflow.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                      active ? ACTIVE_SIDEBAR : "text-[var(--color-ink)] hover:bg-[var(--sc-fill)]"
                    }`}
                  >
                    <Icon className="size-5 shrink-0" strokeWidth={1.75} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
