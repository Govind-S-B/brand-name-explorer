import assert from "node:assert/strict";
import constants from "../../core/constants.json" with { type: "json" };
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const base =
  process.env.BASE_URL || "http://127.0.0.1:4175/brand-name-explorer/";
const out = process.env.EVIDENCE_DIR || "/private/tmp/bne-history";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const reports = [];
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
      localStorage.setItem("bne.fonts.v2", "true");
    });
    await context.route(
      /https:\/\/(cloudflare-dns.com|dns.google)\//,
      (route) => {
        const domain = new URL(route.request().url()).searchParams.get("name");
        return route.fulfill({
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
    await context.route("https://rdap.verisign.com/**", (route) =>
      route.fulfill({
        status: 404,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/rdap+json",
        },
        body: "",
      }),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(20000);
    const idle = () =>
      page.waitForFunction(
        () => document.querySelector("#stage").dataset.state === "idle",
      );
    const history = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("bne.history.v1") || "[]"),
      );
    const shot = (name) =>
      page.screenshot({
        path: `${out}/${width}-${name}.png`,
        animations: "disabled",
      });
    const close = async (selector) => {
      await page.keyboard.press("Escape");
      await page.locator(selector + "[open]").waitFor({ state: "hidden" });
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
    await page.goto(base);
    await idle();
    const seeds = [],
      moods = [],
      firstNames = await page.locator("#results .name-open").allTextContents();
    for (let i = 0; i < 4; i++) {
      if (i) {
        await page.reload();
        await idle();
      }
      seeds.push(await page.locator("#seed").inputValue());
      moods.push(await page.locator("#mood-label").textContent());
      if (i)
        assert.notEqual(moods[i], moods[i - 1], "Each reload changes feeling");
      assert.equal((await history()).length, i + 1);
      assert.equal((await history())[0].source, "Opened page");
      assert.equal((await history())[0].controls.mood, moods[i]);
    }
    assert.equal(new Set(seeds).size, 4);
    assert.notDeepEqual(
      await page.locator("#results .name-open").allTextContents(),
      firstNames,
    );
    assert.equal(
      await page.locator("#github-link").getAttribute("href"),
      "https://github.com/Govind-S-B/brand-name-explorer",
    );
    assert.equal(
      await page.locator("#github-link").getAttribute("target"),
      "_blank",
    );
    await page.locator("#results .save-name").first().click();
    for (const id of ["explore", "reverse", "saved"]) {
      await page.locator("#tab-" + id).click();
      assert.equal(await page.locator(".tabs .tab-label:visible").count(), 1);
      assert.equal(
        await page.locator("#tab-" + id + " .tab-label").isVisible(),
        true,
      );
      for (const control of [
        "#tab-" + id,
        "#open-history",
        "#open-settings",
        "#github-link",
      ]) {
        const rect = await page.locator(control).boundingBox();
        assert.ok(rect.width >= 44 && rect.height >= 44, control);
      }
      await axe();
    }
    await page.locator("#tab-explore").click();
    await axe();
    await shot("feed");
    await page.locator("#open-history").click();
    await page.locator(".history-entry").first().waitFor();
    assert.equal(await page.locator(".history-entry").count(), 4);
    await page.locator("#history-filter").fill(seeds[0]);
    assert.equal(await page.locator(".history-entry").count(), 1);
    await page.locator(".history-entry summary").click();
    assert.match(
      await page.locator(".history-params").textContent(),
      new RegExp(seeds[0]),
    );
    assert.ok(
      await page.locator(".history-entry time").getAttribute("datetime"),
    );
    await axe();
    await shot("history-details");
    assert.equal(
      (await history()).length,
      4,
      "Opening details does not run a search",
    );
    const original = (await history()).at(-1);
    await page
      .getByRole("button", { name: "Run again →", exact: true })
      .click();
    await idle();
    assert.equal(await page.locator("#seed").inputValue(), seeds[0]);
    assert.equal(await page.locator("#mood-label").textContent(), moods[0]);
    assert.deepEqual(
      await page.locator("#results .name-open").allTextContents(),
      firstNames,
    );
    assert.deepEqual((await history())[0].controls, original.controls);
    assert.equal((await history())[0].source, "Run again");
    assert.equal((await history()).at(-1).at, original.at);
    await page.locator("#open-history").click();
    await page.locator(".history-entry").first().waitFor();
    await close("#history-sheet");
    await page.waitForFunction(
      () =>
        document.activeElement === document.querySelector("#open-history") &&
        !document.querySelector(".history-entry"),
    );
    assert.equal(await page.locator(".history-entry").count(), 0);
    await page.locator("#open-settings").click();
    assert.equal(await page.locator("#random-seed").isChecked(), true);
    assert.equal(
      await page.locator('#settings-sheet [role="switch"]').count(),
      1,
      "History always records",
    );
    await page.locator("#random-seed").uncheck();
    await axe();
    await shot("settings");
    await close("#settings-sheet");
    const stableSeed = await page.locator("#seed").inputValue();
    const stableMood = await page.locator("#mood-label").textContent();
    await page.reload();
    await idle();
    assert.equal(await page.locator("#seed").inputValue(), stableSeed);
    assert.equal(await page.locator("#mood-label").textContent(), stableMood);
    const previous = (await history()).length;
    await page.locator("#next").evaluate((b) => b.click());
    await idle();
    assert.equal((await history()).length, previous + 1);
    assert.equal((await history())[0].controls.page, "2");
    assert.equal((await history())[0].controls.seed, stableSeed);
    assert.equal((await history())[0].controls.mood, stableMood);
    const pageTwo = (await history())[0];
    const pageTwoNames = (
      await page.locator("#results .name-open").allTextContents()
    ).slice(20);
    await page.locator("#open-history").click();
    await page.locator(".history-entry summary").first().click();
    await page
      .getByRole("button", { name: "Run again →", exact: true })
      .click();
    await idle();
    assert.deepEqual((await history())[0].controls, pageTwo.controls);
    assert.deepEqual(
      await page.locator("#results .name-open").allTextContents(),
      pageTwoNames,
    );

    // Replay a non-default configuration after both a later search and a new seed.
    await page.locator("#mood-picker").click();
    await page.locator('[data-mood="bold"]').click();
    await page.locator("#blend").selectOption("playful");
    await page.locator("#tune").evaluate((tune) => {
      for (const [id, value] of Object.entries({
        "blend-amount": "0.6",
        energy: "7.2",
        weight: "4.3",
        novelty: "6.1",
        length: "7",
        syllables: "2",
        opening: "consonant",
        ending: "open",
        count: "50",
        page: "2",
        seed: "12345678901234567890",
        "rdap-concurrency": "3",
        "rdap-rate": "25",
        "dns-concurrency": "8",
        "dns-rate": "30",
        "dns-timeout": "1700",
        "hedge-delay": "150",
      })) {
        const field = tune.querySelector("#" + id);
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
      for (const id of ["filter-available", "use-dns"]) {
        const field = tune.querySelector("#" + id);
        field.checked = false;
        field.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await page.locator("#generate").click();
    await idle();
    const custom = (await history())[0];
    const customNames = await page
      .locator("#results .name-open")
      .allTextContents();
    assert.equal(custom.controls.explicit, "energy,weight,novelty");
    await page.locator("#open-settings").click();
    await page.locator("#random-seed").check();
    await close("#settings-sheet");
    await page.reload();
    await idle();
    assert.notEqual(
      await page.locator("#seed").inputValue(),
      custom.controls.seed,
    );
    const reloaded = (await history())[0].controls;
    assert.notEqual(reloaded.mood, custom.controls.mood);
    assert.equal(reloaded.explicit, "");
    assert.equal(reloaded.blend, "");
    for (const dial of ["energy", "weight", "novelty"])
      assert.equal(
        Number(reloaded[dial]),
        constants.moods[reloaded.mood][dial],
      );
    for (const id of [
      "length",
      "syllables",
      "opening",
      "ending",
      "count",
      "check-domains",
      "filter-available",
      "rdap-concurrency",
    ])
      assert.equal(reloaded[id], custom.controls[id]);
    await page.locator("#open-history").click();
    await page.locator("#history-filter").fill(String(custom.controls.seed));
    await page.locator(".history-entry summary").click();
    await page
      .getByRole("button", { name: "Run again →", exact: true })
      .click();
    await idle();
    assert.deepEqual((await history())[0].controls, custom.controls);
    assert.deepEqual(
      await page.locator("#results .name-open").allTextContents(),
      customNames,
    );
    await page.locator("#tab-reverse").click();
    await page.locator("#reverse-word").fill("Open AI");
    await page.locator(".pron").evaluate((e) => (e.open = true));
    await page.locator("[name=reading-mode]").selectOption("phones");
    await page.locator("[name=reading-value]").fill("OW P AH N EY AY");
    await page.locator("#panel-reverse button[type=submit]").click();
    await page.waitForFunction(
      () => document.querySelector("#panel-reverse").dataset.busy === undefined,
    );
    assert.deepEqual((await history())[0].reverse, {
      word: "Open AI",
      mode: "phones",
      value: "OW P AH N EY AY",
    });
    const reverseEntry = (await history())[0];
    const reverseNames = await page
      .locator("#panel-reverse .name-open")
      .allTextContents();
    await page.locator("#reverse-word").fill("Figma");
    await page.locator("[name=reading-mode]").selectOption("dictionary");
    await page.locator("#open-history").click();
    await page.locator(".history-entry").first().waitFor();
    await page.locator("#history-filter").fill("Open AI");
    assert.equal(await page.locator(".history-entry").count(), 1);
    await page.locator(".history-entry summary").click();
    await page
      .getByRole("button", { name: "Run again →", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector("#panel-reverse").dataset.busy === undefined,
    );
    assert.equal(await page.locator("#reverse-word").inputValue(), "Open AI");
    assert.equal(
      await page.locator("[name=reading-mode]").inputValue(),
      "phones",
    );
    assert.equal(
      await page.locator("[name=reading-value]").inputValue(),
      "OW P AH N EY AY",
    );
    assert.deepEqual((await history())[0].controls, reverseEntry.controls);
    assert.deepEqual((await history())[0].reverse, reverseEntry.reverse);
    assert.deepEqual(
      await page.locator("#panel-reverse .name-open").allTextContents(),
      reverseNames,
    );
    // Persisted history is bounded on read and on the next real search.
    await page.evaluate(
      (sample) =>
        localStorage.setItem(
          "bne.history.v1",
          JSON.stringify(
            Array.from({ length: 105 }, (_, i) => ({
              ...sample,
              id: "past-" + i,
              at: sample.at - i - 1,
            })),
          ),
        ),
      reverseEntry,
    );
    await page.reload();
    await idle();
    assert.equal((await history()).length, 100);
    await page.locator("#open-history").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".history-entry").length === 100,
    );
    await shot("history-full");
    await close("#history-sheet");
    await page.locator("#open-settings").click();
    await page.locator("#clear-history").click();
    assert.deepEqual(await history(), []);
    await close("#settings-sheet");
    await page.locator("#open-history").click();
    await page.locator(".empty-history").waitFor();
    await axe();
    await shot("history-empty");
    await close("#history-sheet");
    await page.evaluate(() =>
      localStorage.setItem("bne.history.v1", "{broken"),
    );
    await page.reload();
    await idle();
    assert.equal((await history()).length, 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    reports.push({
      width,
      newSeeds: true,
      differentFeelingsOnReload: true,
      threeReloadsKept: true,
      fullParameters: true,
      exactExploreAndReverseReruns: true,
      bounded100: true,
      corruptHistoryRecovery: true,
      alwaysRecords: true,
      clear: true,
      compactNav: true,
      axe: 0,
    });
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key === "bne.preferences.v2") return '{"check-domains":false}';
      return get.call(this, key);
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector("#results .name-card");
  assert.match(
    await page.locator("#notice").textContent(),
    /storage is unavailable/,
  );
  await page.locator("#open-history").click();
  await page.locator(".history-entry").waitFor();
  await page.locator(".history-entry summary").click();
  await page.getByRole("button", { name: "Run again →", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#stage").dataset.state === "idle",
  );
  assert.deepEqual(errors, []);
  await context.close();
  reports.push({
    storageUnavailable: "generation and in-memory history work; warning shown",
  });
} finally {
  await browser.close();
}
console.log(JSON.stringify(reports, null, 2));
