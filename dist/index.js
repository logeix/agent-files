import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { readFile, mkdir, writeFile, readdir } from 'fs/promises';
import { join, dirname, relative, sep } from 'path';
import { parse } from 'node-html-parser';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { createHash } from 'crypto';

// src/index.ts

// src/jsonld.ts
function readJsonLd(root) {
  const nodes = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const node = value;
    if (Array.isArray(node["@graph"])) {
      node["@graph"].forEach(visit);
      return;
    }
    nodes.push(node);
  };
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent));
    } catch {
    }
  }
  return nodes;
}
function typesOf(node) {
  const type = node["@type"];
  if (typeof type === "string") return [type];
  if (Array.isArray(type)) return type.filter((t) => typeof t === "string");
  return [];
}
var BUSINESS_TYPES = /* @__PURE__ */ new Set([
  "LocalBusiness",
  "HomeAndConstructionBusiness",
  "Plumber",
  "HVACBusiness",
  "Electrician",
  "RoofingContractor",
  "GeneralContractor",
  "HousePainter",
  "Locksmith",
  "MovingCompany",
  "ProfessionalService"
]);
function findBusiness(nodes) {
  return nodes.find((n) => typeof n["@id"] === "string" && n["@id"].endsWith("#business")) ?? nodes.find((n) => typesOf(n).some((t) => BUSINESS_TYPES.has(t)));
}
function pageKind(nodes) {
  if (nodes.some((n) => typesOf(n).some((t) => t === "BlogPosting" || t === "Article" || t === "NewsArticle"))) {
    return "post";
  }
  const service = nodes.find((n) => typesOf(n).includes("Service"));
  if (service) {
    const area = service.areaServed;
    const single = area && !Array.isArray(area);
    return single ? "service-area" : "service";
  }
  return "page";
}
function articleDates(nodes) {
  const post = nodes.find((n) => typesOf(n).some((t) => t === "BlogPosting" || t === "Article" || t === "NewsArticle"));
  if (!post) return {};
  const str = (v) => typeof v === "string" && v ? v : void 0;
  return { published: str(post.datePublished), modified: str(post.dateModified) };
}
function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function list(value) {
  if (value === void 0 || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

// src/convert.ts
var DEFAULT_REMOVE = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "video",
  "audio",
  "picture",
  "img",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "dialog",
  "nav",
  "[popover]",
  "[hidden]",
  '[aria-hidden="true"]',
  "[data-agent-skip]"
];
var DEFAULT_CONTENT = ["main", '[role="main"]', "body"];
var nhm = new NodeHtmlMarkdown({
  bulletMarker: "-",
  codeBlockStyle: "fenced",
  maxConsecutiveNewlines: 2,
  useInlineLinks: true,
  keepDataImages: false
});
function readMeta(root) {
  const attr = (selector, name) => root.querySelector(selector)?.getAttribute(name)?.trim() || void 0;
  const title = clean(root.querySelector("title")?.textContent ?? "");
  const h1 = clean(root.querySelector("h1")?.textContent ?? "");
  const jsonld = readJsonLd(root);
  return {
    title,
    heading: h1 || title,
    description: attr('meta[name="description"]', "content"),
    canonical: attr('link[rel="canonical"]', "href"),
    robots: attr('meta[name="robots"]', "content")?.toLowerCase(),
    lang: attr("html", "lang"),
    kind: pageKind(jsonld),
    ...articleDates(jsonld),
    jsonld
  };
}
function parseHtml(html) {
  return parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true, pre: true } });
}
function htmlToMarkdown(html, options) {
  const root = parseHtml(html);
  const meta = readMeta(root);
  const contentSelectors = options.content?.length ? options.content : DEFAULT_CONTENT;
  let content = null;
  for (const selector of contentSelectors) {
    content = root.querySelector(selector);
    if (content) break;
  }
  if (!content) content = root;
  const body = parseHtml(content.outerHTML);
  for (const selector of [...DEFAULT_REMOVE, ...options.remove ?? []]) {
    for (const el of body.querySelectorAll(selector)) el.remove();
  }
  for (const a of body.querySelectorAll("a")) {
    const href = a.getAttribute("href")?.trim();
    const label = clean(a.textContent);
    if (!label) {
      a.remove();
      continue;
    }
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
      a.replaceWith(a.innerHTML);
      continue;
    }
    try {
      a.setAttribute("href", new URL(href, options.url).href);
    } catch {
      a.replaceWith(a.innerHTML);
    }
  }
  let markdown = nhm.translate(body.innerHTML);
  markdown = tidy(markdown);
  if (!/^#\s/m.test(markdown)) markdown = `# ${meta.heading}

${markdown}`;
  return { meta, markdown: `${frontmatter(meta)}
${markdown}
` };
}
function frontmatter(meta) {
  const lines = ["---", `title: ${JSON.stringify(meta.title)}`];
  if (meta.description) lines.push(`description: ${JSON.stringify(meta.description)}`);
  if (meta.canonical) lines.push(`url: ${JSON.stringify(meta.canonical)}`);
  if (meta.published) lines.push(`published: ${JSON.stringify(meta.published)}`);
  if (meta.modified) lines.push(`updated: ${JSON.stringify(meta.modified)}`);
  lines.push("---", "");
  return lines.join("\n");
}
function tidy(markdown) {
  return markdown.replace(/ /g, " ").split("\n").map(
    (line) => line.replace(/[ \t]+$/g, "").replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ").replace(/^(#{1,6})[ \t]{2,}/, "$1 ").replace(/(^|[^\\])\[[ \t]+/g, "$1[").replace(/[ \t]+\]\(/g, "](")
  ).filter((line) => !/^\s*[-*]\s*$/.test(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
function clean(value) {
  return value.replace(/\s+/g, " ").trim();
}

// src/llms.ts
var DEFAULT_SECTIONS = [
  { title: "Main pages", kind: "page" },
  { title: "Services", kind: "service" },
  { title: "Services by area", kind: "service-area" },
  { title: "Blog", kind: "post" }
];
function buildLlmsTxt(input) {
  const { origin, business, options = {} } = input;
  const name = options.title ?? text(business?.name) ?? input.homeTitle;
  const summary = options.summary ?? input.homeDescription;
  const out = [`# ${name}`, ""];
  if (summary) out.push(`> ${oneLine(summary)}`, "");
  const facts = businessFacts(business);
  if (facts.length) out.push(...facts.map((f) => `- ${f}`), "");
  for (const note of options.notes ?? []) out.push(note, "");
  out.push(
    `Every page on ${new URL(origin).host} is also available as markdown: add \`.md\` to the page path (for example ${input.pages.find((p) => p.path !== "/")?.mdUrl ?? `${origin}/index.md`}). The homepage is ${origin}/index.md. The links below point to the markdown copies.`,
    ""
  );
  const remaining = [...input.pages];
  const take = (predicate) => {
    const picked = [];
    for (let i = 0; i < remaining.length; ) {
      if (predicate(remaining[i])) picked.push(...remaining.splice(i, 1));
      else i++;
    }
    return picked;
  };
  const sections = [];
  for (const custom of options.sections ?? []) {
    sections.push({ title: custom.title, pages: take((p) => matches(custom.match, p.path)) });
  }
  for (const def of DEFAULT_SECTIONS) {
    const existing = sections.find((s) => s.title === def.title);
    const pages = take((p) => p.kind === def.kind);
    if (existing) existing.pages.push(...pages);
    else sections.push({ title: def.title, pages });
  }
  for (const section of sections) {
    if (!section.pages.length) continue;
    out.push(`## ${section.title}`, "");
    for (const page of sortPages(section.pages)) {
      const desc = page.description ? `: ${oneLine(page.description)}` : "";
      out.push(`- [${escapeLabel(page.label)}](${page.mdUrl})${desc}`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}
function matches(match, path) {
  return typeof match === "string" ? path.startsWith(match) : match.test(path);
}
function sortPages(pages) {
  return [...pages].sort((a, b) => {
    if (a.path === "/") return -1;
    if (b.path === "/") return 1;
    return a.path.localeCompare(b.path);
  });
}
var DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function businessFacts(business) {
  if (!business) return [];
  const facts = [];
  const phone = text(business.telephone);
  if (phone) facts.push(`Phone: ${phone}`);
  const email = text(business.email);
  if (email) facts.push(`Email: ${email}`);
  const address = business.address;
  if (address && typeof address === "object") {
    const street = text(address.streetAddress);
    const locality = [text(address.addressLocality), [text(address.addressRegion), text(address.postalCode)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    if (street) facts.push(`Address: ${[street, locality].filter(Boolean).join(", ")}`);
    else if (locality) facts.push(`Based in: ${locality}`);
  }
  const hours = list(business.openingHoursSpecification).map((spec) => formatHours(spec)).filter((h) => Boolean(h));
  if (hours.length) facts.push(`Hours: ${hours.join("; ")}`);
  const areas = list(business.areaServed).map((a) => typeof a === "string" ? a : text(a?.name)).filter((a) => Boolean(a));
  if (areas.length) facts.push(`Areas served: ${areas.join("; ")}`);
  const founded = text(business.foundingDate);
  if (founded) facts.push(`In business since: ${founded.slice(0, 4)}`);
  const map = text(business.hasMap);
  if (map) facts.push(`Google Maps: ${map}`);
  const profiles = list(business.sameAs).filter((s) => typeof s === "string");
  if (profiles.length) facts.push(`Profiles: ${profiles.join(", ")}`);
  return facts;
}
function formatHours(spec) {
  if (!spec || typeof spec !== "object") return void 0;
  const days = list(spec.dayOfWeek).map((d) => typeof d === "string" ? d.replace(/^https?:\/\/schema\.org\//, "") : "").filter((d) => DAY_ORDER.includes(d)).sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  const opens = text(spec.opens);
  const closes = text(spec.closes);
  if (!days.length || !opens || !closes) return void 0;
  const allDay = opens.startsWith("00:00") && (closes.startsWith("23:59") || closes.startsWith("00:00") || closes.startsWith("24:00"));
  return `${dayRanges(days)} ${allDay ? "24 hours" : `${opens.slice(0, 5)}\u2013${closes.slice(0, 5)}`}`;
}
function dayRanges(days) {
  if (days.length === 7) return "Every day";
  const idx = days.map((d) => DAY_ORDER.indexOf(d));
  const parts = [];
  let start = 0;
  for (let i = 1; i <= idx.length; i++) {
    if (i === idx.length || idx[i] !== idx[i - 1] + 1) {
      const from = days[start];
      const to = days[i - 1];
      parts.push(i - 1 - start >= 2 ? `${from} to ${to}` : days.slice(start, i).join(", "));
      start = i;
    }
  }
  return parts.join(", ");
}
function oneLine(value) {
  return value.replace(/\s+/g, " ").trim();
}
function escapeLabel(value) {
  return value.replace(/([\[\]])/g, "\\$1");
}
var MANIFEST_PATH = "/agent-files.json";
var INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
function hashContent(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
function diffManifests(previous, next) {
  const changed = Object.keys(next.pages).filter((path) => previous.pages[path] !== next.pages[path]);
  const removed = Object.keys(previous.pages).filter((path) => !(path in next.pages));
  return { changed, removed };
}
function isValidKey(key) {
  return /^[a-zA-Z0-9-]{8,128}$/.test(key);
}
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

// src/generate.ts
var consoleLogger = { info: (m) => console.log(m), warn: (m) => console.warn(m) };
async function generate({
  distDir,
  site,
  options = {},
  logger = consoleLogger,
  env = process.env,
  fetchImpl = fetch
}) {
  const origin = new URL(site).origin;
  const content = typeof options.content === "string" ? [options.content] : options.content;
  const exclude = options.exclude ?? [];
  const sitemapPaths = await readSitemapPaths(distDir, origin);
  if (!sitemapPaths) logger.warn("No sitemap-index.xml in the build output. Put agentFiles() after sitemap() in integrations. Using every indexable page instead.");
  const result = { pages: [], skipped: [], indexNow: "off" };
  const manifest = { version: 1, pages: {} };
  let home;
  for (const file of await listHtmlFiles(distDir)) {
    const path = pagePathFor(distDir, file);
    if (path === "/404/" || path === "/404" || path === "/500/" || path === "/500") continue;
    const skip = (reason) => result.skipped.push({ path, reason });
    if (exclude.some((rule) => typeof rule === "string" ? path.startsWith(rule) : rule.test(path))) {
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
    const pages = result.pages.map(({ path, mdPath, meta }) => ({
      path,
      url: `${origin}${path}`,
      mdUrl: `${origin}${mdPath}`,
      label: meta.heading,
      description: meta.description,
      kind: path === "/" ? "page" : meta.kind
    }));
    const llms = buildLlmsTxt({
      origin,
      homeTitle: home?.title ?? new URL(origin).host,
      homeDescription: home?.description,
      business: home ? findBusiness(home.jsonld) : void 0,
      pages,
      options: options.llms ?? {}
    });
    await writeFile(join(distDir, "llms.txt"), llms, "utf8");
  }
  await appendHeaders(distDir);
  await writeFile(join(distDir, MANIFEST_PATH.slice(1)), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  if (options.indexNow) {
    result.indexNow = await runIndexNow({ origin, distDir, manifest, indexNow: options.indexNow, env, fetchImpl });
  }
  logger.info(
    `${result.pages.length} markdown pages${options.llms === false ? "" : " and llms.txt"} written. IndexNow: ${result.indexNow}.`
  );
  return result;
}
async function runIndexNow({
  origin,
  distDir,
  manifest,
  indexNow,
  env,
  fetchImpl
}) {
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
var HEADERS_BLOCK = `
/*.md
  Content-Type: text/markdown; charset=utf-8
  X-Robots-Tag: noindex
/llms.txt
  Content-Type: text/plain; charset=utf-8
`;
async function appendHeaders(distDir) {
  const file = join(distDir, "_headers");
  const existing = existsSync(file) ? await readFile(file, "utf8") : "";
  if (existing.includes("/*.md")) return;
  await writeFile(file, existing.trimEnd() + (existing ? "\n" : "") + HEADERS_BLOCK.trimStart(), "utf8");
}
function mdPathFor(pagePath) {
  if (pagePath === "/") return "/index.md";
  return pagePath.replace(/\/$/, "").replace(/\.html$/, "") + ".md";
}
function pagePathFor(distDir, file) {
  const rel = relative(distDir, file).split(sep).join("/");
  if (rel === "index.html") return "/";
  if (rel.endsWith("/index.html")) return `/${rel.slice(0, -"index.html".length)}`;
  return `/${rel.replace(/\.html$/, "")}`;
}
function normalise(url, origin) {
  try {
    const u = new URL(url, origin);
    const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    return `${u.host.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
}
async function listHtmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_astro" || entry.name.startsWith(".")) continue;
      out.push(...await listHtmlFiles(full));
    } else if (entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out.sort();
}
async function readSitemapPaths(distDir, origin) {
  const index = join(distDir, "sitemap-index.xml");
  if (!existsSync(index)) return void 0;
  const paths = /* @__PURE__ */ new Set();
  const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  for (const sitemapUrl of locs(await readFile(index, "utf8"))) {
    const file = join(distDir, ...new URL(sitemapUrl, origin).pathname.split("/").filter(Boolean));
    if (!existsSync(file)) continue;
    for (const loc of locs(await readFile(file, "utf8"))) {
      paths.add(new URL(loc, origin).pathname);
    }
  }
  return paths;
}

// src/index.ts
function agentFiles(options = {}) {
  let site;
  return {
    name: "@logeix/agent-files",
    hooks: {
      "astro:config:done": ({ config }) => {
        site = config.site;
      },
      "astro:build:done": async ({ dir, logger }) => {
        if (!site) {
          logger.warn("No `site` set in astro.config, so no agent files were written.");
          return;
        }
        await generate({ distDir: fileURLToPath(dir), site, options, logger });
      }
    }
  };
}

export { agentFiles as default, generate };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map