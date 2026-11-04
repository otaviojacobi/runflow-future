// Expo's default Metro config, wrapped by Sentry so every bundle carries debug ids that match the source maps uploaded
// during EAS builds (readable stack traces in Sentry; docs.sentry.io/platforms/react-native/manual-setup/expo).
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
