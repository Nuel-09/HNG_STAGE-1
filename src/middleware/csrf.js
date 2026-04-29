/**
 * Double-submit cookie CSRF for cookie-based browser clients.
 * Skips when Authorization: Bearer is used (CLI / API tokens).
 * Skips when no auth cookies are sent (e.g. CLI refresh body-only).
 */
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const csrfProtect = (req, res, next) => {
  if (!UNSAFE.has(req.method)) return next();

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return next();
  }

  const hasAuthCookies = Boolean(req.cookies?.refresh_token || req.cookies?.access_token);
  if (!hasAuthCookies) return next();

  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers["x-csrf-token"];
  if (!cookieToken || !headerToken || String(cookieToken) !== String(headerToken)) {
    return res.status(403).json({ status: "error", message: "Invalid CSRF token" });
  }
  next();
};

module.exports = { csrfProtect };
