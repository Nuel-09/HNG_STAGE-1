const mongoose = require("mongoose");

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
// single index for each field
profileSchema.index({ gender: 1 });
profileSchema.index({ age_group: 1 });
profileSchema.index({ country_id: 1 });
profileSchema.index({ age: 1 });
profileSchema.index({ gender_probability: 1 });
profileSchema.index({ country_probability: 1 });
profileSchema.index({ created_at: -1 });

// Compound indexes for common list/search patterns (Stage 4B)
// Equality fields first, then range/sort as appropriate.
profileSchema.index({ country_id: 1, gender: 1, age: 1 });
profileSchema.index({ country_id: 1, created_at: -1 });
profileSchema.index({ gender: 1, age: 1 });

const Profile = mongoose.models.Profile || mongoose.model("Profile", profileSchema);

const dropLegacyIndexes = async () => {
  const indexes = await Profile.collection.indexes();
  const legacyIndexNames = indexes
    .map((index) => index.name)
    .filter((name) => name === "normalized_name_1");

  for (const indexName of legacyIndexNames) {
    await Profile.collection.dropIndex(indexName);
  }
};

module.exports = { Profile, dropLegacyIndexes };
