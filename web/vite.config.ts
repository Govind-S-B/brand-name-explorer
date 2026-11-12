import { defineConfig } from "vite";
import { shell } from "./src/shell";
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  worker: { format: "es" },
  plugins: [
    {
      name: "static-app-shell",
      transformIndexHtml: (html) =>
        html.replace('<div id="app"></div>', `<div id="app">${shell()}</div>`),
    },
  ],
});
