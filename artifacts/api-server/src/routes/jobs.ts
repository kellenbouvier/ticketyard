import { Router } from "express";
import { db } from "@workspace/db";
import { yearsTable, jobsTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";

/** Walk the error chain to find a PostgreSQL unique-constraint violation (23505). */
function isUniqueViolation(err: unknown): boolean {
  let node: unknown = err;
  while (node != null && typeof node === "object") {
    const code = (node as Record<string, unknown>)["code"];
    if (code === "23505") return true;
    node = (node as Record<string, unknown>)["cause"];
  }
  return false;
}

const router = Router();

// ─── Years ────────────────────────────────────────────────────────────────────

// GET /years — list all years ordered ascending
router.get("/years", async (_req, res) => {
  const years = await db
    .select({ id: yearsTable.id, year: yearsTable.year })
    .from(yearsTable)
    .orderBy(asc(yearsTable.year));
  res.json(years);
});

// POST /years — create a year
router.post("/years", async (req, res) => {
  const { year } = req.body as { year: unknown };
  const parsed = Number(year);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    res.status(400).json({ error: "year must be an integer between 2000 and 2100" });
    return;
  }
  try {
    const [created] = await db
      .insert(yearsTable)
      .values({ year: parsed })
      .returning({ id: yearsTable.id, year: yearsTable.year });
    res.status(201).json(created);
  } catch (err: unknown) {
    // Drizzle wraps the original pg error; the PG constraint code sits on err.cause
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: `Year ${parsed} already exists` });
    } else {
      throw err;
    }
  }
});

// DELETE /years/:yearId — delete year and cascade-delete its jobs
router.delete("/years/:yearId", async (req, res) => {
  const yearId = Number(req.params["yearId"]);
  const [deleted] = await db
    .delete(yearsTable)
    .where(eq(yearsTable.id, yearId))
    .returning({ id: yearsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Year not found" });
    return;
  }
  res.status(204).end();
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

// GET /years/:yearId/jobs — list jobs for a year
router.get("/years/:yearId/jobs", async (req, res) => {
  const yearId = Number(req.params["yearId"]);
  const [yearRow] = await db
    .select({ id: yearsTable.id })
    .from(yearsTable)
    .where(eq(yearsTable.id, yearId));
  if (!yearRow) {
    res.status(404).json({ error: "Year not found" });
    return;
  }
  const jobs = await db
    .select({
      id: jobsTable.id,
      yearId: jobsTable.yearId,
      jobNumber: jobsTable.jobNumber,
      jobName: jobsTable.jobName,
    })
    .from(jobsTable)
    .where(eq(jobsTable.yearId, yearId))
    .orderBy(asc(jobsTable.jobNumber));
  res.json(jobs);
});

// POST /years/:yearId/jobs — create a job
router.post("/years/:yearId/jobs", async (req, res) => {
  const yearId = Number(req.params["yearId"]);
  const [yearRow] = await db
    .select({ id: yearsTable.id })
    .from(yearsTable)
    .where(eq(yearsTable.id, yearId));
  if (!yearRow) {
    res.status(404).json({ error: "Year not found" });
    return;
  }
  const { jobNumber, jobName } = req.body as { jobNumber: unknown; jobName: unknown };
  if (typeof jobNumber !== "string" || !jobNumber.trim()) {
    res.status(400).json({ error: "jobNumber is required" });
    return;
  }
  if (typeof jobName !== "string" || !jobName.trim()) {
    res.status(400).json({ error: "jobName is required" });
    return;
  }
  try {
    const [created] = await db
      .insert(jobsTable)
      .values({ yearId, jobNumber: jobNumber.trim(), jobName: jobName.trim() })
      .returning({
        id: jobsTable.id,
        yearId: jobsTable.yearId,
        jobNumber: jobsTable.jobNumber,
        jobName: jobsTable.jobName,
      });
    res.status(201).json(created);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: `Job ${jobNumber.trim()} already exists for this year` });
    } else {
      throw err;
    }
  }
});

// PUT /years/:yearId/jobs/:jobId — update a job
router.put("/years/:yearId/jobs/:jobId", async (req, res) => {
  const yearId = Number(req.params["yearId"]);
  const jobId = Number(req.params["jobId"]);
  const { jobNumber, jobName } = req.body as { jobNumber: unknown; jobName: unknown };
  if (typeof jobNumber !== "string" || !jobNumber.trim()) {
    res.status(400).json({ error: "jobNumber is required" });
    return;
  }
  if (typeof jobName !== "string" || !jobName.trim()) {
    res.status(400).json({ error: "jobName is required" });
    return;
  }
  try {
    const [updated] = await db
      .update(jobsTable)
      .set({ jobNumber: jobNumber.trim(), jobName: jobName.trim() })
      .where(eq(jobsTable.id, jobId))
      .returning({
        id: jobsTable.id,
        yearId: jobsTable.yearId,
        jobNumber: jobsTable.jobNumber,
        jobName: jobsTable.jobName,
      });
    if (!updated || updated.yearId !== yearId) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(updated);
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: `Job ${jobNumber.trim()} already exists for this year` });
    } else {
      throw err;
    }
  }
});

// DELETE /years/:yearId/jobs/:jobId — delete a job
router.delete("/years/:yearId/jobs/:jobId", async (req, res) => {
  const yearId = Number(req.params["yearId"]);
  const jobId = Number(req.params["jobId"]);
  const [deleted] = await db
    .delete(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .returning({ id: jobsTable.id, yearId: jobsTable.yearId });
  if (!deleted || deleted.yearId !== yearId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.status(204).end();
});

export default router;
