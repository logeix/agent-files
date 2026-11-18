import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLlmsTxt, businessFacts } from "../src/llms.ts";
import { diffManifests, hashContent, isValidKey } from "../src/indexnow.ts";
import { mdPathFor } from "../src/generate.ts";

const business = {
  "@type": "Plumber",
  name: "Acme Plumbing",
  telephone: "(555) 010-0000",
  address: { "@type": "PostalAddress", addressLocality: "Springfield", addressRegion: "IL", postalCode: "62701" },
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    opens: "08:00",
    closes: "17:00",
  },
  areaServed: [{ "@type": "City", name: "Springfield, IL" }, { "@type": "City", name: "Chatham, IL" }],
  foundingDate: "2009",
  sameAs: ["https://facebook.com/acme"],
};

test("business facts come only from JSON-LD", () => {
  assert.deepEqual(businessFacts(business), [
    "Phone: (555) 010-0000",
    "Based in: Springfield, IL 62701",
    "Hours: Monday to Friday 08:00–17:00",
    "Areas served: Springfield, IL; Chatham, IL",
    "In business since: 2009",
    "Profiles: https://facebook.com/acme",
  ]);
  assert.deepEqual(businessFacts(undefined), []);
});

test("24-hour and split-day hours", () => {
  const facts = businessFacts({
    openingHoursSpecification: [
      { dayOfWeek: ["https://schema.org/Saturday", "https://schema.org/Sunday"], opens: "00:00", closes: "23:59" },
      { dayOfWeek: ["Monday", "Wednesday"], opens: "09:00:00", closes: "17:00:00" },
    ],
  });
  assert.deepEqual(facts, ["Hours: Saturday, Sunday 24 hours; Monday, Wednesday 09:00–17:00"]);
});

test("llms.txt groups pages by kind and custom sections", () => {
  const origin = "https://www.example.com";
  const page = (path: string, label: string, kind: "page" | "service" | "service-area" | "post") => ({
    path,
    url: origin + path,
    mdUrl: origin + mdPathFor(path),
    label,
    description: `${label} description`,
    kind,
  });
  const txt = buildLlmsTxt({
    origin,
    homeTitle: "Home | Acme",
    homeDescription: "Plumber in Springfield.",
    business,
    pages: [
      page("/blog/a/", "Post A", "post"),
      page("/drain-cleaning/", "Drain cleaning", "service"),
      page("/", "Plumber in Springfield", "page"),
      page("/areas/chatham/", "Plumber in Chatham", "page"),
      page("/drain-cleaning/chatham/", "Drain cleaning in Chatham", "service-area"),
      page("/about/", "About [us]", "page"),
    ],
    options: { sections: [{ title: "Towns", match: "/areas/" }] },
  });
  assert.match(txt, /^# Acme Plumbing\n\n> Plumber in Springfield\.\n\n- Phone: \(555\) 010-0000\n/);
  assert.match(txt, /## Towns\n\n- \[Plumber in Chatham\]\(https:\/\/www.example.com\/areas\/chatham.md\): Plumber in Chatham description\n/);
  assert.match(txt, /## Main pages\n\n- \[Plumber in Springfield\]\(https:\/\/www.example.com\/index.md\)/);
  assert.match(txt, /- \[About \\\[us\\\]\]\(https:\/\/www.example.com\/about.md\)/);
  assert.match(txt, /## Services\n\n- \[Drain cleaning\]/);
  assert.match(txt, /## Services by area\n\n- \[Drain cleaning in Chatham\]/);
  assert.match(txt, /## Blog\n\n- \[Post A\]/);
  assert.ok(txt.indexOf("## Towns") < txt.indexOf("## Main pages"));
});

test("md paths", () => {
  assert.equal(mdPathFor("/"), "/index.md");
  assert.equal(mdPathFor("/drain-cleaning/"), "/drain-cleaning.md");
  assert.equal(mdPathFor("/drain-cleaning/chatham/"), "/drain-cleaning/chatham.md");
  assert.equal(mdPathFor("/about"), "/about.md");
});

test("manifest diff finds changed, new and removed pages", () => {
  const prev = { version: 1 as const, pages: { "/": "a", "/x/": "b", "/gone/": "c" } };
  const next = { version: 1 as const, pages: { "/": "a", "/x/": "B", "/new/": "d" } };
  assert.deepEqual(diffManifests(prev, next), { changed: ["/x/", "/new/"], removed: ["/gone/"] });
  assert.equal(hashContent("x").length, 16);
});

test("IndexNow key format", () => {
  assert.ok(isValidKey("0123456789abcdef0123456789abcdef"));
  assert.ok(!isValidKey("short"));
  assert.ok(!isValidKey("has space in it"));
});
