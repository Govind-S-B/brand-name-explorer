import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const root = new URL("../dist/", import.meta.url);
async function walk(dir, prefix = "") {
  const files = [];
  for (const name of await readdir(dir)) {
    const path = new URL(name, dir);
    if ((await stat(path)).isDirectory())
      files.push(
        ...(await walk(new URL(name + "/", dir), prefix + name + "/")),
      );
    else files.push(prefix + name);
  }
  return files;
}
const files = await walk(root);
const worker = files.find((p) => /lookup\.worker-.*\.js$/.test(p));
if (worker) {
  const path = new URL("index.html", root);
  await writeFile(
    path,
    (await readFile(path, "utf8")).replace(
      "</head>",
      `<link rel="modulepreload" href="./${worker}"></head>`,
    ),
  );
}
const all = await walk(root),
  precache = all.filter((p) => !p.endsWith(".bin") && !p.endsWith(".map"));
const hash = createHash("sha256");
for (const file of precache.sort())
  hash.update(file).update(await readFile(new URL(file, root)));
const version = hash.digest("hex").slice(0, 12);
await writeFile(
  new URL("sw.js", root),
  `/* Generated content-addressed shell; dictionary enters cache only on use. */
const VERSION='bne-shell-${version}',RUNTIME='bne-dictionary-${version}',SCOPE=self.registration.scope;
const ASSETS=${JSON.stringify(precache)}.map(p=>new URL(p,SCOPE).href);
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(c=>c.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('bne-')&&k!==VERSION&&k!==RUNTIME).map(k=>caches.delete(k)))),self.clients.claim()]));});
self.addEventListener('fetch',event=>{const r=event.request,url=new URL(r.url);if(r.method!=='GET'||url.origin!==location.origin||!url.href.startsWith(SCOPE))return;
 if(r.mode==='navigate'){event.respondWith(fetch(r).catch(()=>caches.open(VERSION).then(c=>c.match(new URL('index.html',SCOPE))).then(r=>r||Response.error())));return;}
 if(ASSETS.includes(url.href)){event.respondWith(caches.open(VERSION).then(async c=>(await c.match(r))||fetch(r)));return;}
 if(/\\/assets\\/cmudict-[^/]+\\.bin$/.test(url.pathname)){event.respondWith(caches.open(RUNTIME).then(async c=>{const hit=await c.match(r);if(hit)return hit;const response=await fetch(r);if(response.ok){try{await c.put(r,response.clone());}catch{/* Analysis can still use this response if storage is full. */}}return response;}));}
});
`,
);
const html = await readFile(new URL("index.html", root), "utf8");
const initial = [...html.matchAll(/<(?:script|link)\b[^>]*>/g)]
  .map((m) => m[0])
  .filter((tag) => !tag.includes("modulepreload"))
  .flatMap((tag) =>
    [...tag.matchAll(/(?:src|href)="\.\/([^"\s]+\.(?:js|css))"/g)].map(
      (m) => m[1],
    ),
  );
const sizes = [];
for (const path of all) {
  const bytes = await readFile(new URL(path, root));
  sizes.push({
    path,
    bytes: bytes.length,
    gzip: gzipSync(bytes).length,
    initial: initial.includes(path),
  });
}
const summary = {
  version,
  initialJsGzip: sizes
    .filter((x) => x.initial && x.path.endsWith(".js"))
    .reduce((n, x) => n + x.gzip, 0),
  initialCssGzip: sizes
    .filter((x) => x.initial && x.path.endsWith(".css"))
    .reduce((n, x) => n + x.gzip, 0),
  assets: sizes,
};
await mkdir(new URL("../docs/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../docs/bundle-size.json", import.meta.url),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
