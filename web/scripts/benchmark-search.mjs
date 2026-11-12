import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const count = Number(process.env.COUNT || 200);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
await context.addInitScript(
  (count) =>
    localStorage.setItem(
      "bne.preferences.v2",
      JSON.stringify({ "check-domains": false, count: String(count) }),
    ),
  count,
);
const page = await context.newPage();
const calls = { rdap: 0, dns: 0 };
context.on("request", (r) => {
  if (r.url().includes("rdap.verisign.com")) calls.rdap++;
  if (/cloudflare-dns.com|dns.google/.test(r.url())) calls.dns++;
});
await page.goto(
  process.env.BASE_URL || "http://127.0.0.1:4173/brand-name-explorer/",
);
await page.locator("#mood-picker").click();
await page.locator("#domain-controls").evaluate((el) => (el.open = true));
await page.locator("#check-domains").check();
const start = Date.now();
await page.locator("#generate").click();
await page.waitForFunction(
  () =>
    ["done", "error"].includes(document.querySelector("#stage").dataset.state),
  null,
  { timeout: 900000 },
);
assert.equal(
  await page.locator("#stage").getAttribute("data-state"),
  "done",
  await page.locator("#run-status").innerText(),
);
const seconds = (Date.now() - start) / 1000;
const rows = await page
  .locator("#results .name-card")
  .evaluateAll((els) =>
    els.map((e) => ({
      domain: e.dataset.domain,
      status: e.querySelector(".domain-status").textContent,
      source: e.querySelector(".domain-status").title,
    })),
  );
// Virtualized feeds are verified through the retained logical rows in the export.
assert.equal(
  Number(await page.locator("#results").getAttribute("data-count")),
  count,
);
await page.locator("#mood-picker").click();
await page.locator("#advanced-controls").evaluate((e) => (e.open = true));
const pendingDownload = page.waitForEvent("download");
await page.locator("#export-results").click();
const download = await pendingDownload;
const { readFile } = await import("node:fs/promises");
const csv = (await readFile(await download.path(), "utf8"))
  .trim()
  .split("\n")
  .slice(1);
assert.equal(csv.length, count);
assert.ok(csv.every((line) => line.includes(",possibly available,rdap,")));
const domains = csv.map((line) => line.split(",")[0]);
assert.equal(new Set(domains).size, count);
const text = await page.locator("#lookup-stats").innerText();
assert.ok(
  rows.every(
    (r) => r.status === "possibly available" && r.source.startsWith("rdap"),
  ),
);
const result = {
  count,
  seconds,
  calls,
  stats: text,
  visibleRows: rows.length,
  domains,
  rows,
};
await writeFile(
  process.argv[2] || "/private/tmp/bne-search.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ ...result, rows: undefined, domains: undefined }));
await browser.close();
