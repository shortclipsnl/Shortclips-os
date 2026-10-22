import { requireInternal, isOwner } from "@/server/auth/context";
import { NAVIGATION } from "@/components/layout/nav-config";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { AssistantWidget } from "@/components/ai/assistant-widget";
import { NotificationPopper } from "@/components/notifications/notification-popper";
import { aiConfigured } from "@/server/ai/client";
import { getCelebrationContext } from "@/server/awards/service";
import { CelebrationGate } from "@/app/(app)/showcase/celebration-gate";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await requireInternal();

  // Navigatie tonen op basis van rechten: geen menu-items die tot een
  // foutmelding leiden.
  const owner = isOwner(viewer);
  // Een editor ziet alleen wat hij nodig heeft: Vandaag, Editing (zijn eigen
  // projecten) en Showcase (zijn awards). Onze klanten en Productieplanning niet.
  const editorOnly = viewer.primaryRole === "editor";
  const EDITOR_NAV = new Set(["/dashboard", "/videos", "/showcase"]);
  // Vieringskaart bij binnenkomst (alleen editors kunnen awards hebben).
  const celebration = editorOnly ? await getCelebrationContext(viewer.id) : null;
  const groups = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      // Editors: strikte allowlist — alles daarbuiten blijft verborgen.
      if (editorOnly && !EDITOR_NAV.has(item.href)) return false;
      // Eigenaar-only items: alleen voor Janno.
      if (item.ownerOnly && !owner) return false;
      // Rolgebaseerde zichtbaarheid (geen e-mailuitzonderingen): eigenaar ziet
      // alles, verder alleen de aangewezen rollen.
      if (item.roles && !owner && !(item.roles as string[]).includes(viewer.primaryRole)) {
        return false;
      }
      // Rechten-gebaseerde items.
      return (
        !item.permissions ||
        item.permissions.some((p) => viewer.permissions.has(p))
      );
    }),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-[var(--color-line)] bg-[var(--color-surface)] lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar groups={groups} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar viewer={viewer} />
        <main className="flex-1 px-5 py-6 lg:px-8">{children}</main>
      </div>

      {/* AI-assistent zwevend rechtsonder, voor wie 'm mag gebruiken. */}
      {viewer.permissions.has("ai:read") ? (
        <AssistantWidget firstName={viewer.fullName.split(" ")[0] ?? ""} aiReady={aiConfigured()} />
      ) : null}

      {/* Nieuwe meldingen poppen rechtsboven op met een geluidje — voor het hele
          team én editors, zodat ze opvallen. */}
      <NotificationPopper viewerId={viewer.id} />

      {/* Award-viering bij binnenkomst (eenmalig, tot de editor opent). */}
      <CelebrationGate context={celebration} />
    </div>
  );
}
