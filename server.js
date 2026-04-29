const mongoose = require("mongoose");
const app = require("./src/app");
const { PORT, MONGODB_URI } = require("./src/config/env");
const { dropLegacyIndexes } = require("./src/models/profile");
require("./src/models/user");
require("./src/models/refreshToken");
require("./src/models/oauthState");

const startServer = async () => {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI is required");
  }

  await mongoose.connect(MONGODB_URI);
  await dropLegacyIndexes();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
