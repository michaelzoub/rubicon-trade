import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  distDir: process.env.RUBICON_BUILD_DIR || ".next",
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
