import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      // Every FastAPI route; add a prefix here when the backend gains a new top-level path
      "^/(heroes|predict|draft|health|combat|hero_images\\.json)": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "dist",
  },
});
