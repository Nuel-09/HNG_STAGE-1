// normalize the query to a more efficient query

const ALLOWED_TOP_LEVEL_KEYS = [
  "gender",
  "age_group",
  "country_id",
  "age",
  "gender_probability",
  "country_probability",
];

// normalize the age object to a more efficient query
const normalizeAgeObject = (age) => {
  if (!age || typeof age !== "object" || Array.isArray(age)) return undefined;
  const normalized = {};
  if (typeof age.$gte === "number" && Number.isFinite(age.$gte))
    normalized.$gte = age.$gte;
  if (typeof age.$lte === "number" && Number.isFinite(age.$lte))
    normalized.$lte = age.$lte;
  if (
    normalized.$gte !== undefined &&
    normalized.$lte !== undefined &&
    normalized.$gte > normalized.$lte
  ) {
    // Keep deterministic and safe; caller can decide if this should be rejected earlier.
    return undefined;
  }
  return Object.keys(normalized).length ? normalized : undefined;
};

// normalize the min probability object to a more efficient query
const normalizeMinProbabilityObject = (obj) => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  if (typeof obj.$gte !== "number" || !Number.isFinite(obj.$gte))
    return undefined;
  return { $gte: obj.$gte };
};
// normalize the filters to a more efficient query
const normalizeFilters = (filters = {}) => {
  const canonical = {};
  // fixed key order -> deterministic object shape
  for (const key of ALLOWED_TOP_LEVEL_KEYS) {
    const value = filters[key];
    if (value === undefined) continue;
    if (key === "gender" || key === "age_group") {
      canonical[key] = String(value).trim().toLowerCase();
      continue;
    }
    if (key === "country_id") {
      canonical[key] = String(value).trim().toUpperCase();
      continue;
    }
    if (key === "age") {
      const normalizedAge = normalizeAgeObject(value);
      if (normalizedAge) canonical.age = normalizedAge;
      continue;
    }
    if (key === "gender_probability" || key === "country_probability") {
      const normalizedProb = normalizeMinProbabilityObject(value);
      if (normalizedProb) canonical[key] = normalizedProb;
    }
  }
  return canonical;
};
// stable stringify the query to a more efficient query
const stableStringify = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`,
  );
  return `{${pairs.join(",")}}`;
};
// build the canonical query key to a more efficient query
const buildCanonicalQueryKey = ({ filters, page, limit, sort }) => {
  const normalizedFilters = normalizeFilters(filters);
  return stableStringify({
    filters: normalizedFilters,
    page,
    limit,
    sort,
  });
};
module.exports = {
  normalizeFilters,
  stableStringify,
  buildCanonicalQueryKey,
};