// CI guard: every file in src/ that reads a server secret must `import "server-only"`, so a client
// component that imports it (directly or through another module) fails the build instead of shipping
// the secret's name and code path to the browser.
//
//   node scripts/check-server-only.mjs
//
// Scripts in scripts/ run under plain Node and are never bundled, so they are not checked.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "GROQ_API_KEY",
  "RESEND_API_KEY",
  "SMTP_PASS",
  "CRON_SECRET",
  "TWILIO_AUTH_TOKEN",
];
const root = join(fileURLToPath(import.meta.url), "..", "..");
const src = join(root, "src");

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) yield path;
  }
}

const guard = /^\s*import\s+["']server-only["'];?\s*$/m;
const failures = [];
let checked = 0;
for (const file of files(src)) {
  const text = readFileSync(file, "utf8");
  // "Reads" = the file touches process.env and names the secret (process.env.X, destructuring, etc.).
  // Files that only mention a name in a comment or message string are not reading it.
  if (!text.includes("process.env")) continue;
  const used = SECRETS.filter((name) => text.includes(name));
  if (!used.length) continue;
  checked++;
  if (!guard.test(text))
    failures.push(
      `${relative(root, file)}: reads ${used.join(", ")} without import "server-only"`,
    );
  if (/^\s*["']use client["']/m.test(text))
    failures.push(
      `${relative(root, file)}: a client component must not read ${used.join(", ")}`,
    );
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `server-only guard: ${checked} files read server secrets, all guarded.`,
);
