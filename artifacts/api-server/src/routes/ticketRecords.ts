import { Router } from "express";
import { db } from "@workspace/db";
import { jobsTable, ticketsTable } from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  CreateTicketRecordBody,
  UpdateTicketRecordBody,
} from "@workspace/api-zod";
import { isKnownCostCode } from "@workspace/cost-codes";

const router = Router();

async function jobExists(jobId: number): Promise<boolean> {
  const [job] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  return Boolean(job);
}

// GET /jobs/:jobId/tickets — list ticket register rows for a job
router.get("/jobs/:jobId/tickets", async (req, res) => {
  const jobId = Number(req.params["jobId"]);
  if (!(await jobExists(jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const rows = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.jobId, jobId))
    .orderBy(asc(ticketsTable.createdAt));
  res.json(rows);
});

// POST /jobs/:jobId/tickets — add a ticket register row to a job
router.post("/jobs/:jobId/tickets", async (req, res) => {
  const jobId = Number(req.params["jobId"]);
  if (!(await jobExists(jobId))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const parsed = CreateTicketRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ticket register row." });
    return;
  }
  const data = parsed.data;
  // costCode is validated against the shared taxonomy (@workspace/cost-codes)
  // here at the API boundary rather than a DB constraint, so DHG can add new
  // codes to that one module without a migration. null always passes
  // ("needs review") — only a non-null, unrecognized string is rejected.
  if (!isKnownCostCode(data.costCode ?? null)) {
    res.status(400).json({ error: "Unknown cost code." });
    return;
  }
  const [created] = await db
    .insert(ticketsTable)
    .values({
      jobId,
      fileName: data.fileName,
      status: data.status,
      error: data.error ?? null,
      documentType: data.documentType ?? "",
      vendor: data.vendor ?? "",
      ticketNumber: data.ticketNumber ?? "",
      invoiceNumber: data.invoiceNumber ?? "",
      purchaseOrder: data.purchaseOrder ?? "",
      jobNumber: data.jobNumber ?? "",
      date: data.date ?? "",
      weight: data.weight ?? "",
      amount: data.amount ?? "",
      description: data.description ?? "",
      wasteCategory: data.wasteCategory ?? null,
      costCode: data.costCode ?? null,
    })
    .returning();
  res.status(201).json(created);
});

// PATCH /jobs/:jobId/tickets/:ticketId — update fields on a ticket register row
router.patch("/jobs/:jobId/tickets/:ticketId", async (req, res) => {
  const jobId = Number(req.params["jobId"]);
  const ticketId = Number(req.params["ticketId"]);
  const parsed = UpdateTicketRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ticket register row update." });
    return;
  }
  const data = parsed.data;
  if (data.costCode !== undefined && !isKnownCostCode(data.costCode)) {
    res.status(400).json({ error: "Unknown cost code." });
    return;
  }
  const [updated] = await db
    .update(ticketsTable)
    .set({
      ...(data.fileName !== undefined && { fileName: data.fileName }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.error !== undefined && { error: data.error }),
      ...(data.documentType !== undefined && { documentType: data.documentType }),
      ...(data.vendor !== undefined && { vendor: data.vendor }),
      ...(data.ticketNumber !== undefined && { ticketNumber: data.ticketNumber }),
      ...(data.invoiceNumber !== undefined && { invoiceNumber: data.invoiceNumber }),
      ...(data.purchaseOrder !== undefined && { purchaseOrder: data.purchaseOrder }),
      ...(data.jobNumber !== undefined && { jobNumber: data.jobNumber }),
      ...(data.date !== undefined && { date: data.date }),
      ...(data.weight !== undefined && { weight: data.weight }),
      ...(data.amount !== undefined && { amount: data.amount }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.wasteCategory !== undefined && { wasteCategory: data.wasteCategory }),
      ...(data.costCode !== undefined && { costCode: data.costCode }),
    })
    .where(and(eq(ticketsTable.id, ticketId), eq(ticketsTable.jobId, jobId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Ticket register row not found" });
    return;
  }
  res.json(updated);
});

// DELETE /jobs/:jobId/tickets/:ticketId — delete a ticket register row
router.delete("/jobs/:jobId/tickets/:ticketId", async (req, res) => {
  const jobId = Number(req.params["jobId"]);
  const ticketId = Number(req.params["ticketId"]);
  const [deleted] = await db
    .delete(ticketsTable)
    .where(and(eq(ticketsTable.id, ticketId), eq(ticketsTable.jobId, jobId)))
    .returning({ id: ticketsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Ticket register row not found" });
    return;
  }
  res.status(204).end();
});

export default router;
