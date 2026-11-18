import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown } from "../src/convert.ts";

const page = `<!doctype html><html lang="en"><head>
<title>Drain Cleaning in Springfield | Acme Plumbing</title>
<meta name="description" content="Drain cleaning in Springfield.">
<link rel="canonical" href="https://www.example.com/drain-cleaning/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"Plumber","@id":"https://www.example.com/#business","name":"Acme Plumbing","telephone":"(555) 010-0000"},
  {"@type":"Service","name":"Drain cleaning","provider":{"@id":"https://www.example.com/#business"}}
]}</script>
</head><body>
<header><nav><a href="/">Home</a></nav></header>
<main>
  <nav aria-label="Breadcrumb"><a href="/">Home</a></nav>
  <h1>  Drain cleaning in   Springfield </h1>
  <p>Call <a href="tel:+15550100000"> (555) 010-0000 </a> or <a href="#request">request online</a>.</p>
  <ol><li><span aria-hidden="true">Flap-07</span><p>Slow drains</p></li></ol>
  <p>See <a href="/sewer-line/">sewer line work</a>.</p>
  <a href="https://example.org/badge"><img src="/badge.png" alt="Badge"></a>
  <details><summary><h3>Do you clear main lines?</h3></summary><p>Yes, from the cleanout.</p></details>
  <form><button>Send</button></form>
  <div data-agent-skip>Skip me</div>
  <svg><text>icon</text></svg>
</main>
<footer>Footer text</footer>
</body></html>`;

test("converts the main content to markdown with frontmatter", () => {
  const { meta, markdown } = htmlToMarkdown(page, { url: "https://www.example.com/drain-cleaning/" });
  assert.equal(meta.title, "Drain Cleaning in Springfield | Acme Plumbing");
  assert.equal(meta.heading, "Drain cleaning in Springfield");
  assert.equal(meta.kind, "service");
  assert.match(markdown, /^---\ntitle: "Drain Cleaning in Springfield \| Acme Plumbing"\ndescription: "Drain cleaning in Springfield."\nurl: "https:\/\/www.example.com\/drain-cleaning\/"\n---\n/);
  assert.match(markdown, /^# Drain cleaning in Springfield$/m);
  assert.match(markdown, /\[\(555\) 010-0000\]\(tel:\+15550100000\)/);
  assert.match(markdown, /\[sewer line work\]\(https:\/\/www.example.com\/sewer-line\/\)/);
  assert.match(markdown, /### Do you clear main lines\?/);
  assert.match(markdown, /request online/);
  assert.doesNotMatch(markdown, /\]\(#request\)/);
  for (const gone of ["Footer text", "Skip me", "Send", "Flap-07", "Badge", "icon", "](https://example.org/badge)"]) {
    assert.ok(!markdown.includes(gone), `should not include ${gone}`);
  }
});

test("adds an H1 when the content has none", () => {
  const html = `<html><head><title>About | Acme</title></head><body><main><p>Hello.</p></main></body></html>`;
  const { markdown } = htmlToMarkdown(html, { url: "https://www.example.com/about/" });
  assert.match(markdown, /^# About \| Acme$/m);
});

test("uses the configured content selector and extra removals", () => {
  const html = `<html><head><title>T</title></head><body><div id="page"><h1>Page</h1><div class="promo">Promo</div><p>Body</p></div><footer>F</footer></body></html>`;
  const { markdown } = htmlToMarkdown(html, { url: "https://x.test/", content: ["#page"], remove: [".promo"] });
  assert.match(markdown, /# Page/);
  assert.match(markdown, /Body/);
  assert.ok(!markdown.includes("Promo"));
  assert.ok(!markdown.includes("F\n"));
});

test("reads blog dates and noindex", () => {
  const html = `<html><head><title>Post</title><meta name="robots" content="NOINDEX, follow">
  <script type="application/ld+json">{"@type":"BlogPosting","datePublished":"2026-10-01","dateModified":"2026-10-05"}</script>
  </head><body><main><h1>Post</h1></main></body></html>`;
  const { meta, markdown } = htmlToMarkdown(html, { url: "https://x.test/blog/post/" });
  assert.equal(meta.kind, "post");
  assert.equal(meta.robots, "noindex, follow");
  assert.match(markdown, /published: "2026-10-01"\nupdated: "2026-10-05"/);
});
