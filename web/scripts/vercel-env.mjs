// Push the variables listed in .env.example to a linked Vercel project, for Production and Preview.
//
//   cd web
//   vercel link                                   # once: pick the team and the vayunetra project
//   node scripts/vercel-env.mjs .env.production   # values file, never committed (.env* is gitignored)
//
// Only names listed in .env.example are sent, and only when they have a value in the file. Existing
// values are replaced. NEXT_PUBLIC_SITE_URL goes to Production only: each preview deployment uses its
// own URL (see src/lib/site-url.ts). Add --dry-run to print what would be set.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry-run");
if (!file) {
  console.error("usage: node scripts/vercel-env.mjs <env-file> [--dry-run]");
  process.exit(2);
}

const parse = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, k, v]) => [
        k,
        v
          .replace(/\s+#.*$/, "")
          .trim()
          .replace(/^"(.*)"$/, "$1"),
      ]),
  );

const names = Object.keys(parse(readFileSync(".env.example", "utf8")));
const values = parse(readFileSync(file, "utf8"));
const vercel = process.platform === "win32" ? "vercel.cmd" : "vercel";

let set = 0;
for (const name of names) {
  const value = values[name];
  if (!value) {
    console.log(`skip ${name} (no value in ${file})`);
    continue;
  }
  for (const target of ["production", "preview"]) {
    if (name === "NEXT_PUBLIC_SITE_URL" && target === "preview") continue;
    if (dry) {
      console.log(`would set ${name} for ${target}`);
      continue;
    }
    // Replace: remove any existing value first (fails harmlessly when there is none).
    spawnSync(vercel, ["env", "rm", name, target, "--yes"], {
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    const add = spawnSync(vercel, ["env", "add", name, target], {
      input: value,
      stdio: ["pipe", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    if (add.status !== 0) {
      console.error(`failed to set ${name} for ${target}`);
      process.exit(1);
    }
    set++;
  }
}
console.log(
  `${dry ? "Dry run" : "Done"}: ${set} values set. Redeploy for them to take effect.`,
);
