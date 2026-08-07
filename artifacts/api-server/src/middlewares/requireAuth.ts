import type { NextFunction, Request, Response } from "express";
import { readSession } from "../lib/session";

/** Gates every route it's applied in front of behind a valid session
 * cookie. API routes always get a JSON 401 here — the frontend's route
 * guard (not this middleware) is what redirects browser navigation to
 * /login. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (readSession(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "Authentication required." });
}
