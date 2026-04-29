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
    if (countryName) interpreted = true;
  }

  if (filters.age && filters.age.$gte !== undefined && filters.age.$lte !== undefined) {
    if (filters.age.$gte > filters.age.$lte) return null;
  }

  return interpreted ? { filters, countryName } : null;
};

module.exports = { parseNaturalLanguageQuery };
