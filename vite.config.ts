import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The internal admin app. Runs on 5174 (the owner dashboard uses 5173) and
// proxies /api to the Django backend so the token-authed calls are same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
