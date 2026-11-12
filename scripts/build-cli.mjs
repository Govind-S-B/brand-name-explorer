import { build } from "esbuild";
await build({
  entryPoints: ["cli/main.ts"],
  outfile: "dist/cli.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  minify: true,
  banner: { js: "#!/usr/bin/env node" },
});

import { copyFile, chmod } from "node:fs/promises";
await copyFile("data/cmudict.bin", "dist/cmudict.bin");
await chmod("dist/cli.mjs", 0o755);
