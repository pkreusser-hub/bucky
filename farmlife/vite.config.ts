import { defineConfig } from "vite";

// base: './' so the built app works served statically from any subpath
// (BUCKY serves it from /farmlife/dist/ — see farmlife-plan.md).
// Multi-page (P1.5b): the game (index.html) + the world editor (editor.html,
// Dad's tool, direct URL only — never linked from the game). Input paths are
// relative to the project root so we avoid pulling in @types/node for `path`.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      input: {
        main: "index.html",
        editor: "editor.html",
      },
    },
  },
});
