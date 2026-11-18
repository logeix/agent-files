import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "../src/generate.ts";

const origin = "https://www.example.com";
const quiet = { info() {}, warn() {} };

const html = (title: string, body: string, head = "") =>
  `<!doctype html><html lang="en"><head><title>${title}</title>${head}</head><body><main><h1>${title}</h1>${body}</main></body></html>`;

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "agent-files-"));
  const write = async (path: string, content: string) => {
    await mkdir(join(dir, ...path.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(dir, ...path.split("/")), content);
  };
  await write(
    "index.html",
    html(
      "Acme Plumbing",
      "<p>Home</p>",
      `<meta name="description" content="Plumber in Springfield."><script type="application/ld+json">{"@type":"Plumber","@id":"${origin}/#business","name":"Acme Plumbing","telephone":"(555) 010-0000"}</script>`,
    ),
  );
  await write("drain-cleaning/index.html", html("Drain cleaning", "<p>Drains</p>"));
  await write("thank-you/index.html", html("Thanks", "<p>Thanks</p>", '<meta name="robots" content="noindex">'));
  await write("blog/page/2/index.html", html("Blog page 2", "<p>Old</p>", `<link rel="canonical" href="${origin}/blog/">`));
  await write("404.html", html("Not found", ""));
  await write("_headers", "/video/*\n  Cache-Control: public, max-age=604800\n");
  await write(
    "sitemap-index.xml",
    `<?xml version="1.0"?><sitemapindex><sitemap><loc>${origin}/sitemap-0.xml</loc></sitemap></sitemapindex>`,
  );
  await write(
    "sitemap-0.xml",
    `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/drain-cleaning/</loc></url><url><loc>${origin}/blog/page/2/</loc></url></urlset>`,
  );
  return dir;
}

test("writes markdown pages, llms.txt, headers and the page list", async () => {
  const dir = await fixture();
  const result = await generate({ distDir: dir, site: origin, logger: quiet, env: {} });
  assert.deepEqual(result.pages.map((p) => p.path).sort(), ["/", "/drain-cleaning/"]);
  assert.ok(existsSync(join(dir, "index.md")));
  assert.ok(existsSync(join(dir, "drain-cleaning.md")));
  assert.ok(!existsSync(join(dir, "thank-you.md")));
  assert.ok(!existsSync(join(dir, "404.md")));

  const llms = await readFile(join(dir, "llms.txt"), "utf8");
  assert.match(llms, /^# Acme Plumbing\n\n> Plumber in Springfield\.\n\n- Phone: \(555\) 010-0000/);
  assert.match(llms, /\[Drain cleaning\]\(https:\/\/www.example.com\/drain-cleaning.md\)/);

  const headers = await readFile(join(dir, "_headers"), "utf8");
  assert.match(headers, /^\/video\/\*\n {2}Cache-Control/);
  assert.match(headers, /\/\*\.md\n {2}Content-Type: text\/markdown; charset=utf-8\n {2}X-Robots-Tag: noindex/);

  const page = await readFile(join(dir, "drain-cleaning", "index.html"), "utf8");
  assert.match(page, /<link rel="alternate" type="text\/markdown" href="https:\/\/www.example.com\/drain-cleaning.md"><\/head>/);

  const manifest = JSON.parse(await readFile(join(dir, "agent-files.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.pages).sort(), ["/", "/drain-cleaning/"]);
  assert.equal(result.indexNow, "off");
});

test("IndexNow sends only changed and removed pages on a production build", async () => {
  const dir = await fixture();
  const key = "0123456789abcdef0123456789abcdef";
  const calls: Array<{ url: string; body?: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body as string | undefined });
    if (url === `${origin}/agent-files.json`) {
      // The live site has "/" unchanged (hash filled in below), an old drain page, and a removed page.
      return new Response(JSON.stringify(live), { status: 200 });
    }
    return new Response("", { status: 202 });
  }) as typeof fetch;

  // A throwaway build gives the current hash of "/", so the live list can hold it unchanged.
  const live = { version: 1, pages: { "/": "", "/drain-cleaning/": "old", "/gone/": "old" } };
  const probe = await fixture();
  await generate({ distDir: probe, site: origin, logger: quiet, env: {} });
  live.pages["/"] = JSON.parse(await readFile(join(probe, "agent-files.json"), "utf8")).pages["/"];

  const result = await generate({
    distDir: dir,
    site: origin,
    logger: quiet,
    env: { CF_PAGES: "1", CF_PAGES_BRANCH: "master" },
    fetchImpl,
    options: { indexNow: { key } },
  });
  assert.equal(await readFile(join(dir, `${key}.txt`), "utf8"), key);
  const post = calls.find((c) => c.url === "https://api.indexnow.org/indexnow");
  assert.ok(post, "should POST to IndexNow");
  const body = JSON.parse(post!.body!);
  assert.equal(body.host, "www.example.com");
  assert.equal(body.keyLocation, `${origin}/${key}.txt`);
  assert.deepEqual(body.urlList, [`${origin}/drain-cleaning/`, `${origin}/gone/`]);
  assert.match(result.indexNow, /sent 1 changed and 1 removed URLs \(202 accepted, key check pending\)/);
});

test("IndexNow stays quiet off production and on the first deploy", async () => {
  const key = "0123456789abcdef0123456789abcdef";
  let posted = false;
  const fetchImpl = (async (url: string) => {
    if (url.includes("indexnow")) posted = true;
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const preview = await generate({
    distDir: await fixture(),
    site: origin,
    logger: quiet,
    env: { CF_PAGES: "1", CF_PAGES_BRANCH: "some-branch" },
    fetchImpl,
    options: { indexNow: { key } },
  });
  assert.match(preview.indexNow, /not a production Pages build/);

  const firstDeploy = await generate({
    distDir: await fixture(),
    site: origin,
    logger: quiet,
    env: { CF_PAGES: "1", CF_PAGES_BRANCH: "main" },
    fetchImpl,
    options: { indexNow: { key } },
  });
  assert.match(firstDeploy.indexNow, /npx agent-files-indexnow https:\/\/www.example.com 0123456789abcdef0123456789abcdef/);
  assert.equal(posted, false);
});
