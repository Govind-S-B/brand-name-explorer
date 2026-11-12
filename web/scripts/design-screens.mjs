/** Design review screenshots of every UI state, with mocked RDAP/DoH so states
 * are deterministic. Start `npm run preview:pages` first.
 * Usage: node scripts/design-screens.mjs [outDir] [profiles=mobile,mobile360,desktop] */
import { chromium, devices } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const out = resolve(process.argv[2] || "docs/screenshots");
const only = (process.argv[3] || "mobile,mobile360,desktop").split(",");
await mkdir(out, { recursive: true });
const base = process.env.BASE_URL || "http://127.0.0.1:4173/brand-name-explorer/";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
// Stable pseudo-random outcome per domain: roughly two in five available.
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const isFree = (d) => hash(d) % 5 < 2;
let delay = 40;
async function mock(context) {
  const cors = { "Access-Control-Allow-Origin": "*" };
  await context.route(
    /https:\/\/(cloudflare-dns.com\/dns-query|dns.google\/resolve)/,
    async (route) => {
      const domain = new URL(route.request().url()).searchParams.get("name");
      await new Promise((r) => setTimeout(r, 20));
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
    await new Promise((r) => setTimeout(r, delay));
    await route
      .fulfill({
        status: isFree(domain) ? 404 : 200,
        headers: { ...cors, "Content-Type": "application/rdap+json" },
        body: isFree(domain) ? "" : JSON.stringify({ ldhName: domain }),
      })
      .catch(() => {});
  });
}
const state = (page, value, timeout = 30000) =>
  page.waitForFunction((v) => document.querySelector("#stage").dataset.state === v, value, { timeout });
const settle = (page) => page.waitForTimeout(350);
const profiles = {
  mobile: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } },
  mobile360: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 740 } },
  desktop: { viewport: { width: 1440, height: 900 } },
};
for (const name of only) {
  const context = await browser.newContext({ ...profiles[name], serviceWorkers: "block" });
  await mock(context);
  const page = await context.newPage();
  const shot = (label, fullPage = false) =>
    page.screenshot({ path: `${out}/v2-${name}-${label}.png`, fullPage, animations: "disabled" });
  delay = 2500;
  await page.goto(base);
  await page.waitForTimeout(400);
  await shot("loading");
  delay = 40;
  await state(page, "done");
  // Second visit (fonts enabled from <head>, as for a returning user) with an
  // uncached mood, so checks are live.
  delay = 900;
  await page.evaluate(() => localStorage.setItem("bne.preferences.v2", JSON.stringify({ mood: "lyrical" })));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("#results .name-card").length >= 4);
  await page.evaluate(() => document.fonts.ready);
  await shot("checking");
  delay = 40;
  await state(page, "done");
  await page.evaluate(() => localStorage.removeItem("bne.preferences.v2"));
  await page.reload();
  await state(page, "done");
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#results .save-name").nth(1).click();
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  await shot("feed");
  await shot("feed-full", true);
  await page.locator("#results .name-open").first().click();
  await page.waitForFunction(() => document.querySelector("#ns-sound .dialbars"));
  await settle(page);
  await shot("name-sheet");
  await page.locator("#ns-nearby button").click();
  await page.waitForFunction(() => document.querySelector("#ns-nearby .analysis-card"));
  await page.locator("#name-sheet").evaluate((d) => (d.scrollTop = d.scrollHeight));
  await settle(page);
  await shot("name-sheet-nearby");
  await page.keyboard.press("Escape");
  await page.locator("#mood-chip").click();
  await settle(page);
  await shot("tune");
  await page.locator("#mood-controls").evaluate((d) => (d.open = false));
  await page.locator("#sound-controls").evaluate((d) => (d.open = true));
  await settle(page);
  await shot("tune-sound");
  await page.locator("#sound-controls").evaluate((d) => (d.open = false));
  await page.locator("#domain-controls").evaluate((d) => (d.open = true));
  await page.locator("#advanced-controls").evaluate((d) => (d.open = true));
  await settle(page);
  await shot("tune-domains");
  // Reveal registered names (the toggle) and apply.
  await page.locator("#filter-available").uncheck();
  await page.locator("#generate").click();
  await state(page, "done");
  await settle(page);
  await shot("all-names");
  await page.locator("#tune-btn").click();
  await page.locator("#filter-available").check();
  await page.locator("#generate").click();
  await state(page, "done");
  await page.locator("#next").click();
  await state(page, "done");
  await page.locator("#next").scrollIntoViewIfNeeded();
  await settle(page);
  await shot("load-more");
  // Error: a second tab cannot check while this one holds the lookup lock.
  delay = 20000;
  await page.locator("#mood-chip").click();
  await page.locator("[data-mood=strange]").click();
  await page.locator("#generate").click();
  const second = await context.newPage();
  await second.goto(base);
  await state(second, "error");
  await second.evaluate(() => document.fonts.ready);
  await second.waitForTimeout(350);
  await second.screenshot({ path: `${out}/v2-${name}-error.png`, animations: "disabled" });
  await second.close();
  delay = 40;
  await page.locator("#mood-chip").click();
  await page.locator("[data-mood=calm]").click();
  await page.locator("#generate").click();
  await state(page, "done");
  await page.locator("#tab-reverse").click();
  await settle(page);
  await shot("reverse");
  await page.locator("#reverse-word").fill("figma");
  await page.locator("#panel-reverse button[type=submit]").click();
  await page.waitForFunction(() =>
    document.querySelector("#panel-reverse .tool-status").textContent.includes("complete"),
  );
  await settle(page);
  await shot("reverse-result");
  await page.locator("[data-follow=substitutions]").click();
  await page.waitForFunction(() => document.querySelector("#panel-reverse .tool-more .analysis-card"));
  await page.locator("#panel-reverse .tool-more").scrollIntoViewIfNeeded();
  await settle(page);
  await shot("reverse-nearby");
  await page.locator("#tab-saved").click();
  await settle(page);
  await shot("shortlist");
  await page.locator("#saved-list .save-name").click();
  await settle(page);
  await shot("shortlist-empty");
  await page.locator("#tab-explore").click();
  await context.setOffline(true);
  await page.locator("#tune-btn").click();
  await page.locator("#generate").click();
  await state(page, "offline");
  await settle(page);
  await shot("offline");
  await context.close();
  console.log(name, "done");
}
await browser.close();
console.log("screens written to", out);
