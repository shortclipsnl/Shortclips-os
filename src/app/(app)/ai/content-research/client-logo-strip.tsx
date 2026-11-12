import Link from "next/link";
import { ClientLogo } from "@/components/ui";

export type StripClient = { id: string; name: string; logoUrl: string | null; color: string | null; newIdeas: number };

/**
 * Horizontale balk met de logo's van alle actieve klanten: één klik en je zit bij
 * de ideeën van die klant, zonder te scrollen.
 */
export function ClientLogoStrip({ clients, activeId }: { clients: StripClient[]; activeId?: string }) {
  if (clients.length === 0) return null;
  return (
    <nav aria-label="Klanten" className="sc-card mb-5 overflow-x-auto">
      <ul className="flex min-w-max gap-1 p-2">
        {clients.map((c) => {
          const active = c.id === activeId;
          return (
            <li key={c.id}>
              <Link
                href={`/ai/content-research/${c.id}?tab=ideeen`}
                aria-current={active ? "page" : undefined}
                title={c.name}
                className={`flex w-[84px] flex-col items-center gap-1.5 rounded-lg px-1.5 py-2 text-center transition-colors ${active ? "bg-[var(--color-indigo-ink)] text-white" : "text-[var(--color-ink)] hover:bg-[var(--color-surface-sunken)]"}`}
              >
                <span className="relative rounded-lg bg-white">
                  <ClientLogo name={c.name} logoUrl={c.logoUrl} color={c.color} size={44} />
                  {c.newIdeas > 0 ? (
                    <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-[var(--color-indigo-ink)] px-1 text-2xs font-semibold text-white ring-2 ring-white">{c.newIdeas}</span>
                  ) : null}
                </span>
                <span className="line-clamp-2 text-2xs font-medium leading-tight">{c.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
