"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LogOut, Settings, User } from "lucide-react";
import { logoutAction } from "@/server/auth/actions";

const ROLE_LABELS: Record<string, string> = {
  owner: "Eigenaar",
  admin: "Beheerder",
  project_coordinator: "Projectcoördinator",
  content_creator: "Content creator",
  videographer: "Videograaf",
  editor: "Editor",
  finance: "Finance",
  client: "Klant",
};

export function UserMenu({
  name,
  email,
  role,
  children,
}: {
  name: string;
  email: string;
  role: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full p-0.5 transition-shadow hover:shadow-[var(--shadow-card)]"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Accountmenu"
      >
        {children}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-pop)]"
        >
          <div className="border-b border-[var(--color-line)] px-4 py-3">
            <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
              {name}
            </p>
            <p className="truncate text-xs text-[var(--color-ink-muted)]">{email}</p>
            <p className="mt-1 text-2xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
              {ROLE_LABELS[role] ?? role}
            </p>
          </div>
          <div className="py-1">
            <Link
              href="/account"
              className="flex items-center gap-2.5 px-4 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"
              onClick={() => setOpen(false)}
            >
              <User className="size-4" strokeWidth={1.75} /> Mijn account
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-2.5 px-4 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"
              onClick={() => setOpen(false)}
            >
              <Settings className="size-4" strokeWidth={1.75} /> Instellingen
            </Link>
          </div>
          <form action={logoutAction} className="border-t border-[var(--color-line)]">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--color-bad)] hover:bg-[var(--color-bad-soft)]"
            >
              <LogOut className="size-4" strokeWidth={1.75} /> Uitloggen
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
