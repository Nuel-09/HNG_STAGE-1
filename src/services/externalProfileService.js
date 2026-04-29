const API = require("../config/api");

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

const countryDisplay = new Intl.DisplayNames(["en"], { type: "region" });
const getCountryNameFromCode = (countryCode) => {
  try {
    return countryDisplay.of(String(countryCode || "").toUpperCase()) || "Unknown";
  } catch {
    return "Unknown";
  }
};

const fetchJsonWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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

const fetchExternalApi = async (apiName, url, timeoutMs) => {
  try {
    return await fetchJsonWithTimeout(url, timeoutMs);
  } catch (error) {
    const custom = new Error(`${apiName} returned an invalid response`);
    custom.statusCode = 502;
    throw custom;
  }
};

const fetchProfileSignals = async (name, timeoutMs) => {
  const [genderize, agify, nationalize] = await Promise.all([
    fetchExternalApi("Genderize", `${API.genderize}?name=${encodeURIComponent(name)}`, timeoutMs),
    fetchExternalApi("Agify", `${API.agify}?name=${encodeURIComponent(name)}`, timeoutMs),
    fetchExternalApi("Nationalize", `${API.nationalize}?name=${encodeURIComponent(name)}`, timeoutMs)
  ]);

  if (genderize.gender === null || Number(genderize.count || 0) === 0) {
    const err = new Error("Genderize returned an invalid response");
    err.statusCode = 502;
    throw err;
  }
  if (agify.age === null || agify.age === undefined) {
    const err = new Error("Agify returned an invalid response");
    err.statusCode = 502;
    throw err;
  }
  const topCountry = getTopCountry(nationalize.country);
  if (!topCountry) {
    const err = new Error("Nationalize returned an invalid response");
    err.statusCode = 502;
    throw err;
  }

  return {
    gender: String(genderize.gender).toLowerCase(),
    gender_probability: Number(genderize.probability || 0),
    age: Number(agify.age),
    age_group: classifyAgeGroup(Number(agify.age)),
    country_id: String(topCountry.country_id).toUpperCase(),
    country_name: getCountryNameFromCode(topCountry.country_id),
    country_probability: Number(topCountry.probability || 0)
  };
};

module.exports = { fetchProfileSignals };
