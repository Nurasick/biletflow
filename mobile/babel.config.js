module.exports = function (api) {
  api.cache(true);

  // NativeWind's JSX transform is off: no component uses className, and on iOS its
  // Pressable wrapper drops function styles (style={({ pressed }) => ...}), which
  // broke every button and row layout. Re-enable with
  // ["babel-preset-expo", { jsxImportSource: "nativewind" }] plus "nativewind/babel"
  // only together with a fix for that.
  return {
    presets: ["babel-preset-expo"],
  };
};
