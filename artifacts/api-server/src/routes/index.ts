import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ticketsRouter from "./tickets";
import jobsRouter from "./jobs";
import ticketRecordsRouter from "./ticketRecords";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ticketsRouter);
router.use(jobsRouter);
router.use(ticketRecordsRouter);

export default router;
