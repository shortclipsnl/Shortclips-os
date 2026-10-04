import type { Metadata } from "next";
import {
  asc,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  users,
} from "@/db/schema";
import { requirePermission } from "@/server/auth/context";
import { Avatar, Badge, Card, EmptyState, Table } from "@/components/ui";
import {
  relativeDays,
} from "@/lib/format";

export const metadata: Metadata = { title: "Gebruikers" };
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  owner: "Eigenaar",
  admin: "Beheerder",
  project_coordinator: "Projectcoördinator",
  content_creator: "Content creator",
  videographer: "Videograaf",
  editor: "Editor",
  finance: "Finance",
  client: "Klant (portaal)",
};

export default async function UsersPage() {
  await requirePermission("users:read");

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.primaryRole,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      clientName: clients.name,
      roleNames: sql<string>`(
        select string_agg(r.name, ', ') from user_roles ur
        join roles r on r.id = ur.role_id
        where ur.user_id = users.id
      )`,
      activeSessions: sql<number>`(
        select count(*) from sessions s
        where s.user_id = users.id and s.revoked_at is null and s.expires_at > now()
      )`,
    })
    .from(users)
    .leftJoin(clients, eq(clients.id, users.clientId))
    .where(isNull(users.deletedAt))
    .orderBy(asc(users.fullName));

  return (
    <Card padded={false}>
      {rows.length === 0 ? (
        <EmptyState title="Geen gebruikers" />
      ) : (
        <Table
          head={
            <>
              <th className="sc-th">Naam</th>
              <th className="sc-th">Hoofdrol</th>
              <th className="sc-th">Toegewezen rollen</th>
              <th className="sc-th">Klantomgeving</th>
              <th className="sc-th">Status</th>
              <th className="sc-th">Laatste login</th>
              <th className="sc-th text-right">Sessies</th>
            </>
          }
        >
          {rows.map((u) => (
            <tr key={u.id}>
              <td className="sc-td">
                <span className="flex items-center gap-2.5">
                  <Avatar name={u.fullName} size={26} />
                  <span>
                    <span className="block font-medium">{u.fullName}</span>
                    <span className="block text-xs text-[var(--color-ink-muted)]">{u.email}</span>
                  </span>
                </span>
              </td>
              <td className="sc-td text-[var(--color-ink-muted)]">
                {ROLE_LABELS[u.role] ?? u.role}
              </td>
              <td className="sc-td text-[var(--color-ink-muted)]">{u.roleNames ?? "—"}</td>
              <td className="sc-td text-[var(--color-ink-muted)]">{u.clientName ?? "—"}</td>
              <td className="sc-td">
                <Badge tone={u.status === "active" ? "good" : u.status === "invited" ? "info" : "bad"}>
                  {u.status === "active" ? "actief" : u.status === "invited" ? "uitgenodigd" : "geblokkeerd"}
                </Badge>
              </td>
              <td className="sc-td text-[var(--color-ink-muted)]">
                {u.lastLoginAt ? relativeDays(u.lastLoginAt) : "nooit"}
              </td>
              <td className="sc-td text-right tabular-nums">{Number(u.activeSessions)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
