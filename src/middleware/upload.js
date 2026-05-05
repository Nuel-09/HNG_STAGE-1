const path = require("path");
const os = require("os");
const multer = require("multer");
const { CSV_IMPORT_FILE_SIZE_MB } = require("../config/env");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) => {
    const safeName = String(file.originalname || "upload.csv").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  const isCsvMime = mime.includes("csv") || mime === "text/plain" || mime === "application/vnd.ms-excel";
  if (ext === ".csv" || isCsvMime) return cb(null, true);
  return cb(new Error("Only CSV files are allowed"));
};

const uploadCsvFile = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: CSV_IMPORT_FILE_SIZE_MB * 1024 * 1024
  }
}).single("file");

module.exports = { uploadCsvFile };
