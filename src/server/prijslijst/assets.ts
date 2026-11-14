import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Interne prijslijst 2027 (bron: Shortclips Prijslijst 2027, PDF).
 *
 * De pagina is een op zichzelf staand HTML-document in `data/prijslijst/`.
 * Het staat bewust niet in `public/` (dan zou iedereen de interne tarieven
 * kunnen openen); het wordt alleen uitgeleverd na de toegangscontrole in de
 * embed-route. Tarieven wijzigen: pas de centrale data bovenin het
 * <script>-blok van prijslijst-2027.html aan (DEPTS, PKG, EXTRAS, ...).
 */
const FILE = path.join(process.cwd(), "data", "prijslijst", "prijslijst-2027.html");
let cache: string | null = null;

export function prijslijstHtml(opts: { owner: boolean }): string {
  if (cache === null) cache = fs.readFileSync(FILE, "utf8");
  // De eigenaar ziet daarnaast de knop "Controlepunten" (open punten uit de PDF).
  return cache.replace("/*SC_OWNER*/", opts.owner ? "window.SC_OWNER=true;" : "");
}
