import type { MetadataRoute } from "next";

/**
 * Web app manifest: maakt het klantportaal installeerbaar als "Shortclips" app
 * op iPhone en Android. De app start altijd in het klantportaal; interne
 * gebruikers die hem toch installeren, worden door requirePortal() naar het
 * dashboard gestuurd. Rechten blijven server-side afgedwongen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/portal",
    name: "Shortclips",
    short_name: "Shortclips",
    description: "Je scripts, video's, planning en resultaten van Shortclips op één plek.",
    lang: "nl",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#00003B",
    theme_color: "#00003B",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Video's", url: "/portal/videos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Scripts", url: "/portal/scripts", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Meldingen", url: "/portal/meldingen", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
