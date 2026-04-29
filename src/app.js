const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { getCorsConfig } = require("./utils/corsOptions");
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

app.use(cors(getCorsConfig()));
app.use(express.json());

app.use("/auth", authLimiter, authRoutes);
app.use("/api", authenticate, apiLimiter, csrfProtect, requireApiVersion, profilesRouter);

module.exports = app;
