const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(
      JSON.stringify({
        method: req.method,
        endpoint: req.originalUrl.split("?")[0],
        status: res.statusCode,
        response_time_ms: ms
      })
    );
  });
  next();
};

module.exports = { requestLogger };
