import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

// D.H. Griffin tracks disposal cost, hauling cost, billing, and
// profitability separately for C&D landfill vs. inert/concrete recycling —
// these two categories must never be merged. A dedicated enum column (not
// the old free-text wasteType) makes "exactly one of these two values, or
// unset pending review" the only representable states.
export const wasteCategoryEnum = pgEnum("waste_category", ["C&D", "Inert"]);

export const ticketsTable = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    documentType: text("document_type").notNull(),
    vendor: text("vendor").notNull(),
    ticketNumber: text("ticket_number").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    purchaseOrder: text("purchase_order").notNull(),
    jobNumber: text("job_number").notNull(),
    date: text("date").notNull(),
    weight: text("weight").notNull(),
    amount: text("amount").notNull(),
    description: text("description").notNull(),
    // Nullable: unset means "needs manual review" (e.g. a legacy row
    // backfilled from a vendor rule that didn't confidently match either
    // category). New rows always get a value — see classifyWasteCategory()
    // in artifacts/api-server/src/routes/tickets.ts — but it stays
    // manually overridable and un-guessable for rows nothing can classify.
    wasteCategory: wasteCategoryEnum("waste_category"),
    // The PRIMARY classification for every ticket (DHG's accounting "Cat"
    // column — see @workspace/cost-codes for the taxonomy). Plain text, not
    // a pg enum: DHG adds codes over time, and a rigid enum would require a
    // DB migration for every new one. Nullable = "needs review", never a
    // guessed value; validated against the known-codes list on write (see
    // artifacts/api-server/src/routes/ticketRecords.ts), not at the DB
    // layer, so extending the taxonomy never requires a migration.
    costCode: text("cost_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("tickets_waste_category_idx").on(table.wasteCategory),
    index("tickets_cost_code_idx").on(table.costCode),
  ],
);

export const ticketsRelations = relations(ticketsTable, ({ one }) => ({
  job: one(jobsTable, {
    fields: [ticketsTable.jobId],
    references: [jobsTable.id],
  }),
}));

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;
