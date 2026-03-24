import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["expo-application"] = path.resolve(
      __dirname,
      "src/shims/expo-application.ts"
    );
    return config;
  },
};

export default nextConfig;
