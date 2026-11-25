import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const isDraftOnly = process.env.VITE_DRAFT_ONLY === "true";
const outDir = process.env.VITE_OUT_DIR || "dist";

// https://vite.dev/config/
export default defineConfig({
  define: {
    __DRAFT_ONLY__: JSON.stringify(isDraftOnly),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "sanitize-draft-only-html",
      transformIndexHtml(html) {
        if (!isDraftOnly) return html;
        return html.replace(
          /<meta name="description" content="[^"]*"\s*\/>/,
          '<meta name="description" content="RoV Pro Draft Assistant — Global Ban Bo1-Bo7 simulation &amp; matchup planning" />',
        );
      },
    },
    {
      name: "prune-draft-only-public-assets",
      closeBundle() {
        if (!isDraftOnly) return;
        const resolvedOut = path.resolve(import.meta.dirname, outDir);
        for (const rel of ["dataset_metadata.json", "items", "enchantments", "skills"]) {
          const target = path.join(resolvedOut, rel);
          if (fs.existsSync(target)) {
            fs.rmSync(target, { recursive: true, force: true });
          }
        }
      },
    },
  ],
  server: {
    port: 3000,
    proxy: {
      // Every FastAPI route; add a prefix here when the backend gains a new top-level path
      "^/(auth|heroes(?:-media)?|predict|draft|health|combat|items-media|privacy|telemetry|survey|feedback|admin|billing|analytics)(?:/|$|\\?)": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir,
  },
});
