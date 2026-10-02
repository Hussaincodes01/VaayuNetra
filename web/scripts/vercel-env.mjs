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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// The list of names is web/.env.example, wherever the script is run from (web/ or the repo root).
const example = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".env.example",
);
const names = Object.keys(parse(readFileSync(example, "utf8")));
const values = parse(readFileSync(file, "utf8"));
const vercel = process.platform === "win32" ? "vercel.cmd" : "vercel";
// Settings that are not secrets; NEXT_PUBLIC_* values are public as well. Everything else is a secret.
const PLAIN = new Set([
  "ALERT_FROM_EMAIL",
  "GROQ_MODEL",
  "ALERT_LOOKBACK_DAYS",
  "ALERTS_TWILIO_ENABLED",
  "TWILIO_FROM",
]);

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
    // Non-interactive add: the type must be given; --force replaces an existing value. The value goes
    // in on stdin, never on the command line.
    const type =
      PLAIN.has(name) || name.startsWith("NEXT_PUBLIC_") ? "config" : "secret";
    const add = spawnSync(
      vercel,
      ["env", "add", name, target, "--type", type, "--force", "--yes"],
      {
        input: value,
        stdio: ["pipe", "inherit", "inherit"],
        shell: process.platform === "win32",
      },
    );
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
