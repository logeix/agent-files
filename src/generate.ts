import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { htmlToMarkdown, type PageMeta } from "./convert.js";
import { findBusiness } from "./jsonld.js";
import { buildLlmsTxt, type LlmsOptions, type LlmsPage } from "./llms.js";
import {
  describeStatus,
  diffManifests,
  fetchManifest,
  hashContent,
  isValidKey,
  MANIFEST_PATH,
  submitIndexNow,
  type PageManifest,
} from "./indexnow.js";

export interface AgentFilesOptions {
  /** CSS selectors tried in order for the page's main content. Default: main, [role=main], body. */
  content?: string | string[];
  /** Extra CSS selectors removed from the content before conversion. */
  remove?: string[];
  /**
   * Paths to leave out, as path prefixes or RegExps. Pages with a noindex robots tag, a canonical
   * pointing elsewhere, or no sitemap entry are left out already.
   */
  exclude?: Array<string | RegExp>;
  /** llms.txt settings, or false to skip the file. */
  llms?: LlmsOptions | false;
  /** Add <link rel="alternate" type="text/markdown"> to each page's head. Default true. */
  alternateLink?: boolean;
  /** IndexNow pings for changed pages on production Cloudflare Pages builds. */
  indexNow?: IndexNowOptions | false;
}

