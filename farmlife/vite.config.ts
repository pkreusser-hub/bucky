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
      // 2D conversion (R1): only the game is built. The 3D world editor
      // (editor.html + src/editor/) is DEPRECATED for now (a 2D tile editor is a
      // future follow-up) and dropped from the build so three.js leaves the
      // bundle entirely; the files stay on disk (tsc still typechecks them).
      input: {
        main: "index.html",
      },
    },
  },
});
