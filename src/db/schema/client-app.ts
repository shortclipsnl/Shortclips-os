import { index, integer, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./_shared";
import { users } from "./identity";
import { clients } from "./clients";
import { notifications } from "./ops";

/* ------------------------------------------------------------------ *
 * Klant-app (PWA): pushmeldingen, inlogcodes en vertrouwde apparaten
 * ------------------------------------------------------------------ */

/**
 * Eén rij per apparaat dat pushmeldingen heeft aangezet. Hoort altijd bij
 * precies één (klant)gebruiker; bij uitloggen, deactiveren of een gepauzeerde
 * klant wordt de rij ingetrokken.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    /** Het adres van de pushdienst (Apple, Google, Mozilla). Uniek per apparaat. */
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    /** 'ios' | 'android' | 'desktop' — alleen voor het overzicht. */
    platform: varchar("platform", { length: 16 }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("push_subscriptions_endpoint_unique").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId, t.revokedAt),
    index("push_subscriptions_client_idx").on(t.clientId),
  ],
);

/**
 * Logboek: welke melding is aan welke pushdienst aangeboden, met statuscode.
 * 201 = aangenomen; 404/410 = abonnement bestaat niet meer (wordt opgeruimd).
 */
export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    id: pk(),
    notificationId: uuid("notification_id").references(() => notifications.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id").references(() => pushSubscriptions.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    /** 'sent' | 'failed' | 'expired' */
    status: varchar("status", { length: 16 }).notNull(),
    statusCode: integer("status_code"),
    title: varchar("title", { length: 240 }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("push_deliveries_client_idx").on(t.clientId, t.createdAt),
    index("push_deliveries_user_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * Lopende inlogpoging die nog een e-mailcode nodig heeft. De browser krijgt
 * alleen een willekeurig token (cookie); hier staan de hashes van token en code.
 */
export const loginChallenges = pgTable(
  "login_challenges",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("login_challenges_token_unique").on(t.tokenHash),
    index("login_challenges_user_idx").on(t.userId),
  ],
);

/**
 * Apparaten waarop een klant de inlogcode al heeft ingevoerd. Daar wordt de
 * code niet opnieuw gevraagd tot de vervaldatum.
 */
export const trustedDevices = pgTable(
  "trusted_devices",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("trusted_devices_token_unique").on(t.tokenHash),
    index("trusted_devices_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ *
 * Passkeys: inloggen met Face ID, Touch ID of de pincode van het toestel
 * ------------------------------------------------------------------ */

/**
 * Een passkey per apparaat (of per iCloud/Google-sleutelhanger). Shortclips
 * bewaart alleen de publieke sleutel; de geheime sleutel en de biometrie
 * verlaten het toestel nooit.
 */
export const passkeys = pgTable(
  "passkeys",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Credential-ID (base64url), uniek over alle gebruikers. */
    credentialId: text("credential_id").notNull(),
    /** Publieke sleutel (COSE, base64url). */
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    /** Kommagescheiden: internal, hybrid, usb, ... */
    transports: varchar("transports", { length: 120 }),
    /** "iPhone", "Android-telefoon", ... alleen voor het overzicht. */
    deviceName: varchar("device_name", { length: 80 }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("passkeys_credential_unique").on(t.credentialId),
    index("passkeys_user_idx").on(t.userId, t.revokedAt),
  ],
);

/**
 * Eenmalige WebAuthn-uitdagingen. Opgeslagen (als hash) zodat een oude
 * ondertekende uitdaging nooit opnieuw gebruikt kan worden.
 */
export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: pk(),
    /** Leeg bij inloggen (de passkey zegt zelf van wie hij is). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** 'register' | 'login' */
    purpose: varchar("purpose", { length: 16 }).notNull(),
    challenge: varchar("challenge", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webauthn_challenges_expires_idx").on(t.expiresAt)],
);