export interface IndexNowOptions {
  /** 8 to 128 characters: letters, digits and dashes. Published at /<key>.txt. */
  key: string;
  /** Cloudflare Pages branches that count as production. Default: master, main. */
  branches?: string[];
  endpoint?: string;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface GenerateInput {
  distDir: string;
  site: string;
  options?: AgentFilesOptions;
  logger?: Logger;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export interface GenerateResult {
  pages: Array<{ path: string; mdPath: string; meta: PageMeta }>;
  skipped: Array<{ path: string; reason: string }>;
  indexNow: string;
}

const consoleLogger: Logger = { info: (m) => console.log(m), warn: (m) => console.warn(m) };

export async function generate({
  distDir,
  site,
  options = {},
  logger = consoleLogger,
  env = process.env,
  fetchImpl = fetch,
}: GenerateInput): Promise<GenerateResult> {
  const origin = new URL(site).origin;
  const content = typeof options.content === "string" ? [options.content] : options.content;
  const exclude = options.exclude ?? [];
  const sitemapPaths = await readSitemapPaths(distDir, origin);
  if (!sitemapPaths) logger.warn("No sitemap-index.xml in the build output. Put agentFiles() after sitemap() in integrations. Using every indexable page instead.");

  const result: GenerateResult = { pages: [], skipped: [], indexNow: "off" };
  const manifest: PageManifest = { version: 1, pages: {} };
  let home: PageMeta | undefined;

  for (const file of await listHtmlFiles(distDir)) {
    const path = pagePathFor(distDir, file);
    if (path === "/404/" || path === "/404" || path === "/500/" || path === "/500") continue;

    const skip = (reason: string) => result.skipped.push({ path, reason });
    if (exclude.some((rule) => (typeof rule === "string" ? path.startsWith(rule) : rule.test(path)))) {
      skip("excluded");
      continue;
    }
    if (sitemapPaths && !sitemapPaths.has(path)) {
      skip("not in sitemap");
      continue;
    }

    const html = await readFile(file, "utf8");
    const url = `${origin}${path}`;
    const { meta, markdown } = htmlToMarkdown(html, { url, content, remove: options.remove });
    if (meta.robots?.includes("noindex")) {
      skip("noindex");
      continue;
    }
    if (meta.canonical && normalise(meta.canonical, origin) !== normalise(url, origin)) {
      skip(`canonical is ${meta.canonical}`);
      continue;
    }

    const mdPath = mdPathFor(path);
    const mdFile = join(distDir, ...mdPath.split("/").filter(Boolean));
    if (existsSync(mdFile)) {
      skip(`${mdPath} already exists`);
      continue;
    }
    await mkdir(dirname(mdFile), { recursive: true });
    await writeFile(mdFile, markdown, "utf8");

    if (options.alternateLink !== false && html.includes("</head>") && !html.includes('type="text/markdown"')) {
      const link = `<link rel="alternate" type="text/markdown" href="${origin}${mdPath}">`;
      await writeFile(file, html.replace("</head>", `${link}</head>`), "utf8");
    }

    manifest.pages[path] = hashContent(markdown);
    result.pages.push({ path, mdPath, meta });
    if (path === "/") home = meta;
  }

  if (options.llms !== false) {
    const pages: LlmsPage[] = result.pages.map(({ path, mdPath, meta }) => ({
      path,
      url: `${origin}${path}`,
      mdUrl: `${origin}${mdPath}`,
      label: meta.heading,
      description: meta.description,
      kind: path === "/" ? "page" : meta.kind,
    }));
    const llms = buildLlmsTxt({
      origin,
      homeTitle: home?.title ?? new URL(origin).host,
      homeDescription: home?.description,
      business: home ? findBusiness(home.jsonld) : undefined,
      pages,
      options: options.llms ?? {},
    });
    await writeFile(join(distDir, "llms.txt"), llms, "utf8");
  }

  await appendHeaders(distDir);
  await writeFile(join(distDir, MANIFEST_PATH.slice(1)), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  if (options.indexNow) {
    result.indexNow = await runIndexNow({ origin, distDir, manifest, indexNow: options.indexNow, env, fetchImpl });
  }

  logger.info(
    `${result.pages.length} markdown pages${options.llms === false ? "" : " and llms.txt"} written. IndexNow: ${result.indexNow}.`,
  );
  return result;
}

async function runIndexNow({
  origin,
  distDir,
  manifest,
  indexNow,
  env,
  fetchImpl,
}: {
  origin: string;
  distDir: string;
  manifest: PageManifest;
  indexNow: IndexNowOptions;
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
}): Promise<string> {
  if (!isValidKey(indexNow.key)) throw new Error("indexNow.key must be 8 to 128 letters, digits or dashes.");
  await writeFile(join(distDir, `${indexNow.key}.txt`), indexNow.key, "utf8");

  const mode = (env.AGENT_FILES_INDEXNOW ?? "").toLowerCase();
  if (mode === "off") return "off (AGENT_FILES_INDEXNOW=off)";
  const branches = indexNow.branches ?? ["master", "main"];
  const production = env.CF_PAGES === "1" && branches.includes(env.CF_PAGES_BRANCH ?? "");
  if (!production && mode !== "dry") return "key file written, nothing sent (not a production Pages build)";

  const previous = await fetchManifest(origin, fetchImpl);
  if (!previous) {
    return `key file written. No page list on the live site yet, so nothing sent. Once this deploy is live, run: npx agent-files-indexnow ${origin} ${indexNow.key}`;
  }
  const { changed, removed } = diffManifests(previous, manifest);
  const urls = [...changed, ...removed].map((path) => `${origin}${path}`);
  if (!urls.length) return "no pages changed";
  if (mode === "dry") return `dry run, would send ${urls.length} URLs: ${urls.join(", ")}`;

  const statuses = await submitIndexNow({ origin, key: indexNow.key, urls, endpoint: indexNow.endpoint, fetchImpl });
  return `sent ${changed.length} changed and ${removed.length} removed URLs (${statuses.map(describeStatus).join(", ")})`;
}

const HEADERS_BLOCK = `
/*.md
  Content-Type: text/markdown; charset=utf-8
  X-Robots-Tag: noindex
/llms.txt
  Content-Type: text/plain; charset=utf-8
`;

async function appendHeaders(distDir: string) {
  const file = join(distDir, "_headers");
  const existing = existsSync(file) ? await readFile(file, "utf8") : "";
  if (existing.includes("/*.md")) return;
  await writeFile(file, existing.trimEnd() + (existing ? "\n" : "") + HEADERS_BLOCK.trimStart(), "utf8");
}

export function mdPathFor(pagePath: string): string {
  if (pagePath === "/") return "/index.md";
  return pagePath.replace(/\/$/, "").replace(/\.html$/, "") + ".md";
}

function pagePathFor(distDir: string, file: string): string {
  const rel = relative(distDir, file).split(sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel.replace(/\.html$/, "")}`;
}

function normalise(url: string, origin: string): string {
  try {
    const u = new URL(url, origin);
    const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    return `${u.host.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}

async function listHtmlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_astro" || entry.name.startsWith(".")) continue;
      out.push(...(await listHtmlFiles(full)));
    } else if (entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out.sort();
}

async function readSitemapPaths(distDir: string, origin: string): Promise<Set<string> | undefined> {
  const index = join(distDir, "sitemap-index.xml");
  if (!existsSync(index)) return undefined;
  const paths = new Set<string>();
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  for (const sitemapUrl of locs(await readFile(index, "utf8"))) {
    const file = join(distDir, ...new URL(sitemapUrl, origin).pathname.split("/").filter(Boolean));
    if (!existsSync(file)) continue;
    for (const loc of locs(await readFile(file, "utf8"))) {
      paths.add(new URL(loc, origin).pathname);
    }
  }
  return paths;
}
