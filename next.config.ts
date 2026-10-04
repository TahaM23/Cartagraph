import type { NextConfig } from "next";
import { checkEnv } from "./lib/env";

// Fail on boot rather than three screens later.
checkEnv();

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
