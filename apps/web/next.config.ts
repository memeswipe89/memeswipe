import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "expo-application$": path.resolve(
        __dirname,
        "src/polyfills/expo-application.ts"
      ),
    };
    return config;
  },
};

export default nextConfig;
