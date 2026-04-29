const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
  {
    token_hash: { type: String, required: true, unique: true },
    user_id: { type: String, required: true, index: true },
    expires_at: { type: Date, required: true },
    created_at: { type: Date, required: true, default: () => new Date() }
  },
  { versionKey: false }
);

refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const RefreshToken =
  mongoose.models.RefreshToken || mongoose.model("RefreshToken", refreshTokenSchema);

module.exports = { RefreshToken };
