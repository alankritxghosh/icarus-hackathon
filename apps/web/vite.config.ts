import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // In development the picture service is the edge Worker (`pnpm --filter @icarus/edge dev`, port 8789).
  server: { proxy: { "/api": process.env.ICARUS_EDGE ?? "http://localhost:8789" } },
});
