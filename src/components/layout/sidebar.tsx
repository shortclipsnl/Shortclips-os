"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/logo";
import type { NavGroup } from "./nav-config";

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>)[name];
  if (!Cmp) return null;
  return <Cmp className={className} strokeWidth={1.75} />;
}

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link href="/dashboard" className="px-2">
        <Logo size={30} />
      </Link>

      <div className="flex flex-1 flex-col gap-5">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-1.5 text-2xs font-semibold tracking-[0.1em] text-[var(--color-ink-faint)] uppercase">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.match
                  ? pathname === item.href || pathname.startsWith(`${item.match}/`)
                  : pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-[var(--color-indigo-ink)] text-white"
                          : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]",
                      )}
                    >
                      <Icon name={item.icon} className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
