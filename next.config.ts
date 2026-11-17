import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/adapter-pg", "@prisma/client"],
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // camera/mic off; screen-wake-lock allowed for cook-along mode.
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), screen-wake-lock=(self)" },
      ],
    },
  ],
  experimental: { optimizePackageImports: ["lucide-react"] },
};

export default nextConfig;
