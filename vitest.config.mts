import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: { JWT_SECRET: "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz", DATABASE_URL: "postgresql://test@127.0.0.1:1/test" },
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts", "src/proxy.ts"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 60, statements: 60, functions: 60, branches: 55 },
    },
  },
});
