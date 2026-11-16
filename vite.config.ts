import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { cpSync } from "node:fs";

// PDF.js needs its character maps and standard fonts at runtime for some documents.
const copyPdfAssets = () => ({
  name: "copy-pdfjs-assets",
  closeBundle() {
    for (const dir of ["cmaps", "standard_fonts"]) {
      cpSync(resolve(__dirname, "node_modules/pdfjs-dist", dir), resolve(__dirname, "dist/pdfjs", dir), { recursive: true });
    }
  },
});

// Builds the extension pages (popup, dashboard, PDF viewer) and the MV3
// service worker. The content script is built separately as a single IIFE
// (see vite.content.config.ts) because manifest-declared content scripts
// cannot be ES modules.
export default defineConfig({
  root: resolve(__dirname, "src/pages"),
  publicDir: resolve(__dirname, "public"),
  base: "./",
  plugins: [react(), copyPdfAssets()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "src/pages/popup/index.html"),
        dashboard: resolve(__dirname, "src/pages/dashboard/index.html"),
        pdf: resolve(__dirname, "src/pages/pdf/index.html"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    root: __dirname,
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
} as import("vite").UserConfig);
