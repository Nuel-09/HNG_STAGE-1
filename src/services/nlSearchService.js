const MIN_AGE = 0;
const MAX_AGE = 150;
const COUNTRY_STOP_WORDS =
  "(?:aged|age|between|from|in|at least|minimum age|min age|min|at most|maximum age|max age|max|above|over|older than|below|under|younger than|with|whose|where|who|that|and|or)";

const inAgeBounds = (value) =>
  Number.isInteger(value) && value >= MIN_AGE && value <= MAX_AGE;

const COUNTRY_ALIASES = {
  burkinafaso: "burkina faso",
  "burkina-faso": "burkina faso",
  usa: "united states",
  us: "united states",
  uk: "united kingdom",
  uae: "united arab emirates",
  "ivory coast": "cote d'ivoire",
  "cote divoire": "cote d'ivoire",
  "cote d ivoire": "cote d'ivoire"
};

const mergeAgeConstraint = (filters, nextAge) => {
  const current = filters.age || {};
  const merged = { ...current };

  if (nextAge.$gte !== undefined) {
    merged.$gte =
      merged.$gte === undefined
        ? nextAge.$gte
        : Math.max(merged.$gte, nextAge.$gte);
  }
  if (nextAge.$lte !== undefined) {
    merged.$lte =
      merged.$lte === undefined
        ? nextAge.$lte
        : Math.min(merged.$lte, nextAge.$lte);
  }

  if (
    merged.$gte !== undefined &&
    merged.$lte !== undefined &&
    merged.$gte > merged.$lte
  )
    return false;
  filters.age = merged;
  return true;
};

const extractCountryName = (text) => {
  const patterns = [
    new RegExp(
      `\\b(?:from|in)\\s+([a-z][a-z\\s-]{1,60}?)(?=\\s+${COUNTRY_STOP_WORDS}\\b|\\s+\\d{1,3}\\b|$)`,
    ),
    /\bliving in\s+([a-z][a-z\s-]{1,60}?)(?=\s+\b(?:aged|age|between|above|over|under|below)\b|\s+\d{1,3}\b|$)/,
    /\bof\s+([a-z][a-z\s-]{1,60}?)(?=\s+\b(?:aged|age|between|above|over|under|below)\b|\s+\d{1,3}\b|$)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = String(match?.[1] || "")
      .replace(/\s+/g, " ")
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    if (!candidate) continue;

    const aliasKey = candidate.toLowerCase().replace(/\s+/g, " ").trim();
    const compactKey = aliasKey.replace(/[\s-]/g, "");
    const normalized =
      COUNTRY_ALIASES[aliasKey] ||
      COUNTRY_ALIASES[compactKey] ||
      COUNTRY_ALIASES[aliasKey.replace(/-/g, " ")] ||
      candidate;
    return normalized;
  }
  return null;
};

const parseNaturalLanguageQuery = (queryText) => {
  if (typeof queryText !== "string" || !queryText.trim()) return null;
  const text = queryText.toLowerCase().trim().replace(/\s+/g, " ");
  const filters = {};
  let interpreted = false;
  let countryName = null;

  if (/\byoung\b/.test(text)) {
    if (!mergeAgeConstraint(filters, { $gte: 16, $lte: 24 })) return null;
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

  const hasMale =
    /\bmale(s)?\b/.test(text) ||
    /\bman\b/.test(text) ||
    /\bmen\b/.test(text) ||
    /\bguy(s)?\b/.test(text);
  const hasFemale =
    /\bfemale(s)?\b/.test(text) ||
    /\bwoman\b/.test(text) ||
    /\bwomen\b/.test(text) ||
    /\blad(y|ies)\b/.test(text);
  if (hasMale && !hasFemale) {
    filters.gender = "male";
    interpreted = true;
  } else if (!hasMale && hasFemale) {
    filters.gender = "female";
    interpreted = true;
  }

  const rangePatterns = [
    /\b(?:aged?|age)\s+(\d{1,3})\s*(?:to|-)\s*(\d{1,3})\b/,
    /\bbetween\s+(\d{1,3})\s+and\s+(\d{1,3})\b/,
  ];
  for (const pattern of rangePatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (!inAgeBounds(first) || !inAgeBounds(second)) return null;
    const minAge = Math.min(first, second);
    const maxAge = Math.max(first, second);
    if (!mergeAgeConstraint(filters, { $gte: minAge, $lte: maxAge }))
      return null;
    interpreted = true;
    break;
  }

  const aboveMatch = text.match(
    /\b(?:above|over|older than|at least|min(?:imum)? age|min age|min)\s+(\d{1,3})\b/,
  );
  if (aboveMatch) {
    const minAge = Number(aboveMatch[1]);
    if (!inAgeBounds(minAge)) return null;
    if (!mergeAgeConstraint(filters, { $gte: minAge })) return null;
    interpreted = true;
  }

  const belowMatch = text.match(
    /\b(?:below|under|younger than|at most|max(?:imum)? age|max age|max)\s+(\d{1,3})\b/,
  );
  if (belowMatch) {
    const maxAge = Number(belowMatch[1]);
    if (!inAgeBounds(maxAge)) return null;
    if (!mergeAgeConstraint(filters, { $lte: maxAge })) return null;
    interpreted = true;
  }

  countryName = extractCountryName(text);
  if (countryName) interpreted = true;

  return interpreted ? { filters, countryName } : null;
};

module.exports = { parseNaturalLanguageQuery };
