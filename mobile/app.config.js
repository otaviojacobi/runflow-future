// Dynamic layer over app.json. Firebase's google-services.json (Android push through FCM, X10) stays out of the
// repo: EAS builds get it from the project's file environment variable GOOGLE_SERVICES_JSON (eas env:create
// --type file); a local copy at mobile/google-services.json (git-ignored) works for local builds. Without either,
// the app runs and says phone push isn't configured (lib/push.ts).
const fs = require("node:fs");
const path = require("node:path");

module.exports = ({ config }) => {
  const local = path.join(__dirname, "google-services.json");
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? "./google-services.json" : undefined);
  return { ...config, android: { ...config.android, ...(googleServicesFile && { googleServicesFile }) } };
};
