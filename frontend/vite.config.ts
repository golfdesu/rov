import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      "/heroes": "http://127.0.0.1:8000",
      "/predict": "http://127.0.0.1:8000",
      "/draft": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
      "/combat": "http://127.0.0.1:8000",
      "/hero_images.json": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "dist",
  },
});
