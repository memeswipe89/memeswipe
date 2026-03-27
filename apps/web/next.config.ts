import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack(config) {
    const polyfillPath = path.resolve(
      __dirname,
      "src/polyfills/expo-application.ts"
    );

    config.resolve.alias = {
      ...(config.resolve.alias || {}),

      // MAIN
      "expo-application": polyfillPath,

      // 🔥 CRITICAL (this is what you're missing)
      "expo-application/build/Application": polyfillPath,
    };

    return config;
  },
};

export default nextConfig;