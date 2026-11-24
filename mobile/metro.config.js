const { getDefaultConfig } = require("expo/metro-config");

// NativeWind is switched off (see babel.config.js): its runtime wrapped every
// Pressable on iOS and dropped function styles. Restore withNativeWind(config,
// { input: "./global.css" }) and the global.css import in src/app/_layout.tsx
// only together with a fix for that.
module.exports = getDefaultConfig(__dirname);
