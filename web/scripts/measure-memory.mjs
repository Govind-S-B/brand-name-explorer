/** CDP heap after forced GC, including dedicated workers. Not a device RSS metric. */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: "block",
});
await context.addInitScript(() =>
  localStorage.setItem(
    "bne.preferences.v2",
    JSON.stringify({ "check-domains": false }),
  ),
);
const page = await context.newPage();
await page.goto(
  process.env.BASE_URL || "http://127.0.0.1:4173/brand-name-explorer/",
);
await page.waitForSelector("#results .name-card");
const root = await browser.newBrowserCDPSession();
let next = 1;
async function command(sessionId, method, params = {}) {
  const id = next++;
  const result = new Promise((resolve, reject) => {
    const handle = (e) => {
      if (e.sessionId !== sessionId) return;
      const msg = JSON.parse(e.message);
      if (msg.id !== id) return;
      root.off("Target.receivedMessageFromTarget", handle);
      msg.error
        ? reject(new Error(JSON.stringify(msg.error)))
        : resolve(msg.result);
    };
    root.on("Target.receivedMessageFromTarget", handle);
  });
  await root.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({ id, method, params }),
  });
  return result;
}
async function heaps(label) {
  const { targetInfos } = await root.send("Target.getTargets");
  const values = [];
  for (const t of targetInfos.filter(
    (t) => ["page", "worker"].includes(t.type) && t.url.includes("127.0.0.1"),
  )) {
    const { sessionId } = await root.send("Target.attachToTarget", {
      targetId: t.targetId,
      flatten: false,
    });
    await command(sessionId, "HeapProfiler.collectGarbage");
    const heap = await command(sessionId, "Runtime.getHeapUsage");
    values.push({ type: t.type, url: t.url, ...heap });
    if (process.env.HEAP_SNAPSHOTS === "1") {
      const chunks = [];
      const capture = (e) => {
        if (e.sessionId !== sessionId) return;
        const m = JSON.parse(e.message);
        if (m.method === "HeapProfiler.addHeapSnapshotChunk")
          chunks.push(m.params.chunk);
      };
      root.on("Target.receivedMessageFromTarget", capture);
      await command(sessionId, "HeapProfiler.takeHeapSnapshot", {
        reportProgress: false,
      });
      root.off("Target.receivedMessageFromTarget", capture);
      await writeFile(
        (process.argv[2] || "/private/tmp/bne-memory.json") +
          "." +
          label +
          "." +
          t.type +
          "." +
          t.url.split("/").at(-1) +
          ".heapsnapshot",
        chunks.join(""),
      );
    }
    await root.send("Target.detachFromTarget", { sessionId });
  }
  return {
    label,
    domRows: await page.locator("#results .name-card").count(),
    heaps: values,
  };
}
const results = [await heaps("landing-20")];
await page.locator("#tab-reverse").click();
await page.locator("#reverse-word").fill("figma");
await page.locator("#panel-reverse button[type=submit]").click();
await page.waitForFunction(() =>
  document
    .querySelector("#panel-reverse .tool-status")
    .textContent.includes("complete"),
);
results.push(await heaps("dictionary-loaded"));
await page.locator("#tab-explore").click();
await page.locator("#tune-btn").click();
await page.locator("#advanced-controls").evaluate((el) => (el.open = true));
await page.locator("#count").selectOption("4000");
await page.locator("#generate").click();
await page.waitForFunction(
  () => document.querySelector("#stage").dataset.state === "idle",
);
results.push(await heaps("feed-4000"));
await page.locator("#next").click();
await page.waitForFunction(
  () => document.querySelector("#stage").dataset.state === "idle",
);
results.push(await heaps("feed-8000"));
console.log(JSON.stringify(results, null, 2));
await writeFile(
  process.argv[2] || "/private/tmp/bne-memory.json",
  JSON.stringify(results, null, 2),
);
await browser.close();
