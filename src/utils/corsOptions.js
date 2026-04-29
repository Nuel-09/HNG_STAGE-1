const { WEB_ORIGIN } = require("../config/env");

const normalizeOrigin = (s) => String(s || "").trim().replace(/\/$/, "");

function buildOriginCallback() {
  const raw = WEB_ORIGIN;
  if (!raw || raw === "*") {
    return true;
  }
  const allowed = raw
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);

  if (allowed.length === 0) {
    return true;
  }

  return (requestOrigin, callback) => {
    if (!requestOrigin) {
      return callback(null, true);
    }
    if (allowed.includes(normalizeOrigin(requestOrigin))) {
      return callback(null, true);
    }
    return callback(null, false);
  };
}

function getCorsConfig() {
  return {
    origin: buildOriginCallback(),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Version",
      "X-CSRF-Token",
      "Accept"
    ],
    optionsSuccessStatus: 204,
    maxAge: 86400
  };
}

module.exports = { getCorsConfig, normalizeOrigin };
