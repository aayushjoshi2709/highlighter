import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    target: "chrome120",
    lib: {
      entry: resolve(__dirname, "src/content/index.ts"),
      formats: ["iife"],
      name: "HighlighterContent",
      fileName: () => "content.js",
    },
  },
});
