import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth";
import { logger } from "./lib/logger";
import { getAuthConfig } from "./lib/authConfig";
import { requireAuth } from "./middlewares/requireAuth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Note: the req serializer above only ever emits {id, method, url} — request
// bodies (so login's username/password) and the session secret are never
// passed to the logger anywhere in this codebase.
app.use(cors());
// Ticket images are sent one at a time as base64 so the API can run local OCR
// without exposing provider credentials or requiring a paid AI service.
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
// getAuthConfig() throws if APP_LOGIN_USER/APP_LOGIN_PASSWORD/SESSION_SECRET
// are unset — this is the server's fail-fast startup check for the login
// gate. It only runs when the server actually starts (this module is
// executed), never during a build/bundle step.
app.use(cookieParser(getAuthConfig().sessionSecret));

// Public: uptime checks must work without a session, and login/logout are
// how a session is obtained/discarded in the first place.
app.use("/api", healthRouter);
app.use("/api", authRouter);

// Everything else requires a valid session.
app.use("/api", requireAuth, router);

export default app;
