require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const { v7: uuidv7 } = require("uuid");

const MONGODB_URI = process.env.MONGODB_URI;
const SEED_FILE = process.env.SEED_FILE || path.join(__dirname, "seed_profiles.json");

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

const Profile = mongoose.model("Profile", profileSchema);

const dropLegacyIndexes = async () => {
  const indexes = await Profile.collection.indexes();
  const legacyIndexNames = indexes
    .map((index) => index.name)
    .filter((name) => name === "normalized_name_1");

  for (const indexName of legacyIndexNames) {
    await Profile.collection.dropIndex(indexName);
  }
};

const assertProfileShape = (profile, index) => {
  const requiredFields = [
    "name",
    "gender",
    "gender_probability",
    "age",
    "age_group",
    "country_id",
    "country_name",
    "country_probability"
  ];

  for (const field of requiredFields) {
    if (profile[field] === undefined || profile[field] === null || profile[field] === "") {
      throw new Error(`Invalid seed profile at index ${index}: missing ${field}`);
    }
  }
};

const run = async () => {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }

  const content = await fs.readFile(SEED_FILE, "utf8");
  const parsed = JSON.parse(content);
  const profiles = Array.isArray(parsed?.profiles) ? parsed.profiles : [];

  if (profiles.length !== 2026) {
    throw new Error(`Expected 2026 profiles, found ${profiles.length}`);
  }

  profiles.forEach(assertProfileShape);

  await mongoose.connect(MONGODB_URI);
  await dropLegacyIndexes();

  const operations = profiles.map((profile) => ({
    updateOne: {
      filter: { name: String(profile.name).trim() },
      update: {
        $set: {
          gender: String(profile.gender).toLowerCase(),
          gender_probability: Number(profile.gender_probability),
          age: Number(profile.age),
          age_group: String(profile.age_group).toLowerCase(),
          country_id: String(profile.country_id).toUpperCase(),
          country_name: String(profile.country_name).trim(),
          country_probability: Number(profile.country_probability)
        },
        $setOnInsert: {
          id: uuidv7(),
          created_at: new Date()
        }
      },
      upsert: true
    }
  }));

  const result = await Profile.bulkWrite(operations, { ordered: false });

  console.log(
    JSON.stringify(
      {
        status: "success",
        matched: result.matchedCount,
        modified: result.modifiedCount,
        inserted: result.upsertedCount,
        total_processed: profiles.length
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
