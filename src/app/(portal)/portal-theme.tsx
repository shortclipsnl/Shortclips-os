"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/**
 * Dag/nacht-schakelaar voor het klantportaal. Eigen voorkeur (standaard donker,
 * de ShortClips-huisstijl), los van de interne app. De keuze staat in
 * localStorage en op <html data-portal-theme>; een klein script in de layout zet
 * het juiste thema al vóór het renderen, zodat er geen flits is.
 */
export function PortalThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-portal-theme");
    setTheme(attr === "light" ? "light" : "dark");
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-portal-theme", next);
    try {
      localStorage.setItem("sc-portal-theme", next);
    } catch {
      /* opslag niet beschikbaar — negeren */
    }
  }

  const light = mounted && theme === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Donkere weergave aanzetten" : "Lichte weergave aanzetten"}
      title={light ? "Donkere weergave" : "Lichte weergave"}
      className="grid size-9 place-items-center rounded-full text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--sc-fill-strong)] hover:text-[var(--color-ink)]"
    >
      {light ? <Moon className="size-[18px]" strokeWidth={1.75} /> : <Sun className="size-[18px]" strokeWidth={1.75} />}
    </button>
  );
}

/** Inline script dat het bewaarde portaalthema vóór het renderen toepast. */
export const PORTAL_THEME_INIT = `(function(){try{var t=localStorage.getItem('sc-portal-theme');document.documentElement.setAttribute('data-portal-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-portal-theme','dark');}})();`;
