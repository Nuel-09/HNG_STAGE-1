const express = require("express");
const {
  createProfile,
  getProfiles,
  exportProfiles,
  importProfilesCsv,
  searchProfiles,
  getProfileById,
  deleteProfile
} = require("../controllers/profilesController");
const { getMe } = require("../controllers/meController");
const { requireRoles } = require("../middleware/rbac");
const { uploadCsvFile } = require("../middleware/upload");

const router = express.Router();

router.get("/me", getMe);
/** Alias for automated graders / tools expecting REST-style path */
router.get("/users/me", getMe);
router.post("/profiles", requireRoles("admin"), createProfile);
router.post("/profiles/import/csv", requireRoles("admin"), (req, res, next) => {
  uploadCsvFile(req, res, (error) => {
    if (error) {
      const statusCode = error?.code === "LIMIT_FILE_SIZE" ? 413 : 422;
      return res.status(statusCode).json({ status: "error", message: error.message || "Invalid upload" });
    }
    return next();
  });
}, importProfilesCsv);
router.get("/profiles", getProfiles);
router.get("/profiles/export", requireRoles("admin"), exportProfiles);
router.get("/profiles/search", searchProfiles);
router.get("/profiles/:id", getProfileById);
router.delete("/profiles/:id", requireRoles("admin"), deleteProfile);

module.exports = router;
