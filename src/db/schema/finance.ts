import { relations, sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { pk, softDelete, timestamps } from "./_shared";
import { invoiceStatusEnum } from "./enums";
import { clients } from "./clients";
import { users } from "./identity";

export const invoices = pgTable(
  "invoices",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    number: varchar("number", { length: 40 }).notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    issuedOn: date("issued_on"),
    dueOn: date("due_on"),
    /** Periode waar de factuur betrekking op heeft, YYYY-MM. */
    period: varchar("period", { length: 7 }),
    subtotal: numeric("subtotal", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    vatAmount: numeric("vat_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
    externalId: varchar("external_id", { length: 200 }),
    externalUrl: text("external_url"),
    notes: text("notes"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    unique("invoices_number_unique").on(t.number),
    index("invoices_client_idx").on(t.clientId, t.status),
    index("invoices_due_idx").on(t.dueOn, t.status),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: pk(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: varchar("description", { length: 240 }).notNull(),
    quantity: numeric("quantity", { precision: 10, scale: 2 })
      .notNull()
      .default("1"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    vatRate: numeric("vat_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0.21"),
    lineTotal: numeric("line_total", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("invoice_lines_invoice_idx").on(t.invoiceId)],
);

export const payments = pgTable(
  "payments",
  {
    id: pk(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paidOn: date("paid_on").notNull(),
    method: varchar("method", { length: 40 }),
    reference: varchar("reference", { length: 120 }),
    recordedById: uuid("recorded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index("payments_invoice_idx").on(t.invoiceId),
    index("payments_client_idx").on(t.clientId, t.paidOn),
  ],
);

/**
 * Maandelijkse omzet-snapshot per klant. Wordt door een job weggeschreven zodat
 * MRR-historie, churn en verlengingen achteraf reconstrueerbaar blijven, ook als
 * een contract later verandert.
 */
export const revenueSnapshots = pgTable(
  "revenue_snapshots",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    period: varchar("period", { length: 7 }).notNull(),
    mrr: numeric("mrr", { precision: 12, scale: 2 }).notNull().default("0"),
    invoiced: numeric("invoiced", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    editorCost: numeric("editor_cost", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    videosDelivered: integer("videos_delivered").notNull().default(0),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    ...timestamps,
  },
  (t) => [unique("revenue_snapshots_unique").on(t.clientId, t.period)],
);

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  lines: many(invoiceLines),
  payments: many(payments),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceLines.invoiceId],
    references: [invoices.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, {
    fields: [payments.invoiceId],
    references: [invoices.id],
  }),
  client: one(clients, { fields: [payments.clientId], references: [clients.id] }),
}));

/* ------------------------------------------------------------------ *
 * Maandelijkse kosten-/winststaat per klant (#9/#10 vervolg)
 * ------------------------------------------------------------------ */

/**
 * Eén rij per klant per maand. De omzet-/editkostenvelden worden automatisch
 * gevuld (snapshot uit Monday), de directe kosten (opname, strategie, overig)
 * vult het team handmatig in. Zo ontstaat echte nettowinst én maandhistorie
 * zonder dat elke maand alles opnieuw hoeft te worden ingevoerd.
 */
export const clientFinanceMonths = pgTable(
  "client_finance_months",
  {
    id: pk(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** Maand als YYYY-MM. */
    period: varchar("period", { length: 7 }).notNull(),
    /** Automatisch uit Monday (snapshot). */
    revenue: numeric("revenue", { precision: 12, scale: 2 }).notNull().default("0"),
    extraRevenue: numeric("extra_revenue", { precision: 12, scale: 2 }).notNull().default("0"),
    editCost: numeric("edit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Handmatige directe kosten. */
    shootCost: numeric("shoot_cost", { precision: 12, scale: 2 }).notNull().default("0"),
    strategyCost: numeric("strategy_cost", { precision: 12, scale: 2 }).notNull().default("0"),
    otherCost: numeric("other_cost", { precision: 12, scale: 2 }).notNull().default("0"),
    note: text("note"),
    /** auto = door de maand-job gezet, manual = handmatig bijgewerkt. */
    source: varchar("source", { length: 16 }).notNull().default("auto"),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    unique("client_finance_months_unique").on(t.clientId, t.period),
    index("client_finance_months_period_idx").on(t.period),
  ],
);
