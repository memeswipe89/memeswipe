import path from "path";
import type { NextConfig } from "next";

type NextConfigWithTurbo = NextConfig & {
  turbo?: {
    root?: string;
  };
};

const nextConfig: NextConfigWithTurbo = {
  turbo: {
    root: ".",
  },
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
