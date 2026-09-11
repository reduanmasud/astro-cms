/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Where Vite forwards /api in development. Docker Compose points this at the
// server container; locally it is the server started by `pnpm dev`.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
