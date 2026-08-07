import { Router, type IRouter } from "express";
import ticketsRouter from "./tickets";
import jobsRouter from "./jobs";
import ticketRecordsRouter from "./ticketRecords";

// Everything here requires a valid session — see app.ts, which mounts this
// behind the requireAuth middleware. /healthz and /auth/* are intentionally
// separate (public) routers, not included here.
const router: IRouter = Router();

router.use(ticketsRouter);
router.use(jobsRouter);
router.use(ticketRecordsRouter);

export default router;
