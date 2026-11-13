/**
 * Welke pagina's mag een freelance videograaf openen? Strikte allowlist, net als
 * bij editors (lib/editor-routes). Alleen wat nodig is voor de eigen opnames:
 * draaiboek, opnameplanning (al gescoped op eigen klanten), scripts via de eigen
 * opname en de persoonlijke pagina's. Overzichten over álle klanten (editing,
 * capaciteit, contentplanning-planner, rapporten, kennisbank) horen bij
 * Team Shortclips.
 *
 * Geldt niet voor het kernteam (Rutger is videograaf maar kernteam) en niet voor
 * accounts met het recht "alle klanten zien". Uitbreiden = een pad toevoegen.
 */
const EXACT = ["/dashboard", "/draaiboek", "/productions", "/notifications", "/account", "/transfer", "/mijn-klanten"];
const PREFIXES = [
  "/draaiboek/", // eigen draaiboek (detail controleert klanttoegang)
  "/productions/", // eigen opname (detail controleert klanttoegang)
  "/scripts/", // alleen-lezen script via de eigen opname
  "/mijn-klanten/",
  "/transfer/",
];

export function videographerMayOpenPath(pathname: string): boolean {
  const p = pathname.split("?")[0]!.replace(/\/+$/, "") || "/";
  if (EXACT.includes(p)) return true;
  return PREFIXES.some((pre) => p.startsWith(pre) && p.length > pre.length);
}
