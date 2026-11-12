/**
 * Bestand opslaan vanuit het portaal, ook in de geïnstalleerde app.
 *
 * In de app op de iPhone (zonder browserbalk) leidt een gewone link naar een
 * PDF naar een scherm zonder terugknop, en een nieuw venster deelt de inlog niet.
 * Daarom halen we het bestand op met de sessie van de app zelf en bieden het
 * aan via het deelmenu (Bewaar in Bestanden, AirDrop, Mail). Elders gewoon een
 * download.
 */
import { detectPlatform, isStandalone } from "@/lib/pwa-client";

export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type || "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (detectPlatform() === "ios" && isStandalone() && nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      /* val terug op een gewone download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Haalt een bestand op met de huidige sessie en slaat het op. */
export async function downloadFrom(href: string, fallbackName: string): Promise<void> {
  const res = await fetch(href, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) throw new Error(res.status === 503 ? "Het bestand kon niet worden gemaakt. Probeer het zo nog eens." : "Downloaden is niet gelukt.");
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const name = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="([^"]+)"/i.exec(cd)?.[1] ?? fallbackName;
  await saveBlob(blob, decodeURIComponent(name));
}

/**
 * Download van een externe, kortlevende link (bijv. een video uit Frame) via een
 * eigen route. In de iPhone-app openen we de link in een apart venster, anders
 * verlaat de klant de app zonder terugknop. Geeft true terug als dit is
 * afgehandeld; false = laat de gewone link zijn werk doen.
 */
export function openExternalDownloadInApp(route: string): boolean {
  if (!(detectPlatform() === "ios" && isStandalone())) return false;
  // Venster direct openen (binnen de klik), anders blokkeert iOS het.
  const win = window.open("about:blank", "_blank");
  fetch(`${route}${route.includes("?") ? "&" : "?"}format=json`, { cache: "no-store", credentials: "same-origin" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(({ url }: { url: string }) => {
      if (win) win.location.href = url;
      else window.location.href = url;
    })
    .catch(() => {
      win?.close();
      alert("Downloaden is niet gelukt. Probeer het zo nog eens.");
    });
  return true;
}
