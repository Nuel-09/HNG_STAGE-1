const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { WEB_ORIGIN } = require("./config/env");
const { requestLogger } = require("./middleware/requestLogger");
const { authLimiter, apiLimiter } = require("./middleware/rateLimits");
const { authenticate } = require("./middleware/authenticate");
const { csrfProtect } = require("./middleware/csrf");
const { requireApiVersion } = require("./middleware/apiVersion");
const authRoutes = require("./routes/auth");
const profilesRouter = require("./routes/profiles");

const app = express();

app.use(requestLogger);
app.use(cookieParser());

const corsOrigin =
  !WEB_ORIGIN || WEB_ORIGIN === "*"
    ? true
    : WEB_ORIGIN.split(",").map((s) => s.trim());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());

app.use("/auth", authLimiter, authRoutes);
app.use("/api", authenticate, apiLimiter, csrfProtect, requireApiVersion, profilesRouter);

module.exports = app;
