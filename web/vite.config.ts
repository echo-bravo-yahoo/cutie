import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `cutie serve-ui` runs the real backend on 127.0.0.1:4200 by default; `npm
// run dev` here proxies to it so the same fetch("/api/...") and
// new WebSocket("/ws/...") calls in src/api.ts work in both dev and prod.
const BACKEND = "http://127.0.0.1:4200";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": BACKEND,
      "/ws": { target: BACKEND, ws: true },
    },
  },
});
