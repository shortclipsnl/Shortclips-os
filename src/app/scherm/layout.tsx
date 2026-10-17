import type { Metadata } from "next";

export const metadata: Metadata = { title: "Kantoorscherm · ShortClips" };

/** Minimale, schermvullende layout voor het kantoorscherm — zonder de
 *  navigatiebalk, in de Shortclips-huisstijl (navy). */
export default function ScreenLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg,#00003b 0%,#0a1f3d 60%,#071630 100%)",
        color: "#fff",
      }}
    >
      {children}
    </div>
  );
}
