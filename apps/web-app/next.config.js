/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["@farcaster/mini-app-solana"] = path.resolve(
      __dirname,
      "shims/farcaster-mini-app-solana.ts"
    );
    return config;
  }
};

module.exports = nextConfig;
