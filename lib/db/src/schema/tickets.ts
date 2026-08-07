import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

export const ticketsTable = pgTable("tickets", {
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
  wasteType: text("waste_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
