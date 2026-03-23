const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Prefer browser/react-native export conditions so packages like jose
// resolve their web builds instead of Node-only builds.
config.resolver.unstable_conditionNames = [
  'react-native',
  'browser',
  'require',
  'default',
];

config.resolver.unstable_enablePackageExports = true;

module.exports = config;
