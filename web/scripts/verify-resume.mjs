import { chromium, devices } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const workload = JSON.parse(
    await readFile(new URL("./workload.json", import.meta.url), "utf8"),
  ),
  available = JSON.parse(
    await readFile(
      new URL("../../tests/available-fixture.json", import.meta.url),
      "utf8",
    ),
  );
const statuses = new Map(
  workload.map((d) => [
    d,
    available.includes(d) ? "possibly available" : "registered",
  ]),
);
const context = await browser.newContext({
  ...devices["iPhone 13"],
  serviceWorkers: "block",
});
await context.addInitScript(() => localStorage.setItem("bne.settings.v1", JSON.stringify({ randomSeed: false })));
const page = await context.newPage();
const calls = { dns: 0, rdap: 0 };
const attempts = new Map();
let peak = 0,
  active = 0;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await context.route(
  /https:\/\/(cloudflare-dns.com\/dns-query|dns.google\/resolve)/,
  async (route) => {
    calls.dns++;
    const domain = new URL(route.request().url()).searchParams.get("name"),
      index = workload.indexOf(domain);
    await new Promise((r) => setTimeout(r, index === 0 ? 700 : 20));
    await route
      .fulfill({
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/dns-json",
        },
        body: JSON.stringify({
          Status: statuses.get(domain) === "registered" ? 0 : 3,
          Question: [{ name: domain, type: 2 }],
          Answer:
            statuses.get(domain) === "registered" && index % 2 === 0
              ? [{ name: domain, type: 2, TTL: 300, data: "ns.example.net." }]
              : [],
        }),
      })
      .catch(() => {});
  },
);
await context.route("https://rdap.verisign.com/**", async (route) => {
  calls.rdap++;
  const domain = route.request().url().split("/").at(-1);
  attempts.set(domain, (attempts.get(domain) || 0) + 1);
  active++;
  peak = Math.max(peak, active);
  await new Promise((r) => setTimeout(r, domain === workload[0] ? 350 : 50));
  active--;
  await route
    .fulfill({
      status: statuses.get(domain) === "possibly available" ? 404 : 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/rdap+json",
      },
      body:
        statuses.get(domain) === "possibly available"
          ? ""
          : JSON.stringify({ ldhName: domain }),
    })
    .catch(() => {});
});
const base = process.env.BASE_URL || "http://127.0.0.1:4173/brand-name-explorer/";
const stage = (state, timeout = 30000) =>
  page.waitForFunction((s) => document.querySelector("#stage").dataset.state === s, state, { timeout });
const domains = () =>
  page.locator("#results .name-card").evaluateAll((els) => els.map((el) => el.dataset.domain));
// Landing starts the CLI-default search (possibly available names, 20 per page).
await page.goto(base);
await page.waitForFunction(
  () => document.querySelectorAll("#results .available").length >= 6,
);
await page.locator("#pause").click();
await page.waitForTimeout(100);
const beforeReload = await page.locator("#results .name-card").count();
assert.ok(beforeReload < 20);
// Reloading resumes the saved progress automatically.
await page.reload();
await stage("done");
const first = await domains();
assert.deepEqual(first, available.slice(0, 20));
assert.equal(await page.locator("#results .unchecked").count(), 0);
// Load more appends page two, still in seed order.
await page.locator("#next").click();
await stage("done");
assert.deepEqual(await domains(), available.slice(0, 40));
// A saved page replays from the session store without network calls.
const countsBefore = { ...calls };
await page.reload();
await stage("done");
assert.deepEqual(calls, countsBefore);
assert.deepEqual(await domains(), available.slice(0, 20));
// Fresh lookups bypass saved results.
await page.locator("#mood-picker").click();
await page.locator("#domain-controls").evaluate((el) => (el.open = true));
await page.locator("#refresh").check();
await page.locator("#generate").click();
await stage("done");
assert.ok(calls.dns > countsBefore.dns);
assert.deepEqual(await domains(), available.slice(0, 20));
// Going offline mid-page pauses; reconnecting resumes.
await page.locator("#next").click();
await page.waitForFunction(() => !document.querySelector("#pause").hidden);
await context.setOffline(true);
await page.waitForFunction(() => document.querySelector("#pause").hidden);
await context.setOffline(false);
await stage("done");
assert.deepEqual(await domains(), available.slice(0, 40));
// Original engine styles and their restored length limits.
await page.locator("#mood-picker").click();
await page.locator("#domain-controls").evaluate((el) => (el.open = true));
await page.locator("#check-domains").uncheck();
await page.locator("#advanced-controls").evaluate((el) => (el.open = true));
await page.locator("#generate").click();
await page.waitForSelector("#results .name-card");
await page.locator("#tab-reverse").focus();
await page.keyboard.press("ArrowRight");
assert.equal(
  await page.locator("#tab-saved").getAttribute("aria-selected"),
  "true",
);
assert.equal(
  await page
    .locator("#tab-saved")
    .evaluate((el) => el === document.activeElement),
  true,
);
const result = {
  mockedNetwork: true,
  pauseBeforeComplete: beforeReload,
  reloadResumesAutomatically: true,
  orderedPagesMatchPython: true,
  loadMoreAppendsNextPage: true,
  savedPageNetworkCalls: 0,
  refreshRefetched: true,
  offlineResume: true,
  keyboardTabs: true,
  peakRdap: peak,
  stats: calls,
  errors,
};
await writeFile(
  new URL("../docs/resume-verification.json", import.meta.url),
  JSON.stringify(result, null, 2),
);
console.log(result);
await browser.close();
assert.equal(errors.length, 0);
assert.ok(peak <= 6);
