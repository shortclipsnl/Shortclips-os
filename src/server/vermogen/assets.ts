import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Leest de losse dashboardbestanden uit `data/vermogen/`. Die staan bewust niet
 * in `public/` (dan zou iedereen erbij kunnen); ze worden alleen uitgeleverd na
 * de eigenaarscontrole in de route-handler. In productie worden ze meegebundeld
 * via `outputFileTracingIncludes` in next.config.
 */
const DIR = path.join(process.cwd(), "data", "vermogen");
const cache = new Map<string, string>();

function read(file: string): string {
  const hit = cache.get(file);
  if (hit !== undefined) return hit;
  const content = fs.readFileSync(path.join(DIR, file), "utf8");
  cache.set(file, content);
  return content;
}

export function vermogenDashboardHtml(): string {
  return read("vermogen_dashboard.html");
}

export function vermogenShimJs(): string {
  return read("vermogen-db-shim.js");
}
