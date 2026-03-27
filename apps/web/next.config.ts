import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve ??= {};
      const alias = config.resolve.alias ?? {};
      config.resolve.alias = {
        ...alias,
        "expo-application": path.resolve(__dirname, "src/shims/expo-application.ts"),
      };
    }
    return config;
  },
};

export default nextConfig;
