import { chromium, devices } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const names = JSON.parse(
  await readFile(new URL("./workload.json", import.meta.url)),
);
const followup = process.argv.includes("--followup");
const out = new URL(
  followup
    ? "../docs/browser-throughput-followup.json"
    : "../docs/browser-throughput-results.json",
  import.meta.url,
);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const results = [];
for (const profile of ["desktop", "mobile-slow4g"]) {
  const context = await browser.newContext(
    profile === "desktop"
      ? { viewport: { width: 1440, height: 1000 } }
      : { ...devices["iPhone 13"], defaultBrowserType: undefined },
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
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
  await page.goto("http://127.0.0.1:5173");
  let wire = [];
  let ends = new Map();
  cdp.on("Network.responseReceived", (e) => {
    if (/rdap.verisign|cloudflare-dns|dns.google/.test(e.response.url))
      wire.push({
        id: e.requestId,
        host: new URL(e.response.url).host,
        protocol: e.response.protocol,
        connection: e.response.connectionId,
        status: e.response.status,
        start: e.response.timing
          ? e.response.timing.requestTime + e.response.timing.sendStart / 1000
          : e.timestamp,
        end: e.timestamp,
      });
  });
  cdp.on("Network.loadingFinished", (e) => ends.set(e.requestId, e.timestamp));
  const cases = followup
    ? ["gated", "split-short", "split-idle"].map((mode) => ({
        mode,
        concurrency: 6,
        dnsConcurrency: 24,
        count: 240,
      }))
    : [
        ...[1, 6, 12].map((c) => ({
          mode: "rdap",
          concurrency: c,
          count: 120,
        })),
        ...["cloudflare", "google"].flatMap((provider) =>
          [4, 12, 24, 48].map((c) => ({
            mode: "dns",
            provider,
            concurrency: c,
            count: 128,
          })),
        ),
        ...["rdap", "gated", "hedged", "split-gated", "split-hedged"].map(
          (mode) => ({ mode, concurrency: 6, dnsConcurrency: 24, count: 240 }),
        ),
      ];
  for (const config of cases) {
    wire = [];
    ends = new Map();
    const result = await page.evaluate(
      async ({ config, names }) => {
        const start = performance.now(),
          samples = [],
          dnsSamples = [],
          counts = { rdap: 0, dns: 0, skipped: 0, hedged: 0 },
          outcomes = {},
          providerOutcomes = {};
        const running = { rdap: 0, dns: 0 },
          queue = { rdap: [], dns: [] };
        const cap = {
          rdap: config.concurrency,
          dns:
            config.mode === "dns"
              ? config.concurrency
              : config.dnsConcurrency || 24,
        };
        async function slot(type, fn) {
          if (running[type] >= cap[type])
            await new Promise((r) => queue[type].push(r));
          running[type]++;
          try {
            return await fn();
          } finally {
            running[type]--;
            queue[type].shift()?.();
          }
        }
        async function rdap(domain) {
          return slot("rdap", async () => {
            const s = performance.now();
            counts.rdap++;
            let result;
            try {
              const r = await fetch(
                "https://rdap.verisign.com/com/v1/domain/" + domain,
                {
                  cache: "no-store",
                  headers: { Accept: "application/rdap+json" },
                  signal: AbortSignal.timeout(10000),
                },
              );
              const body = await r.text();
              result =
                r.status === 200 &&
                JSON.parse(body).ldhName?.toLowerCase() === domain
                  ? "registered"
                  : r.status === 404 &&
                      ((body.trim() === "" &&
                        r.headers
                          .get("content-type")
                          ?.includes("application/rdap+json")) ||
                        JSON.parse(body).errorCode === 404)
                    ? "available"
                    : "HTTP " + r.status;
            } catch (e) {
              result = String(e);
            }
            samples.push({
              domain,
              start: s - start,
              end: performance.now() - start,
              ms: performance.now() - s,
              result,
            });
            outcomes[result] = (outcomes[result] || 0) + 1;
            return result;
          });
        }
        async function dns(domain, index) {
          return slot("dns", async () => {
            const s = performance.now();
            counts.dns++;
            const provider =
              config.provider ||
              (config.mode.startsWith("split") && index % 2
                ? "google"
                : "cloudflare");
            let result;
            try {
              const url =
                provider === "google"
                  ? "https://dns.google/resolve"
                  : "https://cloudflare-dns.com/dns-query";
              const r = await fetch(url + "?name=" + domain + "&type=NS", {
                cache: "no-store",
                headers: { Accept: "application/dns-json" },
                signal: AbortSignal.timeout(
                  config.mode.includes("short") ? 500 : 5000,
                ),
              });
              const b = await r.json();
              result =
                r.status !== 200
                  ? "HTTP " + r.status
                  : b.Status === 0 &&
                      b.Answer?.some(
                        (a) =>
                          a.type === 2 &&
                          a.name.toLowerCase().replace(/\.$/, "") === domain,
                      )
                    ? "ns"
                    : b.Status === 3
                      ? "nxdomain"
                      : b.Status === 0
                        ? "no_ns"
                        : "DNS " + b.Status;
            } catch (e) {
              result = String(e);
            }
            dnsSamples.push({
              domain,
              provider,
              start: s - start,
              end: performance.now() - start,
              ms: performance.now() - s,
              result,
            });
            providerOutcomes[result] = (providerOutcomes[result] || 0) + 1;
            return result;
          });
        }
        const rows = await Promise.all(
          names.slice(0, config.count).map(async (domain, i) => {
            if (config.mode === "rdap") return rdap(domain);
            if (config.mode === "dns") return dns(domain, i);
            const checking = dns(domain, i);
            let d;
            if (
              config.mode.includes("hedged") ||
              config.mode.includes("idle")
            ) {
              d = await Promise.race([
                checking,
                new Promise((r) =>
                  setTimeout(
                    () => r("pending"),
                    config.mode.includes("idle") ? 0 : 250,
                  ),
                ),
              ]);
              if (d === "pending" && running.rdap >= cap.rdap)
                d = await checking;
            } else d = await checking;
            if (d === "ns") {
              counts.skipped++;
              return "registered";
            }
            if (d === "pending") counts.hedged++;
            return rdap(domain);
          }),
        );
        const elapsed = performance.now() - start;
        const stats = (ss) => {
          const sorted = ss.map((s) => s.ms).sort((a, b) => a - b),
            half = ss
              .slice()
              .sort((a, b) => a.end - b.end)
              .slice(Math.floor(ss.length / 2));
          return {
            count: ss.length,
            p50: sorted[Math.floor(sorted.length * 0.5)] || null,
            p95: sorted[Math.floor(sorted.length * 0.95)] || null,
            max: sorted.at(-1) || null,
            sustainedPerSecond:
              half.length > 1
                ? ((half.length - 1) * 1000) / (half.at(-1).end - half[0].end)
                : null,
          };
        };
        return {
          elapsedMs: elapsed,
          throughput: (rows.length * 1000) / elapsed,
          rdap: stats(samples),
          dns: stats(dnsSamples),
          counts,
          outcomes,
          dnsOutcomes: providerOutcomes,
          rows,
          samples,
          dnsSamples,
        };
      },
      { config, names },
    );
    const protocols = {};
    for (const r of wire) {
      const key = r.host + " " + r.protocol;
      protocols[key] = (protocols[key] || 0) + 1;
      r.end = ends.get(r.id) || r.end;
    }
    const peaks = {};
    for (const host of new Set(wire.map((r) => r.host))) {
      const events = wire
        .filter((r) => r.host === host)
        .flatMap((r) => [
          [r.start, 1],
          [r.end, -1],
        ])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let n = 0,
        peak = 0;
      for (const e of events) {
        n += e[1];
        peak = Math.max(peak, n);
      }
      peaks[host] = peak;
    }
    results.push({ profile, config, ...result, protocols, wirePeaks: peaks });
    await writeFile(
      out,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          chrome: browser.version(),
          profiles: {
            desktop: "unthrottled 1440x1000",
            mobile:
              "iPhone 13 emulation, 390px, 150ms latency, 1.6Mbps down, 750kbps up, CPU 4x",
          },
          results,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        profile,
        config,
        seconds: result.elapsedMs / 1000,
        rps: result.throughput,
        rdap: result.rdap,
        dns: result.dns,
        counts: result.counts,
        outcomes: result.outcomes,
        dnsOutcomes: result.dnsOutcomes,
        protocols,
        wirePeaks: peaks,
      }),
    );
    if (
      Object.keys(result.outcomes).some((x) => /429|403|503/.test(x)) ||
      Object.keys(result.dnsOutcomes).some((x) => /429|403|503/.test(x))
    ) {
      console.log("Provider pressure; stopping benchmark.");
      await browser.close();
      process.exit(1);
    }
  }
  await context.close();
}
await browser.close();
