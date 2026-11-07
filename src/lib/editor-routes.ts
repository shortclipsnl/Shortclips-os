/**
 * Welke pagina's mag een (freelance) editor openen? Strikte allowlist: alleen
 * zijn eigen werk, zijn klantenbibliotheek en wat hij nodig heeft om te editen.
 * Alles daarbuiten (klantenbeheer, opnameplanning, team, financiën …) is voor
 * Team Shortclips. Wordt server-side afgedwongen in de (app)-layout.
 */
const EDITOR_PREFIXES = [
  "/dashboard",
  "/videos", // eigen editingprojecten (detail checkt of het project van hem is)
  "/showcase",
  "/mijn-klanten",
  "/scripts/", // alleen-lezen scriptpagina via het eigen project
  "/notifications",
  "/account",
  "/transfer", // ruwe beelden en projectbestanden versturen
];

export function editorMayOpenPath(pathname: string): boolean {
  const p = pathname.split("?")[0]!.replace(/\/+$/, "") || "/";
  return EDITOR_PREFIXES.some((pre) => {
    // "/scripts/" = alleen een detailpagina, niet het overzicht van alle scripts.
    if (pre.endsWith("/")) return p.startsWith(pre) && p.length > pre.length;
    return p === pre || p.startsWith(pre + "/");
  });
}
