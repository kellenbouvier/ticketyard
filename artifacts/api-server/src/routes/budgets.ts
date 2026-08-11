import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, jobBudgetsTable, budgetLinesTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";
import { PutJobBudgetBody } from "@workspace/api-zod";
import { isKnownCostCode } from "@workspace/cost-codes";

const router = Router();

async function jobExists(jobId: number): Promise<boolean> {
  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  return Boolean(job);
}

type ApiBudgetLine = {
  section: string;
  costCode: string | null;
  label: string;
  amount: string;
  sortOrder: number;
};
type ApiBudget = { jobId: number; targetAmount: string; lines: ApiBudgetLine[] };

// Load a job's budget in the API's flat shape. Returns an empty budget
// (target "0", no lines) when the job has no budget yet — the DB ids and
// timestamps are internal detail the client never needs (replace-all PUT
// means the client never references a line id).
async function loadBudget(jobId: number): Promise<ApiBudget> {
  const [budget] = await db
    .select()
    .from(jobBudgetsTable)
    .where(eq(jobBudgetsTable.jobId, jobId));
  if (!budget) return { jobId, targetAmount: "0", lines: [] };
  const lines = await db
    .select()
    .from(budgetLinesTable)
    .where(eq(budgetLinesTable.budgetId, budget.id))
    .orderBy(asc(budgetLinesTable.sortOrder), asc(budgetLinesTable.id));
  return {
    jobId,
    targetAmount: budget.targetAmount,
    lines: lines.map((l) => ({
      section: l.section,
      costCode: l.costCode ?? null,
      label: l.label,
      amount: l.amount,
      sortOrder: l.sortOrder,
    })),
  };
}

// GET /jobs/:jobId/budget — the job's flexible budget (empty if none yet)
router.get("/jobs/:jobId/budget", async (req, res) => {
  const jobId = Number(req.params["jobId"]);
  if (!(await jobExists(jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(await loadBudget(jobId));
});

// PUT /jobs/:jobId/budget — upsert the whole budget (replace-all semantics)
router.put("/jobs/:jobId/budget", async (req, res) => {
  const jobId = Number(req.params["jobId"]);
  if (!(await jobExists(jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const parsed = PutJobBudgetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid budget." });
    return;
  }
  const data = parsed.data;

  // Every non-null cost code must be known — validated at the API boundary
  // against the shared taxonomy (@workspace/cost-codes), not a DB
  // constraint, so DHG can extend codes without a migration. null always
  // passes (a lump-sum / "Additional (non-coded)" line).
  for (const line of data.lines) {
    if (!isKnownCostCode(line.costCode ?? null)) {
      res.status(400).json({ error: `Unknown cost code: ${line.costCode}` });
      return;
    }
  }

  // Replace-all upsert in one transaction: one budget per job (UNIQUE
  // jobId). Nothing derived is stored — only the target and the raw lines.
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: jobBudgetsTable.id })
      .from(jobBudgetsTable)
      .where(eq(jobBudgetsTable.jobId, jobId));

    let budgetId: number;
    if (existing) {
      budgetId = existing.id;
      await tx
        .update(jobBudgetsTable)
        .set({ targetAmount: data.targetAmount, updatedAt: new Date() })
        .where(eq(jobBudgetsTable.id, budgetId));
      // Replace-all: drop the old lines (cascade would also do this on a
      // budget delete, but we keep the budget row so its createdAt is stable).
      await tx.delete(budgetLinesTable).where(eq(budgetLinesTable.budgetId, budgetId));
    } else {
      const [created] = await tx
        .insert(jobBudgetsTable)
        .values({ jobId, targetAmount: data.targetAmount })
        .returning({ id: jobBudgetsTable.id });
      budgetId = created!.id;
    }

    if (data.lines.length > 0) {
      await tx.insert(budgetLinesTable).values(
        data.lines.map((line, index) => ({
          budgetId,
          section: line.section,
          costCode: line.costCode ?? null,
          label: line.label ?? "",
          amount: line.amount ?? "0",
          sortOrder: index,
        })),
      );
    }
  });

  res.json(await loadBudget(jobId));
});

export default router;
