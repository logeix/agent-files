#!/usr/bin/env node
// Sends every page in a live site's /agent-files.json to IndexNow. Run once after the first deploy.
// Usage: agent-files-indexnow <site-url> <key> [--dry-run]
import { describeStatus, fetchManifest, submitIndexNow } from "./indexnow.js";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [site, key] = args.filter((a) => !a.startsWith("--"));
  if (!site || !key) {
    console.error("Usage: agent-files-indexnow <site-url> <key> [--dry-run]");
    process.exit(2);
  }
  const origin = new URL(site).origin;

  const keyRes = await fetch(`${origin}/${key}.txt`).catch(() => undefined);
  const liveKey = keyRes?.ok ? (await keyRes.text()).trim() : undefined;
  if (liveKey !== key) {
    console.error(`${origin}/${key}.txt doesn't return the key yet. Deploy first.`);
    process.exit(1);
  }

  const manifest = await fetchManifest(origin);
  if (!manifest) {
    console.error(`${origin}/agent-files.json isn't live yet. Deploy first.`);
    process.exit(1);
  }
  const urls = Object.keys(manifest.pages).map((path) => `${origin}${path}`);
  if (dryRun) {
    console.log(`Would send ${urls.length} URLs:\n${urls.join("\n")}`);
    return;
  }
  const statuses = await submitIndexNow({ origin, key, urls });
  console.log(`Sent ${urls.length} URLs: ${statuses.map(describeStatus).join(", ")}`);
  if (!statuses.every((s) => s === 200 || s === 202)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
