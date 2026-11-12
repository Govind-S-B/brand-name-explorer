import { chromium, devices } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const root = new URL("../docs/", import.meta.url);
await mkdir(new URL("screenshots/", root), { recursive: true });
const base = process.env.BASE_URL || "http://127.0.0.1:4173/brand-name-explorer/";
const prefix = process.env.EVIDENCE_PREFIX || "";
const results = [];
async function waitDone(page) {
  await page.waitForFunction(() => document.querySelector("#pause").hidden, {
    timeout: 60000,
  });
}
for (const profile of ["desktop", "mobile"]) {
  const context = await browser.newContext(
    profile === "desktop"
      ? { viewport: { width: 1440, height: 1000 } }
      : { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } },
  );
  const page = await context.newPage(),
    errors = [],
    network = [],
    sameOriginFailures = [],
    apiResponses = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => network.push(r.url()));
  context.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400)
      sameOriginFailures.push({ url: r.url(), status: r.status() });
    if (/https:\/\/(rdap.verisign.com|cloudflare-dns.com|dns.google)\//.test(r.url()))
      apiResponses.push({ url: r.url(), status: r.status() });
  });
  await page.goto(base);
  await page.waitForSelector("#results .name-card");
  assert.equal(await page.locator("#results .name-card").count(), 24);
  assert.equal(
    network.some((u) => /rdap.verisign|cloudflare-dns|dns.google/.test(u)),
    false,
  );
  assert.equal(
    network.some((u) => /cmudict.*json/.test(u)),
    false,
  );
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const serviceWorker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, scriptURL: registration.active?.scriptURL, state: registration.active?.state };
  });
  await page.waitForTimeout(500);
  await page.locator("#generate").click();
  await waitDone(page);
  assert.equal(
    await page.locator("#results .unchecked,#results .checking").count(),
    0,
  );
  assert.equal(await page.locator("#results .name-card").count(), 24);
  const statuses = await page
    .locator("#results .domain-status")
    .allTextContents();
  assert.ok(
    statuses.every((s) => ["registered", "possibly available"].includes(s)),
  );
  const liveStatus = await page.locator("#run-status").innerText();
  await page.locator("#results .save-name").first().click();
  const savedDomain = await page
    .locator("#results .name-card")
    .first()
    .getAttribute("data-domain");
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300); // Let result fades and the progress meter settle.
  await page.screenshot({
    path: new URL(`screenshots/${prefix}${profile}.png`, root).pathname,
    fullPage: false,
  });
  await page.screenshot({
    path: new URL(`screenshots/${prefix}${profile}-full.png`, root).pathname,
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false);
  await page.locator("#tab-reverse").click();
  await page.locator("#panel-reverse button[type=submit]").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#panel-reverse .tool-status")
        .textContent.includes("complete"),
    { timeout: 30000 },
  );
  assert.match(
    await page.locator("#panel-reverse .tool-result").innerText(),
    /Candidate settings found/,
  );
  assert.ok(network.some((u) => /cmudict.*json/.test(u)));
  await page.locator("#tab-inverter").click();
  await page.locator("#panel-inverter button[type=submit]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#panel-inverter .tool-status")
      .textContent.includes("complete"),
  );
  assert.match(
    await page.locator("#panel-inverter .tool-result").innerText(),
    /Candidate inverse settings/,
  );
  await page.locator("#tab-substitutions").click();
  await page.locator("#panel-substitutions button[type=submit]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#panel-substitutions .tool-status")
      .textContent.includes("complete"),
  );
  assert.equal(
    await page.locator("#panel-substitutions .analysis-card").count(),
    5,
  );
  await page.locator("#tab-saved").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#backup").click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.ok(backup.saved[savedDomain]);
  await page.locator("#tab-explore").click();
  await page.locator(".advanced").evaluate((el) => (el.open = true));
  await page.locator("#clear-cache").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#cache-status")
      .textContent.includes("0 domain records"),
  );
  assert.equal(await page.locator("#saved-count").innerText(), "1");
  await page.locator("#tab-saved").click();
  await page.locator("#saved-list .save-name").click();
  assert.equal(await page.locator("#saved-count").innerText(), "0");
  await page
    .locator("#import")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await page.waitForFunction(
    () => document.querySelector("#saved-count").textContent === "1",
  );
  await page.locator("#tab-explore").click();
  await page.locator(".advanced").evaluate((el) => (el.open = false));
  await page.locator("#domain-controls").evaluate((el) => (el.open = true));
  await page.locator("#check-domains").uncheck();
  await page.locator("#generate").click();
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector("#results .name-card");
  await page.locator("#generate").click();
  assert.match(
    await page.locator("#run-status").innerText(),
    /generated offline/,
  );
  assert.equal(await page.locator("#results .name-card").count(), 24);
  assert.equal(await page.locator("#saved-count").innerText(), "1");
  await page.locator("#tab-reverse").click();
  await page.locator("#panel-reverse button[type=submit]").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("#panel-reverse .tool-status")
        .textContent.includes("complete"),
    { timeout: 10000 },
  );
  assert.match(
    await page.locator("#panel-reverse .tool-result").innerText(),
    /Candidate settings found/,
  );
  await context.setOffline(false);
  results.push({
    profile,
    liveStatus,
    statuses,
    axeViolations: axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.map((n) => n.target),
    })),
    overflow,
    errors,
    sameOriginFailures,
    apiResponses,
    serviceWorker,
    offlineGeneration: true,
    offlineAnalysisAfterFirstUse: true,
    shortlistBackupAndImport: true,
    cacheClearPreservedShortlist: true,
    subpath: base,
  });
  await context.close();
}
await writeFile(
  new URL(`${prefix}browser-verification.json`, root),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
await browser.close();
assert.ok(
  results.every((r) => r.errors.length === 0 && r.axeViolations.length === 0 && r.sameOriginFailures.length === 0),
);
