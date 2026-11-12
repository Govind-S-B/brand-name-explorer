/** Design review screenshots with mocked RDAP/DoH, so states are deterministic.
 * Start `npm run preview:pages` first. Usage: node scripts/design-screens.mjs [outDir] */
import { chromium, devices } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const out = resolve(process.argv[2] || "docs/screenshots");
await mkdir(out, { recursive: true });
const base = "http://127.0.0.1:4173/brand-name-explorer/";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
// Stable pseudo-random outcome per domain: roughly two in five available.
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const isFree = (d) => hash(d) % 5 < 2;
let slow = false;
async function mock(context) {
  const cors = { "Access-Control-Allow-Origin": "*" };
  await context.route(
    /https:\/\/(cloudflare-dns.com\/dns-query|dns.google\/resolve)/,
    async (route) => {
      const domain = new URL(route.request().url()).searchParams.get("name");
      await new Promise((r) => setTimeout(r, 30));
      await route
        .fulfill({
          status: 200,
          headers: { ...cors, "Content-Type": "application/dns-json" },
          body: JSON.stringify({ Status: isFree(domain) ? 3 : 0, Answer: [] }),
        })
        .catch(() => {});
    },
  );
  await context.route("https://rdap.verisign.com/**", async (route) => {
    const domain = route.request().url().split("/").at(-1);
    await new Promise((r) =>
      setTimeout(r, slow && hash(domain) % 3 ? 60000 : 60),
    );
    await route
      .fulfill({
        status: isFree(domain) ? 404 : 200,
        headers: { ...cors, "Content-Type": "application/rdap+json" },
        body: isFree(domain) ? "" : JSON.stringify({ ldhName: domain }),
      })
      .catch(() => {});
  });
}
const done = (page) =>
  page.waitForFunction(() => document.querySelector("#pause").hidden, null, {
    timeout: 30000,
  });
const shot = (page, name, fullPage = false) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage, animations: "disabled" });
for (const [profile, options] of [
  ["mobile", { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } }],
  ["desktop", { viewport: { width: 1440, height: 900 } }],
]) {
  const context = await browser.newContext({
    ...options,
    serviceWorkers: "block",
  });
  await mock(context);
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForSelector("#results .name-card");
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("fonts"),
  );
  await page.evaluate(() => document.fonts.ready);
  await shot(page, `${profile}-initial`);
  slow = true;
  await page.locator("#generate").click();
  await page.waitForTimeout(900);
  await shot(page, `${profile}-checking`);
  await page.locator("#pause").click();
  slow = false;
  await page.locator("#resume").click();
  await done(page);
  await page.locator("#results .save-name").nth(1).click();
  await page.waitForTimeout(300);
  await shot(page, `${profile}-results`);
  await shot(page, `${profile}-results-full`, true);
  await page.locator("#sound-controls summary").click();
  await page.locator("#domain-controls summary").click();
  await page.locator("#energy").fill("7.4");
  await page.locator("#energy").dispatchEvent("input");
  await page.waitForTimeout(300);
  await shot(page, `${profile}-folds-open`);
  await page.locator("#tab-reverse").click();
  await page.locator("#panel-reverse button[type=submit]").click();
  await page.waitForFunction(() =>
    document.querySelector("#panel-reverse .tool-status").textContent.includes("complete"),
  );
  await shot(page, `${profile}-reverse`);
  await page.locator("#tab-substitutions").click();
  await page.locator("#panel-substitutions button[type=submit]").click();
  await page.waitForFunction(() =>
    document.querySelector("#panel-substitutions .tool-status").textContent.includes("complete"),
  );
  await shot(page, `${profile}-substitutions`);
  await page.locator("#tab-saved").click();
  await shot(page, `${profile}-shortlist`);
  await context.setOffline(true);
  await page.locator("#tab-explore").click();
  await page.locator("#generate").click();
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, `${profile}-offline`);
  await context.close();
}
await browser.close();
console.log("screens written to", out);
