/** Shared name affordances. Run after build + preview; providers are mocked. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const base =
  process.env.BASE_URL || "http://127.0.0.1:4174/brand-name-explorer/";
const out = process.env.EVIDENCE_DIR || "/private/tmp/bne-name-affordances";
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
          }),
        );
      localStorage.setItem("bne.fonts.v2", "true");
    });
    let requests = 0;
    await context.route(
      /https:\/\/(cloudflare-dns.com|dns.google)\//,
      async (route) => {
        requests++;
        const domain = new URL(route.request().url()).searchParams.get("name");
        await route.fulfill({
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
        });
      },
    );
    await context.route("https://rdap.verisign.com/**", async (route) => {
      requests++;
      const domain = route.request().url().split("/").at(-1);
      await new Promise((r) => setTimeout(r, 250));
      await route.fulfill({
        status: domain === "limesha.com" ? 200 : 404,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/rdap+json",
        },
        body:
          domain === "limesha.com" ? JSON.stringify({ ldhName: domain }) : "",
      });
    });
    await context.addInitScript(() => localStorage.setItem("bne.settings.v1", JSON.stringify({ randomSeed: false })));
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(20000);
    const row = (root, name) =>
      page
        .locator(root + " .name-card")
        .filter({ has: page.getByRole("button", { name, exact: true }) });
    const sheetName = async (name) => {
      await page.waitForFunction(
        (n) =>
          document.querySelector("#name-sheet").open &&
          document.querySelector("#ns-name").textContent === n,
        name,
      );
    };
    const fit = () => page.locator("#ns-sound .dialbars").waitFor();
    const close = async () => {
      await page.keyboard.press("Escape");
      await page.locator("#name-sheet[open]").waitFor({ state: "hidden" });
    };
    const axe = async () =>
      assert.deepEqual(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze()
        ).violations,
        [],
      );
    const shot = (name) =>
      page.screenshot({
        path: `${out}/${width}-${name}.png`,
        animations: "disabled",
      });
    const reverse = async (word, phones) => {
      await page.locator("#tab-reverse").click();
      await page.locator("#reverse-word").fill(word);
      await page.locator(".pron").evaluate((e) => (e.open = true));
      await page
        .locator("[name=reading-mode]")
        .selectOption(phones ? "phones" : "dictionary");
      if (phones) await page.locator("[name=reading-value]").fill(phones);
      await page.locator("#panel-reverse button[type=submit]").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#panel-reverse").dataset.busy === undefined,
      );
    };
    await page.goto(base);
    await page.locator("#results .name-open").first().waitFor();
    // Existing feed entry point and Close focus.
    const first = page.locator("#results .name-open").first();
    await first.click();
    await fit();
    await close();
    assert.equal(
      await first.evaluate((e) => e === document.activeElement),
      true,
    );
    // Closing a name and immediately opening Tune must not let the queued close
    // handler steal its keyboard focus (especially the non-modal desktop panel).
    await first.click();
    await page.evaluate(async () => {
      const sheet = document.querySelector("#name-sheet"),
        mood = document.querySelector("#mood-picker");
      const closed = new Promise((resolve) =>
        sheet.addEventListener("close", resolve, { once: true }),
      );
      sheet.close();
      mood.focus();
      mood.click();
      await closed;
    });
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        document.querySelector("#mood-picker").getAttribute("aria-expanded") ===
        "false",
    );
    assert.equal(
      await page
        .locator("#mood-picker")
        .evaluate((e) => e === document.activeElement),
      true,
    );
    // User's exact Goftu -> Goftoo example; the list checks domains automatically.
    await page.locator("#tab-saved").click();
    await row("#saved-list", "Goftu").locator(".name-open").click();
    await fit();
    await page.locator("#ns-nearby button").click();
    await row("#ns-nearby", "Goftoo").waitFor();
    assert.equal(
      await row("#ns-nearby", "Goftoo").locator(".name-note").innerText(),
      "Same sounds · 1 extra letter",
    );
    await row("#ns-nearby", "Goftoo").locator(".save-name").click();
    assert.equal(await page.locator("#ns-name").textContent(), "Goftu");
    const original = await page
      .locator("#ns-nearby .name-open")
      .allTextContents();
    const goftoo = row("#ns-nearby", "Goftoo").locator(".name-open");
    await goftoo.scrollIntoViewIfNeeded();
    await goftoo.focus();
    const scroll = await page
      .locator("#name-sheet")
      .evaluate((e) => e.scrollTop);
    await axe();
    await shot("nearby");
    await page.keyboard.press("Enter");
    await sheetName("Goftoo");
    await fit();
    assert.equal(
      await page.locator("#ns-save").getAttribute("aria-pressed"),
      "true",
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#ns-status").textContent ===
        "Possibly available",
    );
    assert.match(
      await page.locator("#ns-open").getAttribute("href"),
      /lookup.icann.org.*goftoo.com/,
    );
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page.locator("#ns-save").click();
    await axe();
    await shot("child");
    await page.locator("#ns-back").click();
    await sheetName("Goftu");
    await page.waitForFunction(
      () =>
        document.activeElement?.classList.contains("name-open") &&
        document.activeElement.textContent === "Goftoo",
    );
    assert.deepEqual(
      await page.locator("#ns-nearby .name-open").allTextContents(),
      original,
    );
    assert.equal(
      await goftoo.evaluate((e) => e === document.activeElement),
      true,
    );
    assert.ok(
      Math.abs(
        (await page.locator("#name-sheet").evaluate((e) => e.scrollTop)) -
          scroll,
      ) < 2,
    );
    assert.equal(
      await row("#ns-nearby", "Goftoo")
        .locator(".save-name")
        .getAttribute("aria-pressed"),
      "false",
    );
    // Child settings, not parent settings, apply from its full modal.
    await goftoo.click();
    await fit();
    const childDials = await page
      .locator("#ns-sound .dialbars b")
      .allTextContents();
    await page
      .locator("#ns-sound")
      .getByRole("button", { name: "Explore similar →" })
      .click();
    await page.locator("#name-sheet[open]").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#length").inputValue(), "6");
    for (const [i, dial] of ["energy", "weight", "novelty"].entries())
      assert.equal(await page.locator("#" + dial).inputValue(), childDials[i]);
    assert.ok(requests > 0);
    await page.waitForFunction(
      () => document.querySelector("#stage").dataset.state === "idle",
    );
    if (width === 390) {
      await page.locator("#tab-saved").click();
      await row("#saved-list", "Goftu").locator(".name-open").click();
      for (let depth = 0; depth < 22; depth++) {
        await fit();
        await page.locator("#ns-nearby button").click();
        await page.locator("#ns-nearby .name-open").first().click();
      }
      let steps = 0;
      while (await page.locator("#ns-back").isVisible()) {
        await page.locator("#ns-back").click();
        assert.ok(++steps <= 20);
      }
      assert.equal(steps, 20);
      await close();
    }

    // Reverse reference and every sample use the ordinary row/modal/heart.
    await reverse("figma");
    await page.locator(".candidate .name-card").first().waitFor();
    await axe();
    await shot("reverse");
    for (const root of [".reference-name", ".candidate .samples"]) {
      const opener = page.locator(root + " .name-open").first();
      const name = await opener.textContent();
      await opener.click();
      await sheetName(name);
      await fit();
      await page.locator("#ns-save").click();
      await close();
      assert.equal(
        await page
          .locator(root + " .save-name")
          .first()
          .getAttribute("aria-pressed"),
        "true",
      );
    }
    const sample = await page
      .locator(".candidate .name-open")
      .first()
      .textContent();
    for (const duplicate of await page
      .locator(".candidate .name-card")
      .filter({ has: page.getByRole("button", { name: sample, exact: true }) })
      .all())
      assert.equal(
        await duplicate.locator(".save-name").getAttribute("aria-pressed"),
        "true",
      );
    await page.locator("[data-follow=substitutions]").click();
    await page.locator(".tool-more .name-card").first().waitFor();
    const reverseNearby = page.locator(".tool-more .name-open").first(),
      nearbyName = await reverseNearby.textContent();
    await reverseNearby.click();
    await sheetName(nearbyName);
    await fit();
    await close();
    // Rapid root navigation cannot let the old analysis paint into the new modal.
    await page.locator(".candidate .name-open").first().click();
    await close();
    await page.locator(".reference-name .name-open").click();
    await sheetName("Figma");
    await fit();
    assert.equal(
      await page
        .locator("#ns-sound .chips")
        .innerText()
        .then((s) => s.includes("5 letters")),
      true,
    );
    await close();
    // Arbitrary reference text remains saveable; no fabricated domain, same reading.
    await reverse("Open AI", "OW P AH N EY AY");
    await page.locator(".reference-name .name-open").click();
    await sheetName("Open AI");
    await page
      .getByText("No matching generator settings", { exact: true })
      .waitFor();
    assert.equal(await page.locator("#ns-open").isVisible(), false);
    assert.equal(
      await page.locator("#ns-sound .phones").textContent(),
      "OW P AH N EY AY",
    );
    await page.locator("#ns-save").click();
    await close();
    await page.reload();
    await page.locator("#results .name-open").first().waitFor();
    await page.locator("#tab-saved").click();
    await row("#saved-list", "Open AI").locator(".name-open").click();
    await sheetName("Open AI");
    await page
      .getByText("No matching generator settings", { exact: true })
      .waitFor();
    assert.equal(
      await page.locator("#ns-sound .phones").textContent(),
      "OW P AH N EY AY",
    );
    await axe();
    await shot("reference");
    await close();
    // Background feed checks synchronize status with duplicate rows and the modal.
    await reverse("nisolan");
    await page.locator("#tab-explore").click();
    await page.locator("#mood-picker").click();
    await page.locator("#more-moods").evaluate((d) => (d.open = true));
    await page.locator("[data-mood=calm]").click();
    await page.locator("#spelling-controls").evaluate((e) => (e.open = true));
    await page.locator("#length").fill("7");
    await page.locator("#sound-controls").evaluate((e) => (e.open = true));
    await page.locator("#syllables").selectOption("");
    await page.locator("#opening").selectOption("any");
    await page.locator("#ending").selectOption("");
    await page.locator("#domain-controls").evaluate((e) => (e.open = true));
    await page.locator("#check-domains").check();
    await page.locator("#filter-available").uncheck();
    await page.locator("#generate").click();
    await page.locator("#tab-reverse").click();
    await page.locator(".reference-name .name-open").click();
    await sheetName("Nisolan");
    await page.waitForFunction(
      () =>
        document.querySelector("#ns-status").textContent ===
        "Possibly available",
    );
    await close();
    assert.equal(
      await page.locator(".reference-name .domain-status").textContent(),
      "possibly available",
    );
    await page.waitForFunction(
      () => document.querySelector("#stage").dataset.state === "done",
    );
    assert.equal(await page.locator("#results .name-card").count(), 20);
    await page.locator("#tab-explore").click();
    await row("#results", "Limesha").locator(".name-open").click();
    await sheetName("Limesha");
    assert.equal(await page.locator("#ns-status").textContent(), "Registered");
    assert.equal(
      await page.locator("#ns-open").getAttribute("href"),
      "https://limesha.com",
    );
    await close();
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    results.push({
      width,
      sharedRows: true,
      backAndFocus: true,
      readingPreserved: true,
      statusSync: true,
      axeViolations: 0,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
