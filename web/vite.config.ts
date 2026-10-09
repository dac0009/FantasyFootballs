import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

/**
 * The generated datasets live in /data at the repository root, outside this
 * app. This plugin serves them at /data/* during `npm run dev` and copies
 * them into dist/data at build time, so the deployed site is a single static
 * folder with no separate data host.
 */
function leagueData(): import("vite").Plugin {
  const source = path.resolve(__dirname, "../data");
  return {
    name: "league-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        const match = url.match(/^\/data\/(.+)$/);
        if (!match) return next();
        const file = path.join(source, decodeURIComponent(match[1]));
        if (!file.startsWith(source) || !fs.existsSync(file)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const target = path.resolve(__dirname, "dist/data");
      if (!fs.existsSync(source)) {
        this.warn("no ../data directory found; run `python -m pipeline sample` first");
        return;
      }
      fs.cpSync(source, target, { recursive: true });
    },
  };
}

// GitHub Pages project sites are served from /<repo>/, so the base path has to
// match. Override with BASE_PATH=/ for a user site or a custom domain.
const base = process.env.BASE_PATH ?? "/FantasyFootballs/";

// Standalone builds are inlined into one HTML file by
// scripts/build_single_file.py, which changes both routing and chunking.
const standalone = process.env.VITE_STANDALONE === "true";

export default defineConfig({
  base,
  plugins: [react(), tailwind(), leagueData()],
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Charts are the heaviest dependency and most pages never render one,
        // so keep them out of the entry chunk. A standalone single-file build
        // must stay as one chunk, because there is nothing to load a second
        // file from -- see scripts/build_single_file.py.
        manualChunks: standalone ? undefined : { charts: ["recharts"] },
        inlineDynamicImports: standalone,
        // A standalone file must be a classic script, not an ES module:
        // browsers refuse to load module scripts over file://, so a
        // double-clicked HTML file would otherwise render nothing.
        format: standalone ? "iife" : "es",
      },
    },
  },
});
