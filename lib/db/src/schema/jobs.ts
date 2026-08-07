import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { yearsTable } from "./years";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  yearId: integer("year_id")
    .notNull()
    .references(() => yearsTable.id, { onDelete: "cascade" }),
  jobNumber: text("job_number").notNull(),
  jobName: text("job_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const jobsRelations = relations(jobsTable, ({ one }) => ({
  year: one(yearsTable, {
    fields: [jobsTable.yearId],
    references: [yearsTable.id],
  }),
}));

export const yearsRelations = relations(yearsTable, ({ many }) => ({
  jobs: many(jobsTable),
}));

export const insertJobSchema = createInsertSchema(jobsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
