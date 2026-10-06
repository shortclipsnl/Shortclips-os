#!/usr/bin/env node
/**
 * Eenmalig hulpmiddel: haal een Frame.io (Adobe IMS) refresh-token op via de
 * OAuth Web App-flow. De app vernieuwt daarmee zelf access-tokens.
 *
 * Gebruik:
 *   1. Zet FRAMEIO_CLIENT_ID en FRAMEIO_CLIENT_SECRET in .env.local
 *      (uit developer.adobe.com/console → je project → Frame.io → OAuth Web App).
 *      Zorg dat daar de redirect-URI https://localhost:5859/callback staat.
 *   2. Stap 1 — draai zonder argument:  node scripts/frameio-token.mjs
 *      → open de getoonde URL, log in met Adobe, geef toestemming.
 *      De browser springt daarna naar https://localhost:5859/callback?... en
 *      toont waarschijnlijk een foutpagina ("kan geen verbinding maken"). Dat is
 *      prima — kopieer de VOLLEDIGE URL uit de adresbalk.
 *   3. Stap 2 — draai met die URL (of alleen de code) ertussen aanhalingstekens:
 *        node scripts/frameio-token.mjs "https://localhost:5859/callback?code=...&state=..."
 *      → het script toont je refresh-token. Zet die als FRAMEIO_REFRESH_TOKEN in
 *      .env.local en herstart de dev-server.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const REDIRECT = "https://localhost:5859/callback";
const SCOPES = "openid,AdobeID,offline_access,additional_info.roles";
const TOKEN_URL =
  readEnv("FRAMEIO_IMS_URL") ?? "https://ims-na1.adobelogin.com/ims/token/v3";
const AUTH_URL = TOKEN_URL.replace("/token/v3", "/authorize/v2");

function readEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const line = text.split("\n").find((l) => l.startsWith(`${key}=`));
    if (line) return line.slice(key.length + 1).trim();
  } catch {
    /* geen .env.local */
  }
  return undefined;
}

const clientId = readEnv("FRAMEIO_CLIENT_ID");
const clientSecret = readEnv("FRAMEIO_CLIENT_SECRET");
if (!clientId || !clientSecret) {
  console.error("\n✗ FRAMEIO_CLIENT_ID en/of FRAMEIO_CLIENT_SECRET ontbreken in .env.local.\n");
  process.exit(1);
}

const input = process.argv[2];

if (!input) {
  // Stap 1: toon de autorisatie-URL.
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", Math.random().toString(36).slice(2));
  console.log(
    "\nFrame.io — stap 1: open deze URL, log in met Adobe en geef toestemming:\n\n" +
      url.toString() +
      "\n\nDaarna springt de browser naar https://localhost:5859/callback?... (foutpagina = normaal).\n" +
      "Kopieer de VOLLEDIGE URL uit de adresbalk en draai:\n" +
      '  node scripts/frameio-token.mjs "<geplakte-url>"\n',
  );
  process.exit(0);
}

// Stap 2: haal de code uit de input (volledige URL of kale code) en wissel om.
let code = input.trim();
try {
  if (code.includes("://") || code.includes("code=")) {
    const u = new URL(code.includes("://") ? code : `https://x/?${code}`);
    code = u.searchParams.get("code") ?? code;
  }
} catch {
  /* gebruik input as-is */
}

const body = new URLSearchParams({
  grant_type: "authorization_code",
  client_id: clientId,
  client_secret: clientSecret,
  code,
  redirect_uri: REDIRECT,
});

const res = await fetch(TOKEN_URL, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});
const data = await res.json().catch(() => ({}));

if (!res.ok || !data.refresh_token) {
  console.error(
    `\n✗ Token-uitwisseling mislukt (HTTP ${res.status}).\n` +
      "Antwoord van Adobe:\n" +
      JSON.stringify(data, null, 2) +
      "\n\nTips: de code is maar kort geldig (opnieuw stap 1 doen), en de redirect-URI\n" +
      "moet exact https://localhost:5859/callback zijn in de Adobe-credential.\n",
  );
  process.exit(1);
}

console.log("\n✓ Gelukt. Zet deze regel in .env.local en herstart de dev-server:\n");
console.log(`FRAMEIO_REFRESH_TOKEN=${data.refresh_token}\n`);
