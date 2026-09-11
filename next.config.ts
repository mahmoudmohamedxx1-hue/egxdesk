import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* Task 20: ignoreBuildErrors removed — the production build must fail
   * loudly on type errors instead of shipping them (tsc is clean). */
  reactStrictMode: false,
};

export default nextConfig;
