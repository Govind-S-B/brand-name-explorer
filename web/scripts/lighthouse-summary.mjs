/** Compact, committable summary of a full Lighthouse JSON report (full reports are gitignored).
 * Usage: node scripts/lighthouse-summary.mjs docs/lighthouse-mobile.report.json docs/lighthouse-mobile-summary.json */
import { readFile, writeFile } from "node:fs/promises";
const [input, output] = process.argv.slice(2);
const r = JSON.parse(await readFile(input, "utf8"));
const metrics = {};
for (const id of ["largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "total-byte-weight", "first-contentful-paint", "speed-index"])
  metrics[id] = { value: r.audits[id].numericValue, unit: r.audits[id].numericUnit };
// The landing feed starts .com lookups, so separate app bytes from lookup API traffic.
const transferByOrigin = {};
for (const req of r.audits["network-requests"].details.items) {
  const origin = new URL(req.url).origin;
  transferByOrigin[origin] = (transferByOrigin[origin] || 0) + (req.transferSize || 0);
}
const { lighthouseVersion, requestedUrl, finalDisplayedUrl, fetchTime, configSettings, environment, runWarnings } = r;
const summary = {
  lighthouseVersion, requestedUrl, finalDisplayedUrl, fetchTime, configSettings, environment, runWarnings,
  scores: Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [k, v.score])),
  metrics,
  transferByOrigin,
};
await writeFile(output, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ scores: summary.scores, lcp: metrics["largest-contentful-paint"].value, transferByOrigin }, null, 1));
