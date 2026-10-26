import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // In development the picture service is the edge Worker (`pnpm --filter @icarus/edge dev`).
  server: { proxy: { "/api": "http://localhost:8788" } },
});
