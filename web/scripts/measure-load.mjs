/** Wall-clock cold/repeat/offline load with CDP 4G + 4x CPU, all request accounting. */
import { chromium, devices } from "playwright";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
// A stopped isolated server also blocks service-worker update checks, which
// Playwright's page/context offline emulation does not consistently cover.
const server = spawn(process.execPath, [new URL("preview.mjs", import.meta.url).pathname], {
  env: { ...process.env, PREVIEW_PORT: "4174" },
  stdio: ["ignore", "pipe", "inherit"],
});
await once(server.stdout, "data");
process.on("exit", () => server.kill());
const browser = await chromium.launch({
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  }),
  context = await browser.newContext(devices["iPhone 13"]),
  page = await context.newPage(),
  cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 150,
  downloadThroughput: 200000,
  uploadThroughput: 93750,
  connectionType: "cellular4g",
});
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
let responses = [],
  requests = [];
context.on("response", (r) => responses.push(r));
context.on("request", (r) => requests.push(r));
await context.addInitScript(() => {
  // Generation enabled, no domain work: landing would otherwise start lookups.
  localStorage.setItem("bne.preferences.v2", JSON.stringify({ "check-domains": false }));
  window.__metrics = { lcp: 0, long: [] };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__metrics.lcp = e.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    window.__metrics.long.push(
      ...list
        .getEntries()
        .map((e) => ({ start: e.startTime, duration: e.duration })),
    );
  }).observe({ type: "longtask", buffered: true });
});
const results = [];
const url = "http://127.0.0.1:4174/brand-name-explorer/";
for (const mode of ["cold", "repeat", "offline"]) {
  requests = [];
  responses = [];
  await fetch(url + "__stats?reset=1");
  if (mode === "offline") {
    await context.setOffline(true);
    server.kill();
    await once(server, "exit");
  }
  const start = Date.now();
  await page.goto(url);
  await page.waitForSelector("#results .name-card");
  const usable = Date.now() - start;
  await page.waitForTimeout(2500);
  const measured = await page.evaluate(() => ({
    ...window.__metrics,
    paints: performance
      .getEntriesByType("paint")
      .map((e) => ({ name: e.name, ms: e.startTime })),
    resources: performance.getEntriesByType("resource").map((e) => ({
      name: e.name,
      transfer: e.transferSize,
      encoded: e.encodedBodySize,
      decoded: e.decodedBodySize,
    })),
  }));
  const fcp =
    measured.paints.find((p) => p.name === "first-contentful-paint")?.ms || 0;
  const responseData = [];
  for (const r of responses) {
    let sizes;
    try {
      sizes = await r.request().sizes();
    } catch {}
    responseData.push({
      url: r.url(),
      serviceWorker: r.fromServiceWorker(),
      status: r.status(),
      sizes,
    });
  }
  const serverTransfers = mode === "offline" ? [] : await (await fetch(url + "__stats")).json();
  const result = {
    serverEncodedBodyBytes: serverTransfers.reduce(
      (n, r) => n + r.encodedBytes,
      0,
    ),
    serverTransfers,
    mode,
    previewServerStopped: mode === "offline",
    generatorUsableWallMs: usable,
    lcpMs: measured.lcp,
    observedTbtMs: measured.long
      .filter((t) => t.start >= fcp)
      .reduce((n, t) => n + Math.max(0, t.duration - 50), 0),
    pageResourceTransferBytes: measured.resources.reduce(
      (n, r) => n + r.transfer,
      0,
    ),
    allContextResponseBodyBytes: responseData.reduce(
      (n, r) => n + Math.max(0, r.sizes?.responseBodySize || 0),
      0,
    ),
    requests: requests.length,
    dictionaryFetched: requests.some((r) => /cmudict.*json/.test(r.url())),
    responses: responseData,
    metrics: measured,
  };
  results.push(result);
  console.log({
    mode,
    usable,
    lcp: result.lcpMs,
    tbt: result.observedTbtMs,
    pageTransfer: result.pageResourceTransferBytes,
    allContextBody: result.allContextResponseBodyBytes,
    requests: result.requests,
    serverBytes: result.serverEncodedBodyBytes,
  });
}
await writeFile(
  new URL("../docs/load-measurements.json", import.meta.url),
  JSON.stringify(results, null, 2),
);
await browser.close();
server.kill();
