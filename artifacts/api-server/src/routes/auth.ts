import { Router, type IRouter } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { getAuthConfig } from "../lib/authConfig";
import { clearSessionCookie, readSession, setSessionCookie } from "../lib/session";
import { LoginBody } from "@workspace/api-zod";

const router: IRouter = Router();

/** Constant-time string comparison. Hashing first sidesteps
 * timingSafeEqual's equal-length requirement (user-supplied strings can be
 * any length) without leaking length information through comparison time. */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

router.post("/auth/login", (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }

  const { username, password } = parsed.data;
  const config = getAuthConfig();

  // Compare both fields unconditionally (no short-circuit) and return an
  // identical generic error either way, so response content/timing can't
  // be used to enumerate whether the username or the password was wrong.
  const usernameOk = safeEqual(username, config.username);
  const passwordOk = safeEqual(password, config.password);

  if (!usernameOk || !passwordOk) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  setSessionCookie(res, config.username);
  res.json({ user: config.username });
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/auth/me", (req, res) => {
  const user = readSession(req);
  if (!user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  res.json({ user });
});

export default router;
