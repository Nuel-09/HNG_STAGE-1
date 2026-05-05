const getEndpoint = (req) => String(req.originalUrl || req.url || "").split("?")[0];

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
};

const requestLogger = (req, res, next) => {
  const start = Date.now();
  const requestId = req.headers["x-request-id"] || null;

  const logFinal = () => {
    const ms = Date.now() - start;
    const contentLength = res.getHeader("content-length");

    // Keep existing keys for backward compatibility and add useful context.
    console.log(
      JSON.stringify({
        method: req.method,
        endpoint: getEndpoint(req),
        status: res.statusCode,
        response_time_ms: ms,
        request_id: requestId,
        ip: getClientIp(req),
        user_agent: req.headers["user-agent"] || null,
        user_id: req.user?.id || null,
        role: req.user?.role || null,
        content_length: typeof contentLength === "string" ? Number(contentLength) || null : contentLength || null
      })
    );
  };

  res.on("finish", logFinal);
  next();
};

module.exports = { requestLogger };
