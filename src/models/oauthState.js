const mongoose = require("mongoose");

const oauthStateSchema = new mongoose.Schema(
  {
    state: { type: String, required: true, unique: true },
    code_verifier: { type: String, required: true },
    expires_at: { type: Date, required: true }
  },
  { versionKey: false }
);

oauthStateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const OAuthState = mongoose.models.OAuthState || mongoose.model("OAuthState", oauthStateSchema);

module.exports = { OAuthState };
