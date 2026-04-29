const crypto = require("crypto");

const challengeFromVerifier = (codeVerifier) => {
  return crypto.createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
};

module.exports = { challengeFromVerifier };
