import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

// A job's FLEXIBLE budget. There is deliberately NO method_type / "choose a
// method" column: a single unified budget per job holds a target and a flat
// list of lines, and each cost-code SECTION within it can freely be a lump
// sum, cost-code line items, or both (hybrid) — that shape lives entirely in
// budget_lines, never in a mode flag here. One budget per job (UNIQUE jobId).
export const jobBudgetsTable = pgTable(
  "job_budgets",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobsTable.id, { onDelete: "cascade" }),
    // Money stored as canonical text, mirroring tickets.amount — the app's
    // established convention (parsed with the shared parseBudgetAmount, which
    // strips $ , whitespace and never yields NaN). Nothing derived
    // (subtotals/grandTotal/remaining) is ever stored; it's all computed from
    // the lines via @workspace/budget.
    targetAmount: text("target_amount").notNull().default("0"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [unique("job_budgets_job_id_unique").on(table.jobId)],
);

// One line of a budget. Semantics (there is no type column — the shape is
// implied by whether costCode is null and which section it belongs to):
//   * lump-sum-only category  -> a single line, costCode null, label = the
//     category/section name (e.g. "Supplies").
//   * cost-code line          -> costCode set (validated via isKnownCostCode
//     at the API boundary), label = the code's name.
//   * hybrid "Additional [Category] (non-coded)" -> a costCode-null line
//     living alongside coded lines in the same section.
export const budgetLinesTable = pgTable(
  "budget_lines",
  {
    id: serial("id").primaryKey(),
    budgetId: integer("budget_id")
      .notNull()
      .references(() => jobBudgetsTable.id, { onDelete: "cascade" }),
    // A cost-code section name (see @workspace/cost-codes costCodesBySection).
    section: text("section").notNull(),
    // Nullable: null = a lump-sum or "Additional (non-coded)" line; a set
    // value = a cost-code line, validated against the shared taxonomy on
    // write (not a DB constraint, so DHG can extend codes without migration).
    costCode: text("cost_code"),
    label: text("label").notNull().default(""),
    // Money as text, same convention as targetAmount / tickets.amount.
    amount: text("amount").notNull().default("0"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("budget_lines_budget_id_idx").on(table.budgetId),
    index("budget_lines_budget_id_section_idx").on(table.budgetId, table.section),
  ],
);

export const jobBudgetsRelations = relations(jobBudgetsTable, ({ one, many }) => ({
  job: one(jobsTable, {
    fields: [jobBudgetsTable.jobId],
    references: [jobsTable.id],
  }),
  lines: many(budgetLinesTable),
}));

export const budgetLinesRelations = relations(budgetLinesTable, ({ one }) => ({
  budget: one(jobBudgetsTable, {
    fields: [budgetLinesTable.budgetId],
    references: [jobBudgetsTable.id],
  }),
}));

export const insertJobBudgetSchema = createInsertSchema(jobBudgetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJobBudget = z.infer<typeof insertJobBudgetSchema>;
export type JobBudget = typeof jobBudgetsTable.$inferSelect;

export const insertBudgetLineSchema = createInsertSchema(budgetLinesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBudgetLine = z.infer<typeof insertBudgetLineSchema>;
export type BudgetLine = typeof budgetLinesTable.$inferSelect;
