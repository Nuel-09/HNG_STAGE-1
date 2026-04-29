const { v7: uuidv7 } = require("uuid");
const { Profile } = require("../models/profile");
const { buildProfileResponse } = require("../utils/http");
const { buildPaginationLinks } = require("../utils/pagination");
const { fetchProfileSignals } = require("./externalProfileService");

const listProfiles = async ({ filters, page, limit, sort }, { basePath, query }) => {
  const skip = (page - 1) * limit;
  const [total, profiles] = await Promise.all([
    Profile.countDocuments(filters),
    Profile.find(filters).sort(sort).skip(skip).limit(limit)
  ]);

  const { total_pages, ...links } = buildPaginationLinks(basePath, query, page, limit, total);

  return {
    status: "success",
    page,
    limit,
    total,
    total_pages,
    links,
    data: profiles.map(buildProfileResponse)
  };
};

const streamProfilesCsv = async (res, { filters, sort }) => {
  const filename = `profiles_${Date.now()}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const header =
    "id,name,gender,gender_probability,age,age_group,country_id,country_name,country_probability,created_at\n";
  res.write(header);

  const esc = (v) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const cursor = Profile.find(filters).sort(sort).lean().cursor();
  for await (const doc of cursor) {
    const row = [
      esc(doc.id),
      esc(doc.name),
      esc(doc.gender),
      esc(doc.gender_probability),
      esc(doc.age),
      esc(doc.age_group),
      esc(doc.country_id),
      esc(doc.country_name),
      esc(doc.country_probability),
      esc(new Date(doc.created_at).toISOString())
    ].join(",");
    res.write(`${row}\n`);
  }
  res.end();
};

const findProfileById = async (id) => Profile.findOne({ id });

const findProfileByNameCaseInsensitive = async (name) =>
  Profile.findOne({ name }).collation({ locale: "en", strength: 2 });

const createProfileFromName = async (name, timeoutMs) => {
  const trimmedName = name.trim();
  const existing = await findProfileByNameCaseInsensitive(trimmedName);
  if (existing) {
    return {
      statusCode: 200,
      body: { status: "success", message: "Profile already exists", data: buildProfileResponse(existing) }
    };
  }

  const signals = await fetchProfileSignals(trimmedName, timeoutMs);
  const created = await Profile.create({
    id: uuidv7(),
    name: trimmedName,
    ...signals,
    created_at: new Date()
  });
  return { statusCode: 201, body: { status: "success", data: buildProfileResponse(created) } };
};

const resolveDuplicateCreate = async (name) => {
  const existing = await findProfileByNameCaseInsensitive(String(name || "").trim());
  if (!existing) return null;
  return {
    statusCode: 200,
    body: { status: "success", message: "Profile already exists", data: buildProfileResponse(existing) }
  };
};

const deleteProfileById = async (id) => Profile.findOneAndDelete({ id });

const resolveCountryIdByName = async (countryName) => {
  const escaped = countryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = await Profile.findOne({ country_name: new RegExp(`^${escaped}$`, "i") }).select({
    country_id: 1,
    _id: 0
  });
  return match?.country_id || null;
};

module.exports = {
  listProfiles,
  streamProfilesCsv,
  findProfileById,
  createProfileFromName,
  resolveDuplicateCreate,
  deleteProfileById,
  resolveCountryIdByName
};
