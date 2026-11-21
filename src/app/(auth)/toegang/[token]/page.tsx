import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Logo } from "@/components/logo";
import { ClientLogo } from "@/components/ui";
import { getViewer } from "@/server/auth/context";
import { peekAccessLink } from "@/server/auth/access-links";
import { destinationLabel, safePortalPath } from "@/lib/access-link";
import { redeemAccessLinkAction } from "../actions";

export const metadata: Metadata = {
  title: "Shortclips",
  // Linkvoorbeelden en zoekmachines: niets indexeren of volgen.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const viewport: Viewport = { themeColor: "#00003B", width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

/**
 * Persoonlijke inloglink. Openen logt nog niet in (zodat linkvoorbeelden van
 * WhatsApp de link niet verbruiken); één tik op de knop wel. Is de klant op dit
 * apparaat al ingelogd met hetzelfde account, dan gaat hij direct door.
 */
export default async function ToegangPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ naar?: string }>;
}) {
  const { token } = await params;
  const { naar } = await searchParams;
  const [info, viewer] = await Promise.all([peekAccessLink(token), getViewer()]);

  const requested = naar ? safePortalPath(naar) : null;
  const target = info.ok ? (requested && requested !== "/portal" ? requested : info.targetPath) : requested ?? "/portal";

  // Al ingelogd als deze klant: geen extra stap.
  if (info.ok && viewer && viewer.id === info.userId) redirect(target);

  const card = "rounded-[24px] border border-white/10 bg-white/[0.06] p-6 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)] backdrop-blur";

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#00003B] px-5 py-10 text-white">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center"><Logo size={40} onDark /></div>
        {info.ok ? (
          <div className={card}>
            <div className="flex items-center gap-3">
              <ClientLogo name={info.clientName ?? "Shortclips"} logoUrl={info.clientLogo} color={info.clientColor} size={48} />
              <div className="min-w-0">
                <p className="text-[13px] text-white/60">Persoonlijke link voor</p>
                <p className="truncate text-[17px] font-semibold">{info.clientName ?? info.userName}</p>
              </div>
            </div>
            <h1 className="mt-6 text-[22px] font-bold leading-tight">Open {destinationLabel(target)}</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-white/70">
              Je hoeft niet in te loggen. Tik op de knop en je bent er direct.
            </p>
            <form action={redeemAccessLinkAction} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="naar" value={target} />
              <button
                type="submit"
                className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] bg-[#1B5FE0] text-[16px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(27,95,224,0.9)] transition active:scale-[0.99]"
              >
                Doorgaan <ArrowRight className="size-5" />
              </button>
            </form>
            {viewer && viewer.id !== info.userId ? (
              <p className="mt-3 text-center text-[12px] text-white/55">Je bent nu ingelogd als {viewer.fullName || viewer.email}. Doorgaan logt je in als {info.userName}.</p>
            ) : null}
            <p className="mt-5 flex items-start gap-2 text-[12px] leading-relaxed text-white/50">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
              Deze link is alleen voor jou en een paar dagen geldig. Stuur hem niet door.
            </p>
          </div>
        ) : (
          <div className={card}>
            <h1 className="text-[20px] font-bold leading-tight">
              {info.reason === "expired" ? "Deze link is verlopen" : "Deze link werkt niet meer"}
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-white/70">
              {info.reason === "inactive"
                ? "Dit account is niet actief. Neem contact op met je contactpersoon bij Shortclips."
                : "Log in met je e-mailadres en wachtwoord, of met Face ID als je dat hebt ingesteld. Je komt daarna direct op de juiste pagina."}
            </p>
            {info.reason !== "inactive" ? (
              <Link
                href={`/login?verder=${encodeURIComponent(target)}`}
                className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-[16px] bg-[#1B5FE0] text-[16px] font-semibold text-white"
              >
                Inloggen <ArrowRight className="size-5" />
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}
