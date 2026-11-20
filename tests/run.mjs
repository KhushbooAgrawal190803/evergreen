// Scenario tests against a running dev server with demo data (npm run dev in another terminal).
// They change the demo data; run `npm run reset-demo` afterwards.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const dir = dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort()) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [`${dir}/${f}`], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
