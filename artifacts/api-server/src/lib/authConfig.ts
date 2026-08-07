/** Shared-credential auth configuration, read lazily from env so that
 * importing this module (e.g. at build time) never throws — only calling
 * getAuthConfig() does, and only api-server's runtime start calls it. */
export type AuthConfig = {
  username: string;
  password: string;
  sessionSecret: string;
};

let cached: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (cached) return cached;

  const username = process.env["APP_LOGIN_USER"];
  const password = process.env["APP_LOGIN_PASSWORD"];
  const sessionSecret = process.env["SESSION_SECRET"];

  const missing = [
    !username && "APP_LOGIN_USER",
    !password && "APP_LOGIN_PASSWORD",
    !sessionSecret && "SESSION_SECRET",
  ].filter((name): name is string => Boolean(name));

  if (missing.length) {
    throw new Error(
      `Missing required env var(s) for the login gate: ${missing.join(", ")}. ` +
        "Set them before starting the API server (see .env.example).",
    );
  }
  if (sessionSecret!.length < 16) {
    throw new Error(
      "SESSION_SECRET must be at least 16 characters — it signs the session cookie.",
    );
  }

  cached = { username: username!, password: password!, sessionSecret: sessionSecret! };
  return cached;
}
