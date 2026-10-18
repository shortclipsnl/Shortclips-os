"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/**
 * Licht/donker-schakelaar (rechtsboven). De keuze wordt bewaard in localStorage
 * en meteen op <html data-theme> gezet. Een klein script in de root-layout zet
 * het juiste thema al vóór het renderen, zodat er geen flits is.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme") as Theme | null;
    setTheme(attr === "dark" ? "dark" : "light");
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("sc-theme", next);
    } catch {
      /* opslag niet beschikbaar — negeren */
    }
  }

  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Licht thema aanzetten" : "Donker thema aanzetten"}
      title={dark ? "Licht thema" : "Donker thema"}
      className="rounded-[var(--radius-sm)] p-2 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-ink)]"
    >
      {/* Vóór hydratie tonen we een vaste maan, zodat server en client matchen. */}
      {mounted && dark ? <Sun className="size-5" strokeWidth={1.75} /> : <Moon className="size-5" strokeWidth={1.75} />}
    </button>
  );
}
