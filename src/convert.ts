import { parse, type HTMLElement } from "node-html-parser";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { articleDates, pageKind, readJsonLd, type JsonLdNode, type PageKind } from "./jsonld.js";

/** Removed from the page content before conversion: chrome, media, controls and anything hidden. */
export const DEFAULT_REMOVE = [
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
  "[data-agent-skip]",
];

export const DEFAULT_CONTENT = ["main", '[role="main"]', "body"];

export interface PageMeta {
  title: string;
  heading: string;
  description?: string;
  canonical?: string;
  robots?: string;
  lang?: string;
  kind: PageKind;
  published?: string;
  modified?: string;
  jsonld: JsonLdNode[];
}

export interface ConvertOptions {
  /** Absolute URL of the page, used to resolve relative links. */
  url: string;
  content?: string[];
  remove?: string[];
}

const nhm = new NodeHtmlMarkdown({
  bulletMarker: "-",
  codeBlockStyle: "fenced",
  maxConsecutiveNewlines: 2,
  useInlineLinks: true,
  keepDataImages: false,
});

export function readMeta(root: HTMLElement): PageMeta {
  const attr = (selector: string, name: string) => root.querySelector(selector)?.getAttribute(name)?.trim() || undefined;
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
    jsonld,
  };
}

export function parseHtml(html: string): HTMLElement {
  return parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true, pre: true } });
}

/** Page HTML to a markdown document with YAML frontmatter. */
export function htmlToMarkdown(html: string, options: ConvertOptions): { meta: PageMeta; markdown: string } {
  const root = parseHtml(html);
  const meta = readMeta(root);
  const contentSelectors = options.content?.length ? options.content : DEFAULT_CONTENT;
  let content: HTMLElement | null = null;
  for (const selector of contentSelectors) {
    content = root.querySelector(selector);
    if (content) break;
  }
  if (!content) content = root;

  // Work on a copy so the caller's tree is untouched.
  const body = parseHtml(content.outerHTML);
  for (const selector of [...DEFAULT_REMOVE, ...(options.remove ?? [])]) {
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
  if (!/^#\s/m.test(markdown)) markdown = `# ${meta.heading}\n\n${markdown}`;

  return { meta, markdown: `${frontmatter(meta)}\n${markdown}\n` };
}

function frontmatter(meta: PageMeta): string {
  const lines = ["---", `title: ${JSON.stringify(meta.title)}`];
  if (meta.description) lines.push(`description: ${JSON.stringify(meta.description)}`);
  if (meta.canonical) lines.push(`url: ${JSON.stringify(meta.canonical)}`);
  if (meta.published) lines.push(`published: ${JSON.stringify(meta.published)}`);
  if (meta.modified) lines.push(`updated: ${JSON.stringify(meta.modified)}`);
  lines.push("---", "");
  return lines.join("\n");
}

/** Collapses whitespace that converters leave behind from layout markup. */
function tidy(markdown: string): string {
  return markdown
    .replace(/ /g, " ")
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+$/g, "")
        .replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ")
        .replace(/^(#{1,6})[ \t]{2,}/, "$1 ")
        .replace(/(^|[^\\])\[[ \t]+/g, "$1[")
        .replace(/[ \t]+\]\(/g, "]("),
    )
    .filter((line) => !/^\s*[-*]\s*$/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
