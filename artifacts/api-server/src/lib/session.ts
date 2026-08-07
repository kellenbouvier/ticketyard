import type { Request, Response } from "express";
import { getAuthConfig } from "./authConfig";

export const SESSION_COOKIE_NAME = "dhg_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type SessionPayload = {
  user: string;
  iat: number;
};

/** Sets the signed, httpOnly session cookie after a successful login.
 * Signing (via cookie-parser + SESSION_SECRET) makes the cookie
 * tamper-evident; there is no secret data inside it, so it does not need
 * to be encrypted, only unforgeable. */
export function setSessionCookie(res: Response, user: string): void {
  const payload: SessionPayload = { user, iat: Date.now() };
  res.cookie(SESSION_COOKIE_NAME, JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    signed: true,
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
  });
}

/** Returns the authenticated username for a request with a valid, unexpired
 * signed session cookie, or null otherwise. Never throws. */
export function readSession(req: Request): string | null {
  const raw = req.signedCookies?.[SESSION_COOKIE_NAME];
  // cookie-parser sets this to `false` (not undefined) when a cookie with
  // this name exists but failed signature verification.
  if (!raw || typeof raw !== "string") return null;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as SessionPayload).user !== "string" ||
    typeof (payload as SessionPayload).iat !== "number"
  ) {
    return null;
  }

  const { user, iat } = payload as SessionPayload;
  if (Date.now() - iat > SESSION_MAX_AGE_MS) return null;
  if (user !== getAuthConfig().username) return null;
  return user;
}
