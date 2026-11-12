import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireInternal, isOwner, isEditorRole, canManageClients, canAccessLeads, canManageQuotes, canManageOperations } from "@/server/auth/context";
import { editorMayOpenPath } from "@/lib/editor-routes";
import { NAVIGATION } from "@/components/layout/nav-config";
import { heeftVerantwoordelijkhedenPagina } from "@/lib/verantwoordelijkheden/data";
import { Sidebar } from "@/components/layout/sidebar";
import { SectionTabs } from "@/components/layout/section-tabs";
import { Topbar } from "@/components/layout/topbar";
import { AssistantWidget } from "@/components/ai/assistant-widget";
import { NotificationPopper } from "@/components/notifications/notification-popper";
import { EndOfDayChecklist } from "./end-of-day-checklist";
import { aiConfigured } from "@/server/ai/client";
import { getCelebrationContext } from "@/server/awards/service";
import { CelebrationGate } from "@/app/(app)/showcase/celebration-gate";
import { birthdaysToday } from "@/server/birthdays";
import { BirthdayBanner } from "@/app/(app)/birthday-banner";

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
  const editorOnly = isEditorRole(viewer);
  const EDITOR_NAV = new Set(["/dashboard", "/videos", "/showcase", "/mijn-klanten"]);
  // Technische afdwinging (niet alleen het menu verbergen): een editor die een
  // andere URL intypt, komt terug op zijn eigen dashboard.
  if (editorOnly) {
    const path = (await headers()).get("x-sc-pathname") ?? "";
    if (path && !editorMayOpenPath(path)) redirect("/dashboard");
  }
  // Vieringskaart bij binnenkomst (alleen editors kunnen awards hebben).
  const celebration = editorOnly ? await getCelebrationContext(viewer.id) : null;
  const groups = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      // Uitsluitend voor editors (bijv. Showcase): ook de eigenaar/het team niet.
      if (item.editorsOnly && !editorOnly) return false;
      // Editors: strikte allowlist — alles daarbuiten blijft verborgen.
      if (editorOnly && !EDITOR_NAV.has(item.href)) return false;
      // Eigenaar-only items: alleen voor Janno.
      if (item.ownerOnly && !owner) return false;
      // Rolgebaseerde zichtbaarheid (geen e-mailuitzonderingen): eigenaar ziet
      // alles, verder alleen de aangewezen rollen.
      if (item.roles && !owner && !(item.roles as string[]).includes(viewer.primaryRole)) {
        return false;
      }
      // Klantenbeheer: zichtbaar voor iedereen die klanten mag beheren
      // (eigenaar, projectcoördinatoren én het kernteam — bijv. Milou).
      if (item.manageClients && !canManageClients(viewer)) {
        return false;
      }
      // Offertemodule: eigenaar + aangewezen teamleden (bijv. Milou).
      if (item.quotesAccess && !canManageQuotes(viewer)) {
        return false;
      }
      // Leads: eigenaar + Milou en Jiska (zij volgen leads op en zetten om naar klant).
      if (item.leadsAccess && !canAccessLeads(viewer)) {
        return false;
      }
      // Operationeel beheer (koppelingen, portaal-instellingen): eigenaar + de
      // operationeel beheerder (Milou), niet elke projectcoördinator.
      if (item.manageOperations && !canManageOperations(viewer)) {
        return false;
      }
      // Draaiboek: alleen voor de videograaf (Rutger, freelance videografen) en Jarno.
      // Milou en Jiska werken met draaiboeken vanuit Scripting (controle en versturen).
      if (item.videographerOnly && !owner && viewer.primaryRole !== "videographer" && (viewer.email ?? "").toLowerCase() !== "rutger@shortclips.nl") {
        return false;
      }
      // Mijn verantwoordelijkheden: alleen Milou, Jiska en Rutger (en Jarno als beheerder).
      if (item.verantwoordelijkhedenAccess && !owner && !heeftVerantwoordelijkhedenPagina(viewer.email)) {
        return false;
      }
      // Rechten-gebaseerde items.
      return (
        !item.permissions ||
        item.permissions.some((p) => viewer.permissions.has(p))
      );
    // Editors zien waar nodig een afwijkend label (bijv. "Editing Planning").
    }).map((item) => (editorOnly && item.editorLabel ? { ...item, label: item.editorLabel } : item)),
  })).filter((group) => group.items.length > 0);

  // Tabblad-items waarvan de hoofdpagina voor deze gebruiker niet zichtbaar is,
  // krijgen gewoon een eigen menu-item: zo blijft elke toegestane pagina vindbaar.
  const visibleHrefs = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
  for (const group of groups) {
    group.items = group.items.map((i) => (i.section && !visibleHrefs.has(i.section) ? { ...i, section: undefined } : i));
  }
  const sectionItems = groups.flatMap((g) => g.items);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-[var(--color-line)] bg-[var(--color-surface)] lg:block">
        <div className="sticky top-0 h-screen">
          <Sidebar groups={groups} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar viewer={viewer} />
        {/* Verjaardagssfeer: feestelijke balk + confetti op iemands verjaardag. */}
        <BirthdayBanner names={birthdaysToday().map((b) => b.firstName)} />
        <main className="flex-1 px-5 py-6 lg:px-8">
          <SectionTabs items={sectionItems} />
          {children}
        </main>
      </div>

      {/* AI-assistent zwevend rechtsonder, voor wie 'm mag gebruiken. */}
      {viewer.permissions.has("ai:read") && !editorOnly ? (
        <AssistantWidget firstName={viewer.fullName.split(" ")[0] ?? ""} aiReady={aiConfigured()} />
      ) : null}

      {/* Nieuwe meldingen poppen rechtsboven op met een geluidje — voor het hele
          team én editors, zodat ze opvallen. */}
      <NotificationPopper viewerId={viewer.id} />

      {/* Eindedagmelding: elke werkdag om 16:30 een afvinklijst rechtsonder. */}
      {/* Teamchecklist (scripting, posten …) is niet voor freelance editors. */}
      {editorOnly ? null : <EndOfDayChecklist />}

      {/* Award-viering bij binnenkomst (eenmalig, tot de editor opent). */}
      <CelebrationGate context={celebration} />
    </div>
  );
}
