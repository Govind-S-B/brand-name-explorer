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
const stage = (page, state, timeout = 90000) =>
  page.waitForFunction((s) => document.querySelector("#stage").dataset.state === s, state, { timeout });
for (const profile of ["desktop", "mobile"]) {
  const context = await browser.newContext(
    profile === "desktop"
      ? { viewport: { width: 1440, height: 1000 } }
      : { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } },
  );
  await context.addInitScript(() => localStorage.setItem("bne.settings.v1", JSON.stringify({ randomSeed: false })));
  const page = await context.newPage(),
    errors = [],
    network = [],
    sameOriginFailures = [],
    apiResponses = [],
    axeViolations = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => network.push(r.url()));
  context.on("response", (r) => {
    if (r.url().startsWith(base) && r.status() >= 400)
      sameOriginFailures.push({ url: r.url(), status: r.status() });
    if (/https:\/\/(rdap.verisign.com|cloudflare-dns.com|dns.google)\//.test(r.url()))
      apiResponses.push({ url: r.url(), status: r.status() });
  });
  const shot = (name, fullPage = false) =>
    page.screenshot({
      path: new URL(`screenshots/${prefix}${profile}${name}.png`, root).pathname,
      fullPage,
    });
  const axe = async (where) => {
    // Automatic lists may finish checks during an audit; settle their statuses
    // before measuring the existing status-arrival opacity animation.
    await page.waitForFunction(() => ![...document.querySelectorAll('.name-card[data-auto-check]')].some(e => !e.closest('[hidden]') && !e.closest('dialog:not([open])') && e.dataset.status === 'checking'), null, {timeout:90000});
    await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    for (const v of report.violations)
      axeViolations.push({ where, id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map((n) => n.target) });
  };
  // Default landing: the CLI's defaults, i.e. possibly available .com names only, 20 per page.
  await page.goto(base);
  await stage(page, "done");
  assert.equal(await page.locator("#feed-title #mood-picker").count(), 1);
  assert.equal(await page.locator(".configbar").count(), 0);
  assert.equal(await page.locator("#results .name-card").count(), 20);
  const statuses = await page.locator("#results .domain-status").allTextContents();
  assert.ok(statuses.every((s) => s === "possibly available"));
  const sources = await page.locator("#results .domain-status").evaluateAll((els) => els.map((e) => e.title));
  assert.ok(sources.every((s) => /^(rdap|cache|saved)/.test(s)));
  assert.ok(network.some((u) => /rdap.verisign|cloudflare-dns|dns.google/.test(u)));
  assert.equal(network.some((u) => /cmudict.*bin/.test(u)), false);
  const liveStatus = await page.locator("#run-status").innerText();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const serviceWorker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return { scope: registration.scope, scriptURL: registration.active?.scriptURL, state: registration.active?.state };
  });
  await page.locator("#results .save-name").first().click();
  const savedDomain = await page.locator("#results .name-card").first().getAttribute("data-domain");
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400); // Let row fades and the progress bar settle.
  await shot("");
  await shot("-full", true);
  await axe("feed");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false);
  // Name sheet: sound breakdown via the inverter (no dictionary), then substitutions.
  await page.locator("#results .name-open").first().click();
  await page.waitForFunction(() => document.querySelector("#ns-sound .dialbars"));
  assert.equal(network.some((u) => /cmudict.*bin/.test(u)), false);
  await page.locator("#ns-nearby button").click();
  await page.waitForFunction(() => document.querySelectorAll("#ns-nearby .name-card").length === 5);
  await page.waitForTimeout(300);
  await shot("-sheet");
  await axe("name sheet");
  await page.keyboard.press("Escape");
  // Tune: reveal registered names with the toggle.
  await page.locator("#mood-picker").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#mood-picker").getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector("#mood-picker").getAttribute("aria-expanded") === "false");
  assert.equal(await page.locator("#mood-picker").evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Space");
  await page.locator("#domain-controls").evaluate((el) => (el.open = true));
  await page.waitForTimeout(300);
  await shot("-tune");
  await axe("tune");
  await page.locator("#filter-available").uncheck();
  await page.locator("#generate").click();
  await stage(page, "done");
  assert.equal(await page.locator("#mood-picker").getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#results .name-card").count(), 20);
  assert.equal(await page.locator("#results .unchecked,#results .checking").count(), 0);
  const allStatuses = await page.locator("#results .domain-status").allTextContents();
  assert.ok(allStatuses.every((s) => ["registered", "possibly available"].includes(s)));
  assert.ok(allStatuses.includes("registered"));
  await page.locator("#mood-picker").click();
  await page.locator("#filter-available").check();
  await page.locator("#generate").click();
  await stage(page, "done");
  // Reverse with the dictionary, then the folded-in substitutions follow-up.
  await page.locator("#tab-reverse").click();
  await page.locator("#reverse-word").fill("figma");
  await page.locator("#panel-reverse button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelector("#panel-reverse .tool-status").textContent.includes("complete"),
    null,
    { timeout: 30000 },
  );
  assert.match(await page.locator("#panel-reverse .tool-result").innerText(), /Settings that make this sound/);
  assert.ok(network.some((u) => /cmudict.*bin/.test(u)));
  await page.locator("[data-follow=substitutions]").click();
  await page.waitForFunction(() => document.querySelectorAll("#panel-reverse .tool-more .name-card").length === 5);
  await axe("reverse");
  // Shortlist backup, cache clearing that keeps it, and import.
  await page.locator("#tab-saved").click();
  await axe("shortlist");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#backup").click();
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.ok(backup.saved[savedDomain]);
  await page.locator("#tab-explore").click();
  await page.locator("#mood-picker").click();
  await page.locator("#advanced-controls").evaluate((el) => (el.open = true));
  await page.locator("#clear-cache").click();
  await page.waitForFunction(() => document.querySelector("#cache-status").textContent.includes("0 domain records"));
  await page.locator("#tune [data-close]").click();
  await stage(page, "done");
  assert.equal(await page.locator("#saved-count").textContent(), "1");
  await page.locator("#tab-saved").click();
  await page.locator("#saved-list .save-name").click();
  assert.equal(await page.locator("#saved-count").textContent(), "0");
  await page.locator("#import").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.waitForFunction(() => document.querySelector("#saved-count").textContent === "1");
  // Offline reload with default settings: names are browsable, checks wait for a connection.
  await page.locator("#tab-explore").click();
  await context.setOffline(true);
  await page.reload();
  await stage(page, "offline");
  assert.equal(await page.locator("#results .name-card").count(), 20);
  assert.match(await page.locator("#run-status").innerText(), /offline/);
  assert.equal(await page.locator("#saved-count").textContent(), "1");
  await page.locator("#tab-reverse").click();
  await page.locator("#reverse-word").fill("figma");
  await page.locator("#panel-reverse button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelector("#panel-reverse .tool-status").textContent.includes("complete"),
    null,
    { timeout: 10000 },
  );
  await context.setOffline(false);
  results.push({
    profile,
    liveStatus,
    statuses,
    revealedStatuses: allStatuses,
    axeViolations,
    overflow,
    errors,
    sameOriginFailures,
    apiResponses,
    serviceWorker,
    defaultFeedAvailableOnly: true,
    nameSheetAnalysisWithoutDictionary: true,
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
console.log(JSON.stringify(results.map(({ apiResponses, ...r }) => ({ ...r, apiResponses: apiResponses.length })), null, 2));
await browser.close();
assert.ok(
  results.every((r) => r.errors.length === 0 && r.axeViolations.length === 0 && r.sameOriginFailures.length === 0),
);
