import type { Metadata } from "next";
import {
  asc,
  eq,
} from "drizzle-orm";
import { db } from "@/db/client";
import { permissions, rolePermissions, roles } from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Badge, Card, CardHeader } from "@/components/ui";
import { PERMISSIONS } from "@/server/auth/permissions";

export const metadata: Metadata = { title: "Rollen en rechten" };
export const dynamic = "force-dynamic";

export default async function RolesPage() {
  await requirePermission("users:read");

  const [roleRows, links] = await Promise.all([
    db.select().from(roles).orderBy(asc(roles.sortOrder)),
    db
      .select({ roleId: rolePermissions.roleId, key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)),
  ]);

  const byRole = new Map<string, string[]>();
  for (const link of links) {
    const list = byRole.get(link.roleId) ?? [];
    list.push(link.key);
    byRole.set(link.roleId, list);
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-[var(--color-ink-muted)]">
          Rechten worden per rol toegekend. Een gebruiker kan meerdere rollen
          hebben; de rechten daarvan worden opgeteld. Klantrollen zien
          uitsluitend het portaal en nooit gegevens van andere klanten — dat is
          niet met rechten in te stellen, maar hard afgedwongen in de datalaag.
        </p>
      </Card>

      {roleRows.map((role) => {
        const perms = (byRole.get(role.id) ?? []).sort();
        return (
          <Card key={role.id}>
            <CardHeader
              title={role.name}
              subtitle={role.description}
              action={
                <span className="flex gap-2">
                  {role.isPortalRole ? <Badge tone="lime">portaal</Badge> : null}
                  {role.isSystem ? <Badge tone="neutral">systeemrol</Badge> : null}
                  <Badge tone="info">{perms.length} rechten</Badge>
                </span>
              }
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {perms.map((p) => (
                <span
                  key={p}
                  title={PERMISSIONS[p as keyof typeof PERMISSIONS] ?? p}
                  className="rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 font-mono text-2xs text-[var(--color-ink-muted)]"
                >
                  {p}
                </span>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
