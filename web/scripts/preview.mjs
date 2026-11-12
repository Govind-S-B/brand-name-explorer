/** Local static Pages-like preview: gzip + 600s caching, no COOP/COEP. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve, extname } from "node:path";
const root = resolve(new URL("../dist", import.meta.url).pathname),
  prefix = "/brand-name-explorer/";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};
let transfers = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === prefix + "__stats") {
      const snapshot = transfers;
      if (url.searchParams.has("reset")) transfers = [];
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(snapshot));
      return;
    }
    if (url.pathname === "/") {
      res.writeHead(302, { Location: prefix });
      res.end();
      return;
    }
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404);
      res.end();
      return;
    }
    let path = resolve(
      root,
      decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html",
    );
    if (!path.startsWith(root + "/")) throw new Error("invalid path");
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    const data = await readFile(path),
      gzip = /gzip/.test(req.headers["accept-encoding"] || "");
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "application/octet-stream",
      "Cache-Control": "public, max-age=600",
      Vary: "Accept-Encoding",
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
    });
    const body = gzip ? gzipSync(data) : data;
    transfers.push({ path: url.pathname, encodedBytes: body.length, gzip });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
const port = Number(process.env.PREVIEW_PORT || 4173);
server.listen(port, "127.0.0.1", () =>
  console.log(`Preview http://127.0.0.1:${port}/brand-name-explorer/`),
);
