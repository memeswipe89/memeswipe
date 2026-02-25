// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    settings: {
      'import/resolver': {
        node: {
          // Support running lint from monorepo root and from apps/mobile.
          moduleDirectory: ['node_modules', 'apps/mobile/node_modules'],
        },
      },
    },
  },
]);
