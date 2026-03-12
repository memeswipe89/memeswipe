if (!Array.prototype.toReversed) {
  Object.defineProperty(Array.prototype, 'toReversed', {
    value: function toReversed() {
      return [...this].reverse();
    },
    writable: true,
    configurable: true,
  });
}
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.alias = {
  ...(config.resolver.alias || {}),
  'jose/node': 'jose/browser',
  'jose/dist/node': 'jose/dist/browser',
  '@privy-io/js-sdk-core/node_modules/uuid/wrapper.mjs': path.resolve(
    __dirname,
    'web/uuid-wrapper.mjs'
  ),
  'expo-application': path.resolve(__dirname, 'web/expo-application-stub.js'),
};
config.resolver.unstable_enablePackageExports = false;

config.resolver.extraNodeModules = {
  crypto: require.resolve('expo-crypto'),
  stream: require.resolve('stream-browserify'),
  buffer: require.resolve('buffer'),
  process: require.resolve('process/browser'),
};

module.exports = config;
