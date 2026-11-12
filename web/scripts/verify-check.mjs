/** Inline checks with controlled providers; does not certify real availability. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const base =
  process.env.BASE_URL || "http://127.0.0.1:4174/brand-name-explorer/";
const out = process.env.EVIDENCE_DIR || "/private/tmp/bne-inline-check";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const results = [];
try {
  for (const width of [360, 390, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 1440 ? 1000 : 844 },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript(() => {
      if (!localStorage.getItem("bne.preferences.v2"))
        localStorage.setItem(
          "bne.preferences.v2",
          JSON.stringify({ "check-domains": false }),
        );
      if (!localStorage.getItem("bne.shortlist.v1"))
        localStorage.setItem(
          "bne.shortlist.v1",
          JSON.stringify({
            "goftu.com": { name: "Goftu", domain: "goftu.com", addedAt: 1 },
            "name:open ai": { name: "Open AI", addedAt: 2 },
          }),
        );
      localStorage.setItem("bne.fonts.v2", "true");
    });
    const counts = new Map(),
      responses = new Map(),
      holds = new Map();
    let requests = 0;
    const hold = (domain) => {
      let release;
      holds.set(
        domain,
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      return () => {
        holds.delete(domain);
        release();
      };
    };
    await context.route(
      /https:\/\/(cloudflare-dns.com|dns.google)\//,
      async (route) => {
        requests++;
        const domain = new URL(route.request().url()).searchParams.get("name");
        await route
          .fulfill({
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Content-Type": "application/dns-json",
            },
            body: JSON.stringify({
              Status: 3,
              Question: [{ name: domain, type: 2 }],
              Answer: [],
            }),
          })
          .catch(() => {});
      },
    );
    await context.route("https://rdap.verisign.com/**", async (route) => {
      requests++;
      const domain = route.request().url().split("/").at(-1);
      counts.set(domain, (counts.get(domain) || 0) + 1);
      await (holds.get(domain) || new Promise((r) => setTimeout(r, 160)));
      const code = responses.get(domain) || 404;
      await route
        .fulfill({
          status: code,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": "application/rdap+json",
          },
          body: code === 200 ? JSON.stringify({ ldhName: domain }) : "",
        })
        .catch(() => {});
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(20000);
    const status = (text) =>
      page.waitForFunction(
        (t) => document.querySelector("#ns-status").textContent === t,
        text,
      );
    const stage = (text) =>
      page.waitForFunction(
        (t) => document.querySelector("#stage").dataset.state === t,
        text,
      );
    const close = () => page.keyboard.press("Escape");
    const openSaved = async (name) => {
      await page.locator("#tab-saved").click();
      await page
        .locator("#saved-list")
        .getByRole("button", { name, exact: true })
        .click();
    };
    const feedSnapshot = () =>
      page.evaluate(() => ({
        domains: [...document.querySelectorAll("#results .name-card")].map(
          (e) => e.dataset.domain,
        ),
        meter: document.querySelector("#meter").style.width,
        state: document.querySelector("#stage").dataset.state,
        text: document.querySelector("#run-status").textContent,
      }));
    const awaitCall = async (domain, n = 1) => {
      const stop = Date.now() + 10000;
      while ((counts.get(domain) || 0) < n && Date.now() < stop)
        await new Promise((r) => setTimeout(r, 20));
      assert.ok(counts.get(domain) >= n, `${domain} request ${n}`);
    };
    const shot = (name) =>
      page.screenshot({
        path: `${out}/${width}-${name}.png`,
        animations: "disabled",
      });
    const axe = async () =>
      assert.deepEqual(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
        [],
      );
    await page.goto(base);
    await stage("idle");
    const originalFeed = await feedSnapshot();
    await openSaved("Goftu");
    await page.locator("#ns-nearby button").click();
    await page
      .locator("#ns-nearby")
      .getByRole("button", { name: "Goftoo", exact: true })
      .click();
    await status("Not checked yet");
    assert.equal(requests, 0);
    const check = page.locator("#ns-check");
    assert.equal(await check.getAttribute("aria-label"), "Check goftoo.com");
    const box = await check.boundingBox(),
      pill = await page.locator("#ns-status").boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44);
    assert.ok(Math.abs(box.x - pill.x - pill.width) < 2);
    await axe();
    await shot("unchecked");
    let release = hold("goftoo.com");
    await check.focus();
    await page.keyboard.press("Enter");
    await status("Checking…");
    await check.dispatchEvent("click");
    assert.equal(
      await check
        .locator("svg")
        .evaluate((e) => getComputedStyle(e).animationName),
      "none",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(
      await check
        .locator("svg")
        .evaluate((e) => getComputedStyle(e).animationName),
      "spin",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await check.getAttribute("aria-disabled"), "true");
    await page.locator("#ns-save").click();
    assert.equal(
      await page.locator("#ns-save").getAttribute("aria-pressed"),
      "true",
    );
    await awaitCall("goftoo.com");
    await shot("checking");
    await page.locator("#ns-back").click();
    await status("Not checked yet");
    release();
    await page
      .locator('#ns-nearby [data-domain="goftoo.com"][data-status="available"]')
      .waitFor();
    assert.equal(await page.locator("#ns-name").textContent(), "Goftu");
    await page
      .locator("#ns-nearby")
      .getByRole("button", { name: "Goftoo", exact: true })
      .click();
    await status("Possibly available");
    assert.equal(counts.get("goftoo.com"), 1);
    assert.match(
      await page.locator("#ns-note").textContent(),
      /Checked.*registry/,
    );
    assert.equal(await page.locator("#ns-open").textContent(), "Registry ↗");
    await axe();
    await shot("available");
    responses.set("goftoo.com", 200);
    const previousNote = await page.locator("#ns-note").textContent();
    await check.click();
    await status("Registered");
    assert.equal(counts.get("goftoo.com"), 2);
    assert.notEqual(await page.locator("#ns-note").textContent(), previousNote);
    assert.equal(
      await page.locator("#ns-open").getAttribute("href"),
      "https://goftoo.com",
    );
    assert.deepEqual(await feedSnapshot(), originalFeed);
    await close();
    await page.reload();
    await stage("idle");
    const beforeCache = requests;
    await openSaved("Goftoo");
    await status("Registered");
    assert.equal(requests, beforeCache);
    responses.set("goftoo.com", 403);
    await check.click();
    await page.waitForFunction(() =>
      document.querySelector("#ns-note").textContent.includes("Refresh failed"),
    );
    await status("Registered");
    assert.match(
      await page.locator("#ns-note").textContent(),
      /Previous result:.*Checked/,
    );
    assert.equal(
      await check.getAttribute("aria-label"),
      "Retry check for goftoo.com",
    );
    await shot("refresh-failed");
    await axe();
    responses.set("goftoo.com", 404);
    await check.click();
    await status("Possibly available");
    await close();
    await openSaved("Goftu");
    responses.set("goftu.com", 403);
    await check.click();
    await status("Not confirmed");
    await shot("failed");
    await context.setOffline(true);
    await page.waitForFunction(() => !navigator.onLine);
    const beforeOffline = requests;
    await check.click();
    await page.waitForFunction(() =>
      document.querySelector("#ns-note").textContent.includes("offline"),
    );
    assert.equal(requests, beforeOffline);
    await context.setOffline(false);
    await page.waitForFunction(() => navigator.onLine);
    responses.set("goftu.com", 404);
    await check.click();
    await status("Possibly available");
    await close();
    await openSaved("Open AI");
    assert.equal(await check.isVisible(), false);
    await close();

    if (width === 390) {
      const startFeed = async (seed, count = "20") => {
        await page.locator("#tab-explore").click();
        await page.locator("#mood-picker").click();
        await page.locator("#domain-controls").evaluate((e) => (e.open = true));
        await page.locator("#check-domains").check();
        await page.locator("#filter-available").uncheck();
        await page.locator("#use-dns").uncheck();
        await page.locator("#seed").evaluate((e, value) => {
          e.value = value;
        }, seed);
        await page.locator("#count").evaluate((e) => {
          for (
            let parent = e.parentElement;
            parent;
            parent = parent.parentElement
          )
            if (parent.tagName === "DETAILS") parent.open = true;
        });
        await page.locator("#count").selectOption(count);
        await page.locator("#generate").click();
      };
      // Feed completion must not cancel a pending explicit check or count it as a result.
      await startFeed("631");
      release = hold("goftoo.com");
      await openSaved("Goftoo");
      await check.click();
      await status("Checking…");
      await stage("done");
      await status("Checking…");
      assert.match(
        await page.locator("#lookup-stats").textContent(),
        /RDAP 20 ·/,
      );
      const completedFeed = await feedSnapshot();
      release();
      await status("Possibly available");
      assert.deepEqual(await feedSnapshot(), completedFeed);
      assert.equal(completedFeed.domains.length, 20);
      assert.equal(completedFeed.domains.includes("goftoo.com"), false);
      await close();
      // A changed result already in the feed also corrects its availability total.
      const changedDomain = completedFeed.domains[0];
      responses.set(changedDomain, 200);
      await page.locator("#tab-explore").click();
      await page.locator("#results .name-open").first().click();
      await check.click();
      await status("Registered");
      assert.match(
        await page.locator("#run-status").textContent(),
        /20 names · 19 possibly available/,
      );
      assert.match(
        await page.locator("#lookup-stats").textContent(),
        /RDAP 20 ·/,
      );
      assert.equal(await page.locator("#results .name-card").count(), 20);
      await close();
      // Pause/replacement closes the old engine but reschedules explicit checks.
      for (const replace of [false, true]) {
        await startFeed(replace ? "633" : "632", "200");
        release = hold("goftoo.com");
        const before = counts.get("goftoo.com");
        await openSaved("Goftoo");
        await check.click();
        await awaitCall("goftoo.com", before + 1);
        await close();
        if (replace) await startFeed("634");
        else {
          await page.locator("#tab-explore").click();
          await page.locator("#pause").click();
          await stage("paused");
        }
        await awaitCall("goftoo.com", before + 2);
        release();
        await openSaved("Goftoo");
        await status("Possibly available");
        await stage(replace ? "done" : "paused");
        await close();
      }
      // Offline during a request ends the spinner and preserves the earlier check.
      release = hold("goftoo.com");
      await openSaved("Goftoo");
      await check.click();
      await status("Checking…");
      await context.setOffline(true);
      await page.waitForFunction(() =>
        document.querySelector("#ns-note").textContent.includes("offline"),
      );
      await status("Possibly available");
      release();
      await context.setOffline(false);
      await page.waitForFunction(() => navigator.onLine);
      await check.click();
      await status("Possibly available");
      await close();
      // Another tab's lock produces a retryable explanation, not a false status.
      await page.evaluate(() => {
        window.lockHeld = false;
        void navigator.locks.request(
          "bne-domain-search",
          () =>
            new Promise((resolve) => {
              window.unlock = resolve;
              window.lockHeld = true;
            }),
        );
      });
      await page.waitForFunction(() => window.lockHeld);
      await openSaved("Goftoo");
      await check.click();
      await page.waitForFunction(() =>
        document
          .querySelector("#ns-note")
          .textContent.includes("Another explorer tab"),
      );
      await page.evaluate(() => window.unlock());
      await check.click();
      await status("Possibly available");
      await close();
    }
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    results.push({
      width,
      cachedRead: true,
      refreshRetryOffline: true,
      sharedStatus: true,
      feedUnchanged: true,
      axeViolations: 0,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
