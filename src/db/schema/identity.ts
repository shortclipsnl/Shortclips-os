import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { userRoleEnum, userStatusEnum } from "./enums";

/* ------------------------------------------------------------------ *
 * Gebruikers & sessies
 * ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: pk(),
    email: varchar("email", { length: 320 }).notNull(),
    /** scrypt-hash, formaat: scrypt$N$r$p$salt$hash — nooit plaintext. */
    passwordHash: text("password_hash"),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    avatarUrl: text("avatar_url"),
    phone: varchar("phone", { length: 40 }),
    status: userStatusEnum("status").notNull().default("invited"),
    /** Hoofdrol. Fijnmazige rechten lopen via user_roles → role_permissions. */
    primaryRole: userRoleEnum("primary_role").notNull().default("editor"),
    /** Of dit een vaste medewerker is (true) of freelancer (false) — voor het
     *  team-overzicht. */
    isStaff: boolean("is_staff").notNull().default(true),
    /** Totaal aantal vakantieuren per jaar (contract), bijv. 128 (jaar) of 75
     *  (7-maanden). Basis voor het vakantiesaldo. */
    leaveHoursTotal: integer("leave_hours_total").notNull().default(128),
    /**
     * Alleen gevuld voor portal-gebruikers (rol `client`). Dwingt af dat een
     * klantaccount nooit buiten de eigen klant kan kijken.
     */
    clientId: uuid("client_id"),
    locale: varchar("locale", { length: 8 }).notNull().default("nl"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    /** Vrije notitie over beschikbaarheid: welke dagen/tijden iemand niet
     *  beschikbaar is. Door de persoon zelf in te vullen op Vandaag, zodat het
     *  team er rekening mee kan houden. */
    availabilityNote: text("availability_note"),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("users_email_unique").on(t.email),
    index("users_client_idx").on(t.clientId),
    index("users_role_idx").on(t.primaryRole),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    /** SHA-256 van het cookie-token; het token zelf staat nooit in de db. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("sessions_token_unique").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expiry_idx").on(t.expiresAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Portaal-uitnodigingen & wachtwoordherstel (beveiligde tokens)
 * ------------------------------------------------------------------ */

/**
 * Eenmalige tokens voor het klantportaal: een uitnodiging (klant stelt zelf een
 * wachtwoord in) of een wachtwoordherstel. Net als bij sessies bewaren we alléén
 * de SHA-256 van het token; het token zelf staat uitsluitend in de link die per
 * mail wordt verstuurd. Een token verloopt en kan maar één keer gebruikt worden.
 */
export const portalInvites = pgTable(
  "portal_invites",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 van het token; het token zelf staat nooit in de db. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    /** "invite" = account activeren, "reset" = wachtwoord herstellen. */
    purpose: varchar("purpose", { length: 16 }).notNull().default("invite"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** Welk teamlid de uitnodiging/reset aanmaakte (voor de audit). */
    createdByUserId: uuid("created_by_user_id"),
    ...timestamps,
  },
  (t) => [
    unique("portal_invites_token_unique").on(t.tokenHash),
    index("portal_invites_user_idx").on(t.userId),
    index("portal_invites_expiry_idx").on(t.expiresAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Rollen & permissies (flexibel: extra rollen zonder migratie)
 * ------------------------------------------------------------------ */

export const roles = pgTable(
  "roles",
  {
    id: pk(),
    key: varchar("key", { length: 64 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    /** Systeemrollen kunnen niet verwijderd worden. */
    isSystem: boolean("is_system").notNull().default(false),
    /** Rollen die alleen het klantportaal zien. */
    isPortalRole: boolean("is_portal_role").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [unique("roles_key_unique").on(t.key)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: pk(),
    /** Formaat: `resource:action`, bijv. `finance:read`. */
    key: varchar("key", { length: 96 }).notNull(),
    resource: varchar("resource", { length: 48 }).notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => [
    unique("permissions_key_unique").on(t.key),
    index("permissions_resource_idx").on(t.resource),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: pk(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    unique("role_permissions_unique").on(t.roleId, t.permissionId),
    index("role_permissions_role_idx").on(t.roleId),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    unique("user_roles_unique").on(t.userId, t.roleId),
    index("user_roles_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ *
 * Teamleden (capaciteit & planning)
 * ------------------------------------------------------------------ */

export const teamMembers = pgTable(
  "team_members",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobTitle: varchar("job_title", { length: 120 }),
    /** Uren per week beschikbaar — basis voor capaciteitswaarschuwingen. */
    weeklyCapacityHours: integer("weekly_capacity_hours").notNull().default(40),
    /** Hoeveel video's deze persoon per week comfortabel edit. */
    weeklyVideoCapacity: integer("weekly_video_capacity").notNull().default(0),
    isInternal: boolean("is_internal").notNull().default(true),
    startedAt: timestamp("started_at", { withTimezone: true }),
    color: varchar("color", { length: 9 }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [unique("team_members_user_unique").on(t.userId)],
);

export const timeOff = pgTable(
  "time_off",
  {
    id: pk(),
    teamMemberId: uuid("team_member_id")
      .notNull()
      .references(() => teamMembers.id, { onDelete: "cascade" }),
    startsOn: timestamp("starts_on", { withTimezone: true }).notNull(),
    endsOn: timestamp("ends_on", { withTimezone: true }).notNull(),
    reason: varchar("reason", { length: 160 }),
    ...timestamps,
  },
  (t) => [index("time_off_member_idx").on(t.teamMemberId, t.startsOn)],
);

/* ------------------------------------------------------------------ *
 * Relaties
 * ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  roles: many(userRoles),
  teamMember: one(teamMembers, {
    fields: [users.id],
    references: [teamMembers.userId],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  users: many(userRoles),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one, many }) => ({
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
  timeOff: many(timeOff),
}));
