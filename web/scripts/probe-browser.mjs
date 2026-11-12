import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const page = await browser.newPage();
page.on("console", (m) => console.log(m.type(), m.text()));
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
cdp.on("Network.responseReceived", ({ response: r }) => {
  if (!r.url.includes("127.0.0.1"))
    console.log(
      JSON.stringify({
        url: r.url,
        status: r.status,
        protocol: r.protocol,
        headers: r.headers,
      }),
    );
});
await page.goto("http://127.0.0.1:5173");
console.log(
  await page.evaluate(
    async () =>
      await Promise.all(
        [
          "https://rdap.verisign.com/com/v1/domain/example.com",
          "https://cloudflare-dns.com/dns-query?name=example.com&type=NS",
          "https://dns.google/resolve?name=example.com&type=NS",
        ].map(async (url) => {
          const start = performance.now();
          try {
            const r = await fetch(url, {
              headers: {
                Accept: url.includes("rdap")
                  ? "application/rdap+json"
                  : "application/dns-json",
              },
              signal: AbortSignal.timeout(12000),
            });
            return {
              url,
              code: r.status,
              body: (await r.text()).slice(0, 200),
              ms: performance.now() - start,
            };
          } catch (e) {
            return { url, error: String(e), ms: performance.now() - start };
          }
        }),
      ),
  ),
);
await browser.close();
