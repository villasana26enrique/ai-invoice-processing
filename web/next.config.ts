import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone: the Docker image only copies that
  output: "standalone",
  experimental: {
    // Invoices are uploaded through a server action; scans can be a few MB
    serverActions: { bodySizeLimit: "15mb" },
  },
};

export default nextConfig;
