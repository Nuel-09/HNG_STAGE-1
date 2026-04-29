const express = require("express");
const {
  createProfile,
  getProfiles,
  exportProfiles,
  searchProfiles,
  getProfileById,
  deleteProfile
} = require("../controllers/profilesController");
const { getMe } = require("../controllers/meController");
const { requireRoles } = require("../middleware/rbac");

const router = express.Router();

router.get("/me", getMe);
router.post("/profiles", requireRoles("admin"), createProfile);
router.get("/profiles", getProfiles);
router.get("/profiles/export", requireRoles("admin"), exportProfiles);
router.get("/profiles/search", searchProfiles);
router.get("/profiles/:id", getProfileById);
router.delete("/profiles/:id", requireRoles("admin"), deleteProfile);

module.exports = router;
