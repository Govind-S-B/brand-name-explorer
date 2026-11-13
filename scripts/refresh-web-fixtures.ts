/**
 * Re-record the browser fixtures that mirror the default sequence after an
 * engine change: web/scripts/workload.json (the first default names) and
 * tests/available-fixture.json (which of them the mocked providers call free;
 * the same positions as before). Usage: npx tsx scripts/refresh-web-fixtures.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { generate } from "../core/generator";
const workload = new URL("../web/scripts/workload.json", import.meta.url),
  available = new URL("../tests/available-fixture.json", import.meta.url);
const before: string[] = JSON.parse(readFileSync(workload, "utf8")),
  positions = (JSON.parse(readFileSync(available, "utf8")) as string[]).map((d) =>
    before.indexOf(d),
  );
if (positions.includes(-1)) throw new Error("fixtures are out of step; restore them first");
const names = generate({}, before.length).map((n) => n.toLowerCase() + ".com");
writeFileSync(workload, "[" + names.map((n) => JSON.stringify(n)).join(", ") + "]");
writeFileSync(available, JSON.stringify(positions.map((i) => names[i]), null, 2) + "\n");
console.log(`workload: ${names.length} names from ${names[0]}; ${positions.length} marked available`);
