# @logeix/agent-files

Astro integration for LOGEIX client sites (Astro + Cloudflare Pages). After each build it writes:

- **A markdown copy of every indexable page** next to it: `/drain-cleaning/` → `/drain-cleaning.md`, the homepage → `/index.md`. Each starts with YAML frontmatter (title, description, canonical URL, blog dates) followed by the page's main content. Nav, forms, images, SVG, buttons and anything `aria-hidden` are dropped.
- **`/llms.txt`**: the business details from the homepage JSON-LD (phone, email, address or base town, hours, areas served, founding year, Maps link, profiles), then every page grouped as Main pages, Services, Services by area and Blog, linking to the markdown copies.
- **`<link rel="alternate" type="text/markdown">`** in each page's `<head>`.
- **`_headers` rules**: `.md` files get `Content-Type: text/markdown; charset=utf-8` and `X-Robots-Tag: noindex` (so they never compete with the HTML in search), and `llms.txt` gets `text/plain; charset=utf-8`. Existing rules are kept.
- **`/agent-files.json`**: a hash of each page's markdown, so the next build can tell which pages changed.
- **IndexNow** (optional): `/<key>.txt`, plus a ping with the changed and removed URLs on production Cloudflare Pages builds. IndexNow feeds Bing (and through it ChatGPT search and Copilot), Yandex, Seznam and Naver. Google doesn't take part.

Every fact in these files comes from the built pages: the JSON-LD, meta tags and page text. Nothing is typed in twice.

Which pages count: the URLs in the sitemap (so the sitemap's own `filter` applies), minus pages with a `noindex` robots tag, pages whose canonical points elsewhere, 404/500, and anything in `exclude`. Without a sitemap, every indexable HTML page counts.

## Install

```bash
npm install @logeix/agent-files
```

```js
// astro.config.mjs
import sitemap from "@astrojs/sitemap";
import agentFiles from "@logeix/agent-files";

export default defineConfig({
  site: "https://www.example.com",
  integrations: [
    sitemap({ filter: (page) => !page.includes("/thank-you/") && !page.includes("/review/") }),
    // After sitemap(): it reads the sitemap the build just wrote.
    agentFiles({
      indexNow: { key: "<32 random hex characters>" },
    }),
  ],
});
```

Make a key with `node -e "console.log(crypto.randomUUID().replaceAll('-', ''))"`. One key per site. It isn't secret: IndexNow checks it by fetching `/<key>.txt` from the site.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `content` | `["main", "[role=main]", "body"]` | CSS selectors tried in order for the page's main content. Set it when the layout has no `<main>`. |
| `remove` | `[]` | Extra selectors to drop from the content, on top of the defaults. Any element with a `data-agent-skip` attribute is dropped too. |
| `exclude` | `[]` | Path prefixes or RegExps to leave out. |
| `llms.title` | business name from JSON-LD, else the homepage title | The `#` heading of llms.txt. |
| `llms.summary` | homepage meta description | The `>` summary line. |
| `llms.notes` | `[]` | Extra paragraphs after the business details. |
| `llms.sections` | none | `[{ title, match }]` checked before the defaults. `match` is a path prefix or a RegExp, e.g. `{ title: "Towns we serve", match: /^\/plumber-in-/ }`. |
| `llms` | | `false` skips llms.txt. |
| `alternateLink` | `true` | `false` leaves the HTML untouched. |
| `indexNow.key` | none | Turns IndexNow on. 8 to 128 letters, digits or dashes. |
| `indexNow.branches` | `["master", "main"]` | Cloudflare Pages branches that count as production. |

Page grouping in llms.txt comes from the JSON-LD the structured-data template already writes: a `Service` node makes a service page, a `Service` with one `areaServed` place makes a service-by-area page, a `BlogPosting` makes a blog post.

## IndexNow

The integration pings only on a production Cloudflare Pages build (`CF_PAGES=1` and `CF_PAGES_BRANCH` in `branches`). Local and preview builds write the key file and send nothing.

On a production build it fetches the live `/agent-files.json` (the previous deploy), compares hashes, and sends the new, changed and removed URLs. A build where nothing changed sends nothing. Failures are logged and never fail the build.

The first deploy has no live page list yet, so it sends nothing. Once that deploy is live, submit every page once:

```bash
npx agent-files-indexnow https://www.example.com <key>
```

The ping goes out during the build, a minute or so before the deploy finishes. IndexNow engines fetch later than that in practice.

`AGENT_FILES_INDEXNOW=off` turns pinging off for a build, and `AGENT_FILES_INDEXNOW=dry` logs what a build would send.

## Checking a site

```bash
npm run build
npx wrangler pages dev dist
curl -sI http://127.0.0.1:8788/drain-cleaning.md   # text/markdown, x-robots-tag: noindex
curl -s  http://127.0.0.1:8788/llms.txt
```

## Outside this package

- **robots.txt**: add a content signal under `User-agent: *`:

  ```
  User-agent: *
  Content-Signal: search=yes, ai-input=yes, ai-train=yes
  Allow: /
  ```

- **Cloudflare AI Crawl Control**: on each zone, leave "Block AI bots" off and the managed robots.txt off. With them on, Cloudflare returns 403 to GPTBot, ClaudeBot and PerplexityBot and prepends its own robots.txt.

## Develop

```bash
npm install
npm test
npm run typecheck
npm run build
```
