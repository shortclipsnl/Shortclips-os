import "server-only";
import type { Browser } from "puppeteer-core";

/**
 * HTML → PDF met een headless Chromium.
 * - Lokaal/zelf-gehost: systeem-Chrome (geen zware download). Pad via CHROME_PATH
 *   of het standaard macOS/Linux-pad.
 * - Vercel/Lambda: @sparticuz/chromium levert de Linux-binary.
 * Mislukt het starten van de browser, dan gooien we een duidelijke fout zodat de
 * route een eerlijke 503 kan teruggeven in plaats van stilletjes te falen.
 */

const DEFAULT_CHROME: Record<string, string> = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "/usr/bin/google-chrome",
};

function onServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION);
}

async function launch(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (onServerless()) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const executablePath = process.env.CHROME_PATH || DEFAULT_CHROME[process.platform];
  if (!executablePath) {
    throw new Error(`Geen Chrome gevonden voor platform ${process.platform}. Zet CHROME_PATH.`);
  }
  return puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
}

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    // Interne fetches zijn al gedaan; we voeden kant-en-klare HTML.
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("print");
    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      preferCSSPageSize: true, // respecteert @page size/margin uit de rapport-HTML
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
