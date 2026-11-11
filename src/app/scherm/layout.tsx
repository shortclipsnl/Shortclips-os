import type { Metadata } from "next";

export const metadata: Metadata = { title: "Kantoorscherm · ShortClips" };

/** Minimale, schermvullende layout voor het kantoorscherm — zonder de
 *  navigatiebalk, in de Shortclips-huisstijl (navy). */
export default function ScreenLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        background: "radial-gradient(120% 90% at 30% 20%, #0b0b5c 0%, #00003b 55%, #000026 100%)",
        color: "#fff",
      }}
    >
      {children}
    </div>
  );
}
