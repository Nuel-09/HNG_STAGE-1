const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ status: "error", message: "Too many requests" });
  }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id) || req.ip || "unknown",
  handler: (req, res) => {
    res.status(429).json({ status: "error", message: "Too many requests" });
  }
});

module.exports = { authLimiter, apiLimiter };
