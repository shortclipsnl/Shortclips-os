import { requireInternal } from "@/server/auth/context";
import { NAVIGATION } from "@/components/layout/nav-config";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await requireInternal();

  // Navigatie tonen op basis van rechten: geen menu-items die tot een
  // foutmelding leiden.
  const groups = NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        !item.permissions ||
        item.permissions.some((p) => viewer.permissions.has(p)),
    ),
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
    </div>
  );
}
