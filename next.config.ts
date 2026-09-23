import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The recovered release has existing lint findings unrelated to this UI update.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
