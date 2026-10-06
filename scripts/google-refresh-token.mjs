#!/usr/bin/env node
/**
 * Eenmalig hulpmiddel: haal een Google refresh-token op voor ShortClips OS.
 *
 * De app wisselt dat refresh-token automatisch om voor kortlevende
 * access-tokens, en leest daarmee Google Agenda (opnamedagen, afspraken) én
 * Google Drive (documenten/rapportages). Je doet dit één keer.
 *
 * Gebruik:
 *   1. Zet GOOGLE_CLIENT_ID en GOOGLE_CLIENT_SECRET in .env.local
 *      (Client-ID heb je al; secret staat op hetzelfde scherm in de Google
 *      Cloud Console → API's en services → Inloggegevens → jouw OAuth-client).
 *   2. Voeg in diezelfde OAuth-client bij "Geautoriseerde omleidings-URI's"
 *      toe:  http://localhost:5858/callback
 *   3. Draai:  node scripts/google-refresh-token.mjs
 *   4. Open de getoonde URL, kies het juiste Google-account, geef toestemming.
 *   5. Het script toont je refresh-token — zet die als GOOGLE_REFRESH_TOKEN in
 *      .env.local en herstart de dev-server.
 *
 * Scopes: calendar.readonly + drive.readonly (alleen lezen).
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const PORT = Number(process.env.OAUTH_PORT ?? 5858);
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");

/** Leest een sleutel uit process.env of uit .env.local. */
function readEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const line = text.split("\n").find((l) => l.startsWith(`${key}=`));
    if (line) return line.slice(key.length + 1).trim();
  } catch {
    /* .env.local hoeft niet te bestaan */
  }
  return undefined;
}

const clientId = readEnv("GOOGLE_CLIENT_ID");
const clientSecret = readEnv("GOOGLE_CLIENT_SECRET");

if (!clientId || !clientSecret) {
  console.error(
    "\n✗ GOOGLE_CLIENT_ID en/of GOOGLE_CLIENT_SECRET ontbreken.\n" +
      "  Zet beide in .env.local en draai dit script opnieuw.\n",
  );
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end("Niet gevonden");
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>Mislukt</h1><p>${error ?? "geen code ontvangen"}</p>`);
    console.error(`\n✗ Toestemming mislukt: ${error ?? "geen code"}\n`);
    server.close();
    process.exit(1);
  }

  try {
    const token = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }),
    }).then((r) => r.json());

    if (!token.refresh_token) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Geen refresh-token ontvangen</h1><p>Zie de terminal.</p>");
      console.error(
        "\n✗ Geen refresh_token terug. Meestal omdat je eerder al toestemming gaf.\n" +
          "  Ga naar https://myaccount.google.com/permissions, verwijder de toegang\n" +
          "  van deze app, en draai het script opnieuw (prompt=consent staat al aan).\n" +
          "  Antwoord van Google:\n" +
          JSON.stringify(token, null, 2) +
          "\n",
      );
      server.close();
      process.exit(1);
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>Gelukt ✅</h1><p>Je kunt dit tabblad sluiten en terug naar de terminal.</p>",
    );

    console.log("\n✓ Refresh-token opgehaald. Zet deze regel in .env.local:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${token.refresh_token}\n`);
    console.log("Herstart daarna de dev-server en klik op 'Verbinding testen'.\n");
    server.close();
    process.exit(0);
  } catch (e) {
    res.writeHead(500).end("Serverfout — zie terminal.");
    console.error("\n✗ Token-uitwisseling mislukt:", e, "\n");
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(
    `\nShortClips OS — Google refresh-token ophalen\n` +
      `\nOpen deze URL in je browser (kies het juiste Google-account):\n\n${authUrl.toString()}\n` +
      `\nWachten op toestemming via ${REDIRECT} ...\n`,
  );
});
