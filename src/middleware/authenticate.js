const { verifyAccessToken } = require("../services/tokenService");
const { User } = require("../models/user");

const authenticate = async (req, res, next) => {
  let token = null;
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (req.cookies?.access_token) {
    token = req.cookies.access_token;
  }

  if (!token) {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }

  try {
    const payload = verifyAccessToken(token);
    const user = await User.findOne({ id: payload.sub });
    if (!user) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    if (!user.is_active) {
      return res.status(403).json({ status: "error", message: "Forbidden" });
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ status: "error", message: "Unauthorized" });
  }
};

module.exports = { authenticate };
