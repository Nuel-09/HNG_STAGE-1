/**
 * Profiles API — Queryable Intelligence Engine (assignment)
 *
 * Search tags in this file:
 *   CONFIG      — env, port, upstream timeout
 *   APP         — Express + CORS (*)
 *   SCHEMA      — Profile model (UUID v7 id, assignment fields)
 *   INDEXES     — compound-friendly indexes for filter/sort
 *   MIGRATE     — drop legacy `normalized_name_1` index if present
 *   RESPONSE    — JSON shape helpers, UTC ISO timestamps
 *   UPSTREAM    — Genderize / Agify / Nationalize + timeouts + 502 handling
 *   QUERY       — GET /api/profiles: filters, sort, pagination, validation
 *   NL_SEARCH   — GET /api/profiles/search: rule-based English -> Mongo filters
 *   LIST        — shared list response { status, page, limit, total, data }
 *   ROUTES      — POST/GET/DELETE handlers (route order: list & search before :id)
 *
 * npm start
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { v7: uuidv7, validate: isUuid } = require("uuid");

// CONFIG
const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 4000);

// UPSTREAM — external demographic APIs used by POST /api/profiles
const API = {
  genderize: "https://api.genderize.io",
  agify: "https://api.agify.io",
  nationalize: "https://api.nationalize.io"
};

// APP — CORS per assignment; JSON body for POST
app.use(cors({ origin: "*" }));
app.use(express.json());

// SCHEMA — must match assignment table + seed.js
const profileSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true, unique: true },
    gender: { type: String, required: true, enum: ["male", "female"] },
    gender_probability: { type: Number, required: true },
    age: { type: Number, required: true },
    age_group: { type: String, required: true, enum: ["child", "teenager", "adult", "senior"] },
    country_id: { type: String, required: true, minlength: 2, maxlength: 2 },
    country_name: { type: String, required: true },
    country_probability: { type: Number, required: true },
    created_at: { type: Date, required: true, default: () => new Date() }
  },
  { versionKey: false }
);

// INDEXES — support filtered/sorted queries without full collection scans where possible
profileSchema.index({ gender: 1 });
profileSchema.index({ age_group: 1 });
profileSchema.index({ country_id: 1 });
profileSchema.index({ age: 1 });
profileSchema.index({ gender_probability: 1 });
profileSchema.index({ country_probability: 1 });
profileSchema.index({ created_at: -1 });

const Profile = mongoose.model("Profile", profileSchema);

// MIGRATE — remove stale unique index from older schema (see seed.js)
const dropLegacyIndexes = async () => {
  const indexes = await Profile.collection.indexes();
  const legacyIndexNames = indexes
    .map((index) => index.name)
    .filter((name) => name === "normalized_name_1");

  for (const indexName of legacyIndexNames) {
    await Profile.collection.dropIndex(indexName);
  }
};

// RESPONSE — assignment error envelope; profile JSON uses UTC ISO for created_at
const sendError = (res, statusCode, message) =>
  res.status(statusCode).json({ status: "error", message });

const buildProfileResponse = (doc) => ({
  id: doc.id,
  name: doc.name,
  gender: doc.gender,
  gender_probability: doc.gender_probability,
  age: doc.age,
  age_group: doc.age_group,
  country_id: doc.country_id,
  country_name: doc.country_name,
  country_probability: doc.country_probability,
  created_at: new Date(doc.created_at).toISOString()
});

// UPSTREAM — fetch with AbortController timeout; non-OK HTTP -> thrown for fetchExternalApi
const fetchJsonWithTimeout = async (url) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchExternalApi = async (apiName, url) => {
  try {
    return await fetchJsonWithTimeout(url);
  } catch (error) {
    const custom = new Error(`${apiName} returned an invalid response`);
    custom.statusCode = 502;
    throw custom;
  }
};

// Domain helpers for POST create flow
const classifyAgeGroup = (age) => {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
};

const getTopCountry = (countries) => {
  if (!Array.isArray(countries) || countries.length === 0) return null;
  return countries.reduce((max, current) =>
    current.probability > max.probability ? current : max
  );
};

// QUERY — allowed enums and GET /api/profiles query keys (unknown key -> 422)
const AGE_GROUPS = new Set(["child", "teenager", "adult", "senior"]);
const SORTABLE_FIELDS = new Set(["age", "created_at", "gender_probability"]);
const SORT_ORDERS = new Set(["asc", "desc"]);
const VALID_QUERY_KEYS = new Set([
  "gender",
  "age_group",
  "country_id",
  "min_age",
  "max_age",
  "min_gender_probability",
  "min_country_probability",
  "sort_by",
  "order",
  "page",
  "limit"
]);

// POST create: derive display country name from ISO code when storing new profiles
const countryDisplay = new Intl.DisplayNames(["en"], { type: "region" });
const getCountryNameFromCode = (countryCode) => {
  try {
    return countryDisplay.of(String(countryCode || "").toUpperCase()) || "Unknown";
  } catch {
    return "Unknown";
  }
};

// QUERY — strict string parsing for numeric query params (reject floats where ints required)
const toStrictNumber = (value, min = -Infinity, max = Infinity) => {
  if (typeof value !== "string" || !value.trim()) return null;
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
};

// QUERY — maps req.query -> Mongo filters + sort + page/limit; combined filters are ANDed
const parseListParams = (rawQuery) => {
  const keys = Object.keys(rawQuery);
  const hasInvalidKey = keys.some((key) => !VALID_QUERY_KEYS.has(key));
  if (hasInvalidKey) {
    return { error: { statusCode: 422, message: "Invalid query parameters" } };
  }

  for (const key of keys) {
    if (Array.isArray(rawQuery[key])) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
  }

  const filters = {};
  const range = {};

  if (rawQuery.gender !== undefined) {
    if (typeof rawQuery.gender !== "string" || !rawQuery.gender.trim()) {
      return { error: { statusCode: 400, message: "Missing or empty parameter" } };
    }
    const normalizedGender = rawQuery.gender.toLowerCase().trim();
    if (!["male", "female"].includes(normalizedGender)) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    filters.gender = normalizedGender;
  }

  if (rawQuery.age_group !== undefined) {
    if (typeof rawQuery.age_group !== "string" || !rawQuery.age_group.trim()) {
      return { error: { statusCode: 400, message: "Missing or empty parameter" } };
    }
    const normalizedAgeGroup = rawQuery.age_group.toLowerCase().trim();
    if (!AGE_GROUPS.has(normalizedAgeGroup)) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    filters.age_group = normalizedAgeGroup;
  }

  if (rawQuery.country_id !== undefined) {
    if (typeof rawQuery.country_id !== "string" || !rawQuery.country_id.trim()) {
      return { error: { statusCode: 400, message: "Missing or empty parameter" } };
    }
    const normalizedCountryId = rawQuery.country_id.toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(normalizedCountryId)) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    filters.country_id = normalizedCountryId;
  }

  if (rawQuery.min_age !== undefined) {
    const minAge = toStrictNumber(rawQuery.min_age, 0, 150);
    if (minAge === null) return { error: { statusCode: 422, message: "Invalid query parameters" } };
    range.min_age = minAge;
  }

  if (rawQuery.max_age !== undefined) {
    const maxAge = toStrictNumber(rawQuery.max_age, 0, 150);
    if (maxAge === null) return { error: { statusCode: 422, message: "Invalid query parameters" } };
    range.max_age = maxAge;
  }

  if (range.min_age !== undefined || range.max_age !== undefined) {
    if (
      range.min_age !== undefined &&
      range.max_age !== undefined &&
      range.min_age > range.max_age
    ) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    filters.age = {};
    if (range.min_age !== undefined) filters.age.$gte = range.min_age;
    if (range.max_age !== undefined) filters.age.$lte = range.max_age;
  }

  if (rawQuery.min_gender_probability !== undefined) {
    const minGenderProbability = toStrictNumber(rawQuery.min_gender_probability, 0, 1);
    if (minGenderProbability === null) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    filters.gender_probability = { $gte: minGenderProbability };
  }

  if (rawQuery.min_country_probability !== undefined) {
    const minCountryProbability = toStrictNumber(rawQuery.min_country_probability, 0, 1);
    if (minCountryProbability === null) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    filters.country_probability = { $gte: minCountryProbability };
  }

  let sortBy = "created_at";
  if (rawQuery.sort_by !== undefined) {
    if (typeof rawQuery.sort_by !== "string" || !rawQuery.sort_by.trim()) {
      return { error: { statusCode: 400, message: "Missing or empty parameter" } };
    }
    if (!SORTABLE_FIELDS.has(rawQuery.sort_by.trim())) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    sortBy = rawQuery.sort_by.trim();
  }

  let order = "desc";
  if (rawQuery.order !== undefined) {
    if (typeof rawQuery.order !== "string" || !rawQuery.order.trim()) {
      return { error: { statusCode: 400, message: "Missing or empty parameter" } };
    }
    const normalizedOrder = rawQuery.order.toLowerCase().trim();
    if (!SORT_ORDERS.has(normalizedOrder)) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    order = normalizedOrder;
  }

  let page = 1;
  if (rawQuery.page !== undefined) {
    const parsedPage = toStrictNumber(rawQuery.page, 1);
    if (parsedPage === null || !Number.isInteger(parsedPage)) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    page = parsedPage;
  }

  let limit = 10;
  if (rawQuery.limit !== undefined) {
    const parsedLimit = toStrictNumber(rawQuery.limit, 1, 50);
    if (parsedLimit === null || !Number.isInteger(parsedLimit)) {
      return { error: { statusCode: 422, message: "Invalid query parameters" } };
    }
    limit = parsedLimit;
  }

  const sort = { [sortBy]: order === "asc" ? 1 : -1 };
  return { filters, page, limit, sort };
};

// NL_SEARCH — rule-based only (no LLM); returns Mongo filter object + optional country phrase for lookup
const parseNaturalLanguageQuery = (queryText) => {
  if (typeof queryText !== "string" || !queryText.trim()) return null;
  const text = queryText.toLowerCase().trim().replace(/\s+/g, " ");
  const filters = {};
  let interpreted = false;
  let countryName = null;

  if (/\byoung\b/.test(text)) {
    filters.age = { ...(filters.age || {}), $gte: 16, $lte: 24 };
    interpreted = true;
  }

  if (/\bteen(ager|agers|age|ages)?\b/.test(text)) {
    filters.age_group = "teenager";
    interpreted = true;
  } else if (/\bchild(ren)?\b/.test(text)) {
    filters.age_group = "child";
    interpreted = true;
  } else if (/\badult(s)?\b/.test(text)) {
    filters.age_group = "adult";
    interpreted = true;
  } else if (/\bsenior(s)?\b/.test(text)) {
    filters.age_group = "senior";
    interpreted = true;
  }

  const hasMale = /\bmale(s)?\b/.test(text) || /\bman\b/.test(text) || /\bmen\b/.test(text);
  const hasFemale = /\bfemale(s)?\b/.test(text) || /\bwoman\b/.test(text) || /\bwomen\b/.test(text);

  if (hasMale && !hasFemale) {
    filters.gender = "male";
    interpreted = true;
  } else if (!hasMale && hasFemale) {
    filters.gender = "female";
    interpreted = true;
  }

  const aboveMatch = text.match(/\b(?:above|over|older than|at least|min(?:imum)? age)\s+(\d{1,3})\b/);
  if (aboveMatch) {
    const minAge = Number(aboveMatch[1]);
    if (Number.isInteger(minAge) && minAge >= 0 && minAge <= 150) {
      filters.age = { ...(filters.age || {}), $gte: minAge };
      interpreted = true;
    }
  }

  const belowMatch = text.match(/\b(?:below|under|younger than|at most|max(?:imum)? age)\s+(\d{1,3})\b/);
  if (belowMatch) {
    const maxAge = Number(belowMatch[1]);
    if (Number.isInteger(maxAge) && maxAge >= 0 && maxAge <= 150) {
      filters.age = { ...(filters.age || {}), $lte: maxAge };
      interpreted = true;
    }
  }

  const fromMatch = text.match(
    /\bfrom\s+([a-z\s]+?)(?=\s+(?:above|over|older than|at least|below|under|younger than|at most)\b|$)/
  );
  if (fromMatch) {
    countryName = fromMatch[1].trim();
    if (countryName) {
      interpreted = true;
    }
  }

  if (filters.age && filters.age.$gte !== undefined && filters.age.$lte !== undefined) {
    if (filters.age.$gte > filters.age.$lte) return null;
  }

  return interpreted ? { filters, countryName } : null;
};

// LIST — paginated response shape required by assignment
const listProfiles = async (res, params) => {
  const { filters, page, limit, sort } = params;
  const skip = (page - 1) * limit;
  const [total, profiles] = await Promise.all([
    Profile.countDocuments(filters),
    Profile.find(filters).sort(sort).skip(skip).limit(limit)
  ]);

  return res.status(200).json({
    status: "success",
    page,
    limit,
    total,
    data: profiles.map(buildProfileResponse)
  });
};

// ROUTES — POST create from upstream APIs (UUID v7 id)
app.post("/api/profiles", async (req, res) => {
  try {
    const { name } = req.body || {};

    if (name === undefined) {
      return sendError(res, 400, "Missing or empty name");
    }
    if (typeof name !== "string") {
      return sendError(res, 422, "Invalid type");
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      return sendError(res, 400, "Missing or empty name");
    }

    const existing = await Profile.findOne({ name: trimmedName }).collation({
      locale: "en",
      strength: 2
    });
    if (existing) {
      return res.status(200).json({
        status: "success",
        message: "Profile already exists",
        data: buildProfileResponse(existing)
      });
    }

    const [genderize, agify, nationalize] = await Promise.all([
      fetchExternalApi(
        "Genderize",
        `${API.genderize}?name=${encodeURIComponent(trimmedName)}`
      ),
      fetchExternalApi("Agify", `${API.agify}?name=${encodeURIComponent(trimmedName)}`),
      fetchExternalApi(
        "Nationalize",
        `${API.nationalize}?name=${encodeURIComponent(trimmedName)}`
      )
    ]);

    if (genderize.gender === null || Number(genderize.count || 0) === 0) {
      return sendError(res, 502, "Genderize returned an invalid response");
    }

    if (agify.age === null || agify.age === undefined) {
      return sendError(res, 502, "Agify returned an invalid response");
    }

    const topCountry = getTopCountry(nationalize.country);
    if (!topCountry) {
      return sendError(res, 502, "Nationalize returned an invalid response");
    }

    const newProfile = await Profile.create({
      id: uuidv7(),
      name: trimmedName,
      gender: String(genderize.gender).toLowerCase(),
      gender_probability: Number(genderize.probability || 0),
      age: Number(agify.age),
      age_group: classifyAgeGroup(Number(agify.age)),
      country_id: String(topCountry.country_id).toUpperCase(),
      country_name: getCountryNameFromCode(topCountry.country_id),
      country_probability: Number(topCountry.probability || 0),
      created_at: new Date()
    });

    return res.status(201).json({
      status: "success",
      data: buildProfileResponse(newProfile)
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.name) {
      const existing = await Profile.findOne({ name: String(req.body?.name || "").trim() }).collation({
        locale: "en",
        strength: 2
      });
      if (existing) {
        return res.status(200).json({
          status: "success",
          message: "Profile already exists",
          data: buildProfileResponse(existing)
        });
      }
    }
    if (error?.statusCode) {
      return sendError(res, error.statusCode, error.message);
    }
    return sendError(res, 500, "Internal server error");
  }
});

// ROUTES — GET list: advanced filters + sort + pagination
app.get("/api/profiles", async (req, res) => {
  try {
    const parsed = parseListParams(req.query);
    if (parsed.error) {
      return sendError(res, parsed.error.statusCode, parsed.error.message);
    }
    return await listProfiles(res, parsed);
  } catch (error) {
    return sendError(res, 500, "Internal server error");
  }
});

// ROUTES — GET natural language search (must be registered before /api/profiles/:id)
app.get("/api/profiles/search", async (req, res) => {
  try {
    const { q, page, limit } = req.query;

    if (q === undefined || (typeof q === "string" && !q.trim())) {
      return sendError(res, 400, "Missing or empty parameter");
    }
    if (Array.isArray(q) || typeof q !== "string") {
      return sendError(res, 422, "Invalid query parameters");
    }
    if ((page !== undefined && Array.isArray(page)) || (limit !== undefined && Array.isArray(limit))) {
      return sendError(res, 422, "Invalid query parameters");
    }

    const parsedTextQuery = parseNaturalLanguageQuery(q);
    if (!parsedTextQuery) {
      return sendError(res, 422, "Unable to interpret query");
    }

    const parsedPagination = parseListParams({ page, limit });
    if (parsedPagination.error) {
      return sendError(res, parsedPagination.error.statusCode, parsedPagination.error.message);
    }

    const searchFilters = { ...parsedTextQuery.filters };
    if (parsedTextQuery.countryName) {
      const escaped = parsedTextQuery.countryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const countryMatch = await Profile.findOne({
        country_name: new RegExp(`^${escaped}$`, "i")
      }).select({ country_id: 1, _id: 0 });
      if (countryMatch?.country_id) {
        searchFilters.country_id = countryMatch.country_id;
      }
    }

    return await listProfiles(res, {
      filters: searchFilters,
      page: parsedPagination.page,
      limit: parsedPagination.limit,
      sort: { created_at: -1 }
    });
  } catch (error) {
    return sendError(res, 500, "Internal server error");
  }
});

// ROUTES — GET one by UUID v7 `id` field (not Mongo _id)
app.get("/api/profiles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return sendError(res, 404, "Profile not found");
    }

    const profile = await Profile.findOne({ id });
    if (!profile) {
      return sendError(res, 404, "Profile not found");
    }

    return res.status(200).json({
      status: "success",
      data: buildProfileResponse(profile)
    });
  } catch (error) {
    return sendError(res, 500, "Internal server error");
  }
});

// ROUTES — DELETE by UUID v7 `id`
app.delete("/api/profiles/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) {
      return sendError(res, 404, "Profile not found");
    }
    const deleted = await Profile.findOneAndDelete({ id });
    if (!deleted) {
      return sendError(res, 404, "Profile not found");
    }
    return res.status(204).send();
  } catch (error) {
    return sendError(res, 500, "Internal server error");
  }
});

// BOOT — Mongo connect, migrate legacy indexes, listen
const startServer = async () => {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }
  await mongoose.connect(MONGODB_URI);
  await dropLegacyIndexes();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

// ENTRYPOINT
startServer().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
