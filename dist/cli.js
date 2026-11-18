#!/usr/bin/env node
import 'crypto';

var MANIFEST_PATH = "/agent-files.json";
var INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
async function fetchManifest(origin, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${origin}${MANIFEST_PATH}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) return void 0;
    const body = await res.json();
    if (body?.version !== 1 || typeof body.pages !== "object") return void 0;
    return body;
  } catch {
    return void 0;
  }
}
async function submitIndexNow({ origin, key, urls, endpoint = INDEXNOW_ENDPOINT, fetchImpl = fetch }) {
  const host = new URL(origin).host;
  const statuses = [];
  for (let i = 0; i < urls.length; i += 1e4) {
    const urlList = urls.slice(i, i + 1e4);
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList }),
        signal: AbortSignal.timeout(2e4)
      });
      statuses.push(res.status);
    } catch {
      statuses.push(0);
    }
  }
  return statuses;
}
function describeStatus(status) {
  switch (status) {
    case 200:
      return "200 accepted";
    case 202:
      return "202 accepted, key check pending";
    case 400:
      return "400 bad request";
    case 403:
      return "403 key not valid (is the key file live?)";
    case 422:
      return "422 URLs don't belong to the host, or the key doesn't match";
    case 429:
      return "429 too many requests";
    case 0:
      return "network error";
    default:
      return String(status);
  }
}

// src/cli.ts
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [site, key] = args.filter((a) => !a.startsWith("--"));
  if (!site || !key) {
    console.error("Usage: agent-files-indexnow <site-url> <key> [--dry-run]");
    process.exit(2);
  }
  const origin = new URL(site).origin;
  const keyRes = await fetch(`${origin}/${key}.txt`).catch(() => void 0);
  const liveKey = keyRes?.ok ? (await keyRes.text()).trim() : void 0;
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
    console.log(`Would send ${urls.length} URLs:
${urls.join("\n")}`);
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
//# sourceMappingURL=cli.js.map
//# sourceMappingURL=cli.js.map