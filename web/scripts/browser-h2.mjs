import { chromium, devices } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
const names = JSON.parse(
  await readFile(new URL("./workload.json", import.meta.url)),
).slice(0, 128);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--disable-quic"],
});
const results = [];
for (const profile of ["desktop", "mobile-slow4g"]) {
  const context = await browser.newContext(
    profile === "desktop" ? {} : devices["iPhone 13"],
  );
  const page = await context.newPage(),
    cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (profile !== "desktop")
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200000,
      uploadThroughput: 93750,
      connectionType: "cellular4g",
    });
  await page.goto("http://127.0.0.1:5173");
  let protocols = {};
  cdp.on("Network.responseReceived", ({ response: r }) => {
    if (/cloudflare-dns|dns.google/.test(r.url))
      protocols[r.protocol] = (protocols[r.protocol] || 0) + 1;
  });
  for (const provider of ["cloudflare", "google"])
    for (const concurrency of [12, 48]) {
      protocols = {};
      const result = await page.evaluate(
        async ({ names, provider, concurrency }) => {
          let i = 0;
          const samples = [];
          const start = performance.now();
          await Promise.all(
            Array.from({ length: concurrency }, async () => {
              while (i < names.length) {
                const domain = names[i++],
                  s = performance.now();
                try {
                  const r = await fetch(
                    (provider === "google"
                      ? "https://dns.google/resolve"
                      : "https://cloudflare-dns.com/dns-query") +
                      "?name=" +
                      domain +
                      "&type=NS",
                    {
                      cache: "no-store",
                      headers: { Accept: "application/dns-json" },
                      signal: AbortSignal.timeout(5000),
                    },
                  );
                  await r.json();
                  samples.push({ ms: performance.now() - s, code: r.status });
                } catch (e) {
                  samples.push({ ms: performance.now() - s, error: String(e) });
                }
              }
            }),
          );
          const sorted = samples.map((x) => x.ms).sort((a, b) => a - b);
          return {
            seconds: (performance.now() - start) / 1000,
            p50: sorted[64],
            p95: sorted[121],
            errors: samples.filter((x) => x.error || x.code !== 200),
          };
        },
        { names, provider, concurrency },
      );
      results.push({ profile, provider, concurrency, ...result, protocols });
      console.log(results.at(-1));
    }
  await context.close();
}
await writeFile(
  new URL("../docs/browser-h2-results.json", import.meta.url),
  JSON.stringify(results, null, 2),
);
await browser.close();
