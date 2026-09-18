import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [react(), viteStaticCopy({ targets: [{ src: "manifest.json", dest: "." }, { src: "offscreen.html", dest: "." }] })],
  build: {
    rollupOptions: {
      input: {
        sidepanel: "sidepanel.html",
        background: "src/background.ts",
        content: "src/content.ts",
        offscreen: "src/offscreen.ts",
      },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
    },
  },
});
