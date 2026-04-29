const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    github_id: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    email: { type: String, default: "" },
    avatar_url: { type: String, default: "" },
    role: { type: String, required: true, enum: ["admin", "analyst"], default: "analyst" },
    is_active: { type: Boolean, required: true, default: true },
    last_login_at: { type: Date },
    created_at: { type: Date, required: true, default: () => new Date() }
  },
  { versionKey: false }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = { User };
