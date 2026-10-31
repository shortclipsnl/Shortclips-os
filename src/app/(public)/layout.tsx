/**
 * Publieke route-groep: pagina's die zonder login bereikbaar zijn via een
 * onvoorspelbaar token (offertes voor klanten). Geen interne schil/navigatie —
 * alleen de content, licht thema, Shortclips-huisstijl. Noindex staat al globaal
 * aan via de root-layout.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#eef1f6]">{children}</div>;
}
