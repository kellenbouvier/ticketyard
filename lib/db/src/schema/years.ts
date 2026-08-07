import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const yearsTable = pgTable("years", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertYearSchema = createInsertSchema(yearsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertYear = z.infer<typeof insertYearSchema>;
export type Year = typeof yearsTable.$inferSelect;
