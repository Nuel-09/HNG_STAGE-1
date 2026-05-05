const fs = require("fs/promises");
const { validate: isUuid } = require("uuid");
const { UPSTREAM_TIMEOUT_MS } = require("../config/env");
const { sendError, buildProfileResponse } = require("../utils/http");
const { parseListParams } = require("../services/queryService");
const { parseNaturalLanguageQuery } = require("../services/nlSearchService");
const {
  normalizeFilters,
  buildCanonicalQueryKey,
} = require("../services/queryNormalizationService");
const {
  getCached,
  setCached,
  clearByPrefix,
} = require("../services/queryCacheService");
const {
  ingestProfilesCsv,
  CsvImportCapacityError,
} = require("../services/csvIngestionService");
const {
  listProfiles,
  streamProfilesCsv,
  findProfileById,
  createProfileFromName,
  resolveDuplicateCreate,
  deleteProfileById,
  resolveCountryIdByName,
} = require("../services/profileService");

const invalidateProfileQueryCaches = () => {
  clearByPrefix("profiles:list:");
  clearByPrefix("profiles:search:");
};

const createProfile = async (req, res) => {
  try {
    const { name } = req.body || {};
    if (name === undefined || (typeof name === "string" && !name.trim())) {
      return sendError(res, 400, "Missing or empty name");
    }
    if (typeof name !== "string") return sendError(res, 422, "Invalid type");

    const result = await createProfileFromName(name, UPSTREAM_TIMEOUT_MS);
    if (result.statusCode === 201) invalidateProfileQueryCaches();
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.name) {
      const duplicate = await resolveDuplicateCreate(req.body?.name);
      if (duplicate)
        return res.status(duplicate.statusCode).json(duplicate.body);
    }
    if (error?.statusCode)
      return sendError(res, error.statusCode, error.message);
    return sendError(res, 500, "Internal server error");
  }
};

const getProfiles = async (req, res) => {
  try {
    const parsed = parseListParams(req.query);
    if (parsed.error)
      return sendError(res, parsed.error.statusCode, parsed.error.message);

    const canonicalFilters = normalizeFilters(parsed.filters);
    const cacheKey = `profiles:list:${buildCanonicalQueryKey({
      filters: canonicalFilters,
      page: parsed.page,
      limit: parsed.limit,
      sort: parsed.sort,
    })}`;
    const cached = getCached(cacheKey);
    if (cached) return res.status(200).json(cached);

    const basePath = `${req.baseUrl}${req.path}`;
    const response = await listProfiles(
      { ...parsed, filters: canonicalFilters },
      { basePath, query: req.query },
    );
    setCached(cacheKey, response);
    return res.status(200).json(response);
  } catch {
    return sendError(res, 500, "Internal server error");
  }
};

const exportProfiles = async (req, res) => {
  try {
    const fmt = req.query.format;
    if (fmt === undefined || fmt === "") {
      return sendError(res, 400, "Missing or empty parameter");
    }
    if (Array.isArray(fmt) || fmt !== "csv") {
      return sendError(res, 422, "Invalid query parameters");
    }

    const { format: _omit, ...queryWithoutFormat } = req.query;
    const parsed = parseListParams(queryWithoutFormat);
    if (parsed.error)
      return sendError(res, parsed.error.statusCode, parsed.error.message);

    await streamProfilesCsv(res, {
      filters: parsed.filters,
      sort: parsed.sort,
    });
  } catch {
    if (!res.headersSent) {
      return sendError(res, 500, "Internal server error");
    }
  }
};

const searchProfiles = async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    if (q === undefined || (typeof q === "string" && !q.trim())) {
      return sendError(res, 400, "Missing or empty parameter");
    }
    if (Array.isArray(q) || typeof q !== "string") {
      return sendError(res, 422, "Invalid query parameters");
    }
    if (
      (page !== undefined && Array.isArray(page)) ||
      (limit !== undefined && Array.isArray(limit))
    ) {
      return sendError(res, 422, "Invalid query parameters");
    }

    const parsedText = parseNaturalLanguageQuery(q);
    if (!parsedText) return sendError(res, 422, "Unable to interpret query");

    const parsedPagination = parseListParams({ page, limit });
    if (parsedPagination.error) {
      return sendError(
        res,
        parsedPagination.error.statusCode,
        parsedPagination.error.message,
      );
    }

    const searchFilters = { ...parsedText.filters };
    if (parsedText.countryName) {
      const countryId = await resolveCountryIdByName(parsedText.countryName);
      if (countryId) searchFilters.country_id = countryId;
    }

    const canonicalFilters = normalizeFilters(searchFilters);
    const sort = { created_at: -1 };
    const cacheKey = `profiles:search:${buildCanonicalQueryKey({
      filters: canonicalFilters,
      page: parsedPagination.page,
      limit: parsedPagination.limit,
      sort,
    })}`;
    const cached = getCached(cacheKey);
    if (cached) return res.status(200).json(cached);

    const basePath = `${req.baseUrl}${req.path}`;
    const response = await listProfiles(
      {
        filters: canonicalFilters,
        page: parsedPagination.page,
        limit: parsedPagination.limit,
        sort,
      },
      { basePath, query: req.query },
    );
    setCached(cacheKey, response);
    return res.status(200).json(response);
  } catch {
    return sendError(res, 500, "Internal server error");
  }
};

const getProfileById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return sendError(res, 404, "Profile not found");
    const profile = await findProfileById(id);
    if (!profile) return sendError(res, 404, "Profile not found");
    return res
      .status(200)
      .json({ status: "success", data: buildProfileResponse(profile) });
  } catch {
    return sendError(res, 500, "Internal server error");
  }
};

const deleteProfile = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isUuid(id)) return sendError(res, 404, "Profile not found");
    const deleted = await deleteProfileById(id);
    if (!deleted) return sendError(res, 404, "Profile not found");
    invalidateProfileQueryCaches();
    return res.status(204).send();
  } catch {
    return sendError(res, 500, "Internal server error");
  }
};

const importProfilesCsv = async (req, res) => {
  const filePath = req.file?.path;
  if (!filePath) return sendError(res, 400, "Missing CSV file");

  try {
    const summary = await ingestProfilesCsv(filePath);
    invalidateProfileQueryCaches();
    return res.status(200).json(summary);
  } catch (error) {
    if (error instanceof CsvImportCapacityError) {
      return sendError(res, 429, error.message);
    }
    if (
      error?.message?.includes("Invalid Opening Quote") ||
      error?.message?.includes("Parse Error")
    ) {
      return sendError(res, 422, "Invalid CSV format");
    }
    return sendError(res, 500, "Internal server error");
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
};

module.exports = {
  createProfile,
  getProfiles,
  exportProfiles,
  importProfilesCsv,
  searchProfiles,
  getProfileById,
  deleteProfile,
};
