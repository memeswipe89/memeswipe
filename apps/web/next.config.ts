import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {}, // 👈 disables warning
  webpack(config) {
    // 🔥 PRIORITY override (this is key)
    config.resolve.modules = [
      path.resolve(__dirname, "src/shims"),
      "node_modules",
    ];

    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "expo-application": path.resolve(
        __dirname,
        "src/shims/expo-application.ts"
      ),
      "expo-application/build/Application": path.resolve(
        __dirname,
        "src/shims/expo-application.ts"
      ),
    };

    return config;
  },
};

export default nextConfig;