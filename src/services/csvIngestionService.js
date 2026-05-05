const fs = require("fs");
const { parse } = require("@fast-csv/parse");
const { v7: uuidv7 } = require("uuid");
const { Profile } = require("../models/profile");
const {
  CSV_IMPORT_BATCH_SIZE,
  CSV_IMPORT_MAX_CONCURRENCY,
} = require("../config/env");

const BATCH_SIZE = CSV_IMPORT_BATCH_SIZE;
const VALID_GENDERS = new Set(["male", "female"]);
const VALID_AGE_GROUPS = new Set(["child", "teenager", "adult", "senior"]);
let activeImports = 0;

class CsvImportCapacityError extends Error {
  constructor(message) {
    super(message);
    this.name = "CsvImportCapacityError";
  }
}

const initSummary = () => ({
  status: "success",
  total_rows: 0,
  inserted: 0,
  skipped: 0,
  reasons: {
    duplicate_name: 0,
    invalid_age: 0,
    missing_fields: 0,
    invalid_gender: 0,
    invalid_country_id: 0,
    invalid_probability: 0,
    malformed_row: 0,
  },
});

const incrementReason = (summary, reason) => {
  summary.skipped += 1;
  summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
};

const computeAgeGroup = (age) => {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
};

const normalizeRow = (row) => {
  if (!row || typeof row !== "object") return null;
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[
      String(key || "")
        .trim()
        .toLowerCase()
    ] = typeof value === "string" ? value.trim() : value;
  }
  return normalized;
};

const validateAndBuildDoc = (rawRow) => {
  const row = normalizeRow(rawRow);
  if (!row) return { error: "malformed_row" };

  const name = String(row.name || "").trim();
  const gender = String(row.gender || "")
    .trim()
    .toLowerCase();
  const ageNum = Number(row.age);
  const countryId = String(row.country_id || "")
    .trim()
    .toUpperCase();
  const countryName = String(row.country_name || "").trim();
  const genderProbability = Number(row.gender_probability);
  const countryProbability = Number(row.country_probability);

  if (
    !name ||
    !gender ||
    !String(row.age ?? "").trim() ||
    !countryId ||
    !countryName ||
    !String(row.gender_probability ?? "").trim() ||
    !String(row.country_probability ?? "").trim()
  ) {
    return { error: "missing_fields" };
  }

  if (!VALID_GENDERS.has(gender)) return { error: "invalid_gender" };
  if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 150)
    return { error: "invalid_age" };
  if (!/^[A-Z]{2}$/.test(countryId)) return { error: "invalid_country_id" };
  if (
    !Number.isFinite(genderProbability) ||
    !Number.isFinite(countryProbability) ||
    genderProbability < 0 ||
    genderProbability > 1 ||
    countryProbability < 0 ||
    countryProbability > 1
  ) {
    return { error: "invalid_probability" };
  }

  const ageGroupRaw = String(row.age_group || "")
    .trim()
    .toLowerCase();
  const ageGroup = ageGroupRaw ? ageGroupRaw : computeAgeGroup(ageNum);
  if (!VALID_AGE_GROUPS.has(ageGroup)) return { error: "missing_fields" };

  return {
    doc: {
      id: uuidv7(),
      name,
      gender,
      gender_probability: genderProbability,
      age: ageNum,
      age_group: ageGroup,
      country_id: countryId,
      country_name: countryName,
      country_probability: countryProbability,
      created_at: new Date(),
    },
  };
};

const processBatch = async (batchRows, summary) => {
  if (!batchRows.length) return;

  const validDocs = [];
  const seenNames = new Set();

  for (const row of batchRows) {
    summary.total_rows += 1;
    const validated = validateAndBuildDoc(row);
    if (validated.error) {
      incrementReason(summary, validated.error);
      continue;
    }

    const lowered = validated.doc.name.toLowerCase();
    if (seenNames.has(lowered)) {
      incrementReason(summary, "duplicate_name");
      continue;
    }

    seenNames.add(lowered);
    validDocs.push(validated.doc);
  }

  if (!validDocs.length) return;

  const names = validDocs.map((doc) => doc.name);
  const existing = await Profile.find({ name: { $in: names } })
    .collation({ locale: "en", strength: 2 })
    .select({ name: 1, _id: 0 })
    .lean();
  const existingNames = new Set(
    existing.map((entry) => String(entry.name).toLowerCase()),
  );

  const docsToInsert = [];
  for (const doc of validDocs) {
    if (existingNames.has(doc.name.toLowerCase())) {
      incrementReason(summary, "duplicate_name");
      continue;
    }
    docsToInsert.push(doc);
  }

  if (!docsToInsert.length) return;

  try {
    const inserted = await Profile.insertMany(docsToInsert, { ordered: false });
    summary.inserted += inserted.length;
  } catch (error) {
    const insertedDocs = Array.isArray(error?.insertedDocs)
      ? error.insertedDocs.length
      : 0;
    summary.inserted += insertedDocs;

    if (Array.isArray(error?.writeErrors) && error.writeErrors.length) {
      for (const writeError of error.writeErrors) {
        if (writeError?.code === 11000) {
          incrementReason(summary, "duplicate_name");
        } else {
          incrementReason(summary, "malformed_row");
        }
      }
      return;
    }

    throw error;
  }
};

const ingestProfilesCsv = async (filePath) =>
  withImportSlot(
    () =>
      new Promise((resolve, reject) => {
        const summary = initSummary();
        const batchRows = [];
        let isProcessing = false;
        let streamEnded = false;
        let parseError = null;

        const maybeFinalize = async () => {
          if (isProcessing || !streamEnded) return;
          try {
            await processBatch(batchRows.splice(0, batchRows.length), summary);
            resolve(summary);
          } catch (error) {
            reject(error);
          }
        };

        const processCurrentBatch = async (parser) => {
          if (isProcessing) return;
          if (batchRows.length < BATCH_SIZE && !streamEnded) return;
          isProcessing = true;
          parser.pause();
          try {
            const toProcess = batchRows.splice(0, BATCH_SIZE);
            await processBatch(toProcess, summary);
            isProcessing = false;
            parser.resume();
            await maybeFinalize();
          } catch (error) {
            parseError = error;
            reject(error);
          }
        };

        const parser = parse({
          headers: true,
          trim: true,
          ignoreEmpty: true,
          strictColumnHandling: true,
        });

        parser.on("error", (error) => {
          if (parseError) return;
          reject(error);
        });

        parser.on("data-invalid", () => {
          summary.total_rows += 1;
          incrementReason(summary, "malformed_row");
        });

        parser.on("data", async (row) => {
          batchRows.push(row);
          await processCurrentBatch(parser);
        });

        parser.on("end", async () => {
          streamEnded = true;
          await maybeFinalize();
        });

        fs.createReadStream(filePath).pipe(parser);
      }),
  );

const withImportSlot = async (work) => {
  if (activeImports >= CSV_IMPORT_MAX_CONCURRENCY) {
    throw new CsvImportCapacityError("Too many uploads in progress");
  }
  activeImports += 1;
  try {
    return await work();
  } finally {
    activeImports -= 1;
  }
};

module.exports = { ingestProfilesCsv, CsvImportCapacityError };
