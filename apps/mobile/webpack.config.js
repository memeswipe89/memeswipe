const { createExpoWebpackConfigAsync } = require('@expo/webpack-config');
const path = require('path');

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);
  config.resolve.alias = {
    ...(config.resolve.alias || {}),
    '@privy-io/js-sdk-core/node_modules/uuid/wrapper.mjs': path.resolve(__dirname, 'web/uuid-wrapper.mjs'),
  };
  return config;
};
