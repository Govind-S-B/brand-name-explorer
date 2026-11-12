import { defineConfig } from "vite";
import { shell } from "./src/shell";
export default defineConfig({
  base: "./",
  build: { target: "es2022", modulePreload: false },
  worker: { format: "es" },
  plugins: [
    {
      name: "static-app-shell",
      transformIndexHtml: (html) =>
        html.replace('<div id="app"></div>', `<div id="app">${shell()}</div>`),
    },
    {
      // The only dynamic import (analysis-ui) has no CSS or chunk dependencies,
      // so Vite's preload helper has nothing to do; replace it with a pass-through.
      name: "no-preload-helper",
      enforce: "pre",
      load: (id) =>
        id === "\0vite/preload-helper.js"
          ? "export const __vitePreload = (load) => load();"
          : undefined,
    },
  ],
});
