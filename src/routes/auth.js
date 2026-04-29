const express = require("express");
const {
  startGithub,
  githubCallback,
  githubToken,
  issueCsrfToken,
  refresh,
  logout
} = require("../controllers/authController");
const { csrfProtect } = require("../middleware/csrf");

const router = express.Router();

router.get("/github", startGithub);
router.get("/github/callback", githubCallback);
router.get("/csrf-token", issueCsrfToken);
router.post("/github/token", githubToken);
router.post("/refresh", csrfProtect, refresh);
router.post("/logout", csrfProtect, logout);

module.exports = router;
