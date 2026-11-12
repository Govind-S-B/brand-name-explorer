import { chromium, devices } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  }),
  expected = JSON.parse(
    await readFile(
      new URL("../../tests/available-fixture.json", import.meta.url),
      "utf8",
    ),
  ),
  results = [];
for (const profile of ["desktop", "mobile-slow4g"]) {
  const context = await browser.newContext(
    profile === "desktop"
      ? { viewport: { width: 1440, height: 1000 } }
      : devices["iPhone 13"],
  );
  const page = await context.newPage(),
    cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (profile !== "desktop") {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200000,
      uploadThroughput: 93750,
      connectionType: "cellular4g",
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  const calls = { rdap: 0, dns: 0 };
  context.on("request", (r) => {
    if (r.url().includes("rdap.verisign.com")) calls.rdap++;
    if (/cloudflare-dns.com|dns.google/.test(r.url())) calls.dns++;
  });
  // Land with checks off so the timed run below is the only lookup work.
  await context.addInitScript(() =>
    localStorage.setItem("bne.preferences.v2", JSON.stringify({ "check-domains": false, count: "200" })),
  );
  await page.goto("http://127.0.0.1:4173/brand-name-explorer/");
  await page.locator("#tune-btn").click();
  await page.locator("#domain-controls").evaluate((el) => (el.open = true));
  await page.locator("#check-domains").check();
  await page.locator("#filter-available").check();
  const start = Date.now();
  await page.locator("#generate").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#stage").dataset.state === "done" &&
      document.querySelectorAll("#results .name-card").length === 200,
    null,
    { timeout: 180000 },
  );
  const seconds = (Date.now() - start) / 1000;
  const domains = await page
    .locator("#results .name-card")
    .evaluateAll((els) => els.map((e) => e.dataset.domain));
  const statuses = await page
    .locator("#results .domain-status")
    .allTextContents();
  const source = await page
    .locator("#results .domain-status")
    .evaluateAll((els) => els.map((e) => e.title));
  assert.deepEqual(domains, expected);
  assert.ok(statuses.every((s) => s === "possibly available"));
  assert.ok(source.every((s) => s.startsWith("rdap")));
  results.push({
    profile,
    available: 200,
    seconds,
    requests: calls,
    status: await page.locator("#run-status").innerText(),
    sameOrderedNamesAsPython: true,
    allAvailableRdapConfirmed: true,
  });
  console.log(results.at(-1));
  await context.close();
  await writeFile(
    new URL("../docs/production-throughput.json", import.meta.url),
    JSON.stringify(results, null, 2),
  );
}
await browser.close();
