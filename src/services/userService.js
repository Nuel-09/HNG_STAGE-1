const { v7: uuidv7 } = require("uuid");
const { User } = require("../models/user");
const { ADMIN_GITHUB_IDS } = require("../config/env");

const upsertUserFromGithub = async (ghUser, email) => {
  const github_id = String(ghUser.id);
  let user = await User.findOne({ github_id });
  const promoteAdmin = ADMIN_GITHUB_IDS.includes(github_id);

  if (!user) {
    user = await User.create({
      id: uuidv7(),
      github_id,
      username: ghUser.login,
      email: email || "",
      avatar_url: ghUser.avatar_url || "",
      role: promoteAdmin ? "admin" : "analyst",
      is_active: true,
      last_login_at: new Date(),
      created_at: new Date()
    });
    return user;
  }

  user.username = ghUser.login;
  user.email = email || user.email;
  user.avatar_url = ghUser.avatar_url || user.avatar_url;
  if (promoteAdmin) user.role = "admin";
  user.last_login_at = new Date();
  await user.save();
  return user;
};

module.exports = { upsertUserFromGithub };
